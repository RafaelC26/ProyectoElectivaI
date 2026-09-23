import type { Logger } from '@uptc/shared/node';
import type { Postgres } from '../db/postgres';

export interface ArchiveCounts {
  events: number | null;
  alerts: number | null;
  snapshots: number | null;
}

/**
 * Consultas al histórico PERMANENTE en PostgreSQL (lo escribe el servicio archiver).
 * Redis responde "¿cómo está ahora / cómo evolucionó en los últimos minutos?";
 * PostgreSQL responde "¿qué pasó ayer, la semana pasada, en el semestre?".
 */
export class ArchiveService {
  private counts: ArchiveCounts = { events: null, alerts: null, snapshots: null };

  constructor(
    private readonly pg: Postgres,
    private readonly logger: Logger,
  ) {}

  cachedCounts(): ArchiveCounts {
    return this.counts;
  }

  /** Conteos aproximados (pg_class.reltuples) + exactos si la tabla es pequeña; se refresca cada 5 s. */
  async refreshCounts(): Promise<void> {
    if (!this.pg.configured || !(await this.pg.ping())) {
      this.counts = { events: null, alerts: null, snapshots: null };
      return;
    }
    try {
      const rows = await this.pg.query<{ events: string; alerts: string; snapshots: string }>(
        `SELECT (SELECT count(*) FROM parking_events) AS events,
                (SELECT count(*) FROM alerts) AS alerts,
                (SELECT count(*) FROM zone_snapshots) AS snapshots`,
      );
      this.counts = {
        events: Number(rows[0]?.events ?? 0),
        alerts: Number(rows[0]?.alerts ?? 0),
        snapshots: Number(rows[0]?.snapshots ?? 0),
      };
    } catch (error) {
      this.logger.debug('Archive counts unavailable', { error: (error as Error).message });
      this.counts = { events: null, alerts: null, snapshots: null };
    }
  }

  async stats() {
    const [overview] = await this.pg.query<{
      events: string;
      alerts: string;
      snapshots: string;
      first_event: string | null;
      last_event: string | null;
      last_archived: string | null;
      db_size: string;
    }>(
      `SELECT (SELECT count(*) FROM parking_events) AS events,
              (SELECT count(*) FROM alerts) AS alerts,
              (SELECT count(*) FROM zone_snapshots) AS snapshots,
              (SELECT min(occurred_at) FROM parking_events) AS first_event,
              (SELECT max(occurred_at) FROM parking_events) AS last_event,
              (SELECT max(archived_at) FROM parking_events) AS last_archived,
              pg_size_pretty(pg_database_size(current_database())) AS db_size`,
    );
    const byType = await this.pg.query<{ event_type: string; total: string }>(
      `SELECT event_type, count(*) AS total FROM parking_events GROUP BY event_type ORDER BY total DESC`,
    );
    return {
      events: Number(overview?.events ?? 0),
      alerts: Number(overview?.alerts ?? 0),
      snapshots: Number(overview?.snapshots ?? 0),
      first_event: overview?.first_event ?? null,
      last_event: overview?.last_event ?? null,
      last_archived: overview?.last_archived ?? null,
      database_size: overview?.db_size ?? null,
      events_by_type: byType.map((r) => ({ event_type: r.event_type, total: Number(r.total) })),
    };
  }

  /** Vista daily_zone_summary: entradas, salidas, pico y promedio por zona y día. */
  async dailySummary(days: number) {
    const rows = await this.pg.query(
      `SELECT day, zone_id, zone_name, vehicle_type, entries, exits, peak_occupancy, avg_occupancy, times_full, alerts
         FROM daily_zone_summary
        WHERE day >= (now() AT TIME ZONE 'America/Bogota')::date - $1::int
        ORDER BY day DESC, zone_id`,
      [days],
    );
    return rows;
  }

  async hourlyOccupancy(zoneId: string | undefined, hours: number) {
    return this.pg.query(
      `SELECT date_trunc('minute', captured_at) AS minute, zone_id, round(avg(occupancy), 2) AS occupancy
         FROM zone_snapshots
        WHERE captured_at >= now() - make_interval(hours => $1::int)
          AND ($2::text IS NULL OR zone_id = $2)
        GROUP BY 1, 2
        ORDER BY 1`,
      [hours, zoneId ?? null],
    );
  }

  async events(limit: number, zoneId?: string, type?: string) {
    return this.pg.query(
      `SELECT stream_id, event_id, event_type, entity_id, occurred_at, occupied, capacity, occupancy, source
         FROM parking_events
        WHERE ($2::text IS NULL OR entity_id = $2) AND ($3::text IS NULL OR event_type = $3)
        ORDER BY occurred_at DESC
        LIMIT $1`,
      [limit, zoneId ?? null, type ?? null],
    );
  }

  async alerts(limit: number) {
    return this.pg.query(
      `SELECT id, zone_id, zone_name, type, severity, message, value, threshold, status,
              raised_at, resolved_at, resolution,
              round(extract(epoch FROM (coalesce(resolved_at, now()) - raised_at))::numeric, 1) AS duration_s
         FROM alerts
        ORDER BY raised_at DESC
        LIMIT $1`,
      [limit],
    );
  }
}
