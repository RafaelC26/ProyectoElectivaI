import { readFileSync } from 'node:fs';
import type { Alert, ParkingEvent, ZoneConfig, ZoneState } from '@uptc/shared';
import pg from 'pg';

export interface ArchivedEvent {
  streamId: string;
  event: ParkingEvent;
}

/** Escrituras en PostgreSQL. Todas son idempotentes (ON CONFLICT) → entrega "al menos una vez" segura. */
export class ArchiveRepository {
  readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 4000 });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async applySchema(schemaPath: string): Promise<void> {
    await this.pool.query(readFileSync(schemaPath, 'utf8'));
  }

  async upsertZones(zones: ZoneConfig[]): Promise<void> {
    for (const z of zones) {
      await this.pool.query(
        `INSERT INTO zones (id, name, vehicle_type, capacity) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, vehicle_type = EXCLUDED.vehicle_type,
                                        capacity = EXCLUDED.capacity, updated_at = now()`,
        [z.id, z.name, z.vehicleType, z.capacity],
      );
    }
  }

  /** INSERT … ON CONFLICT (stream_id) DO NOTHING en un solo INSERT multi‑fila. */
  async insertEvents(events: ArchivedEvent[]): Promise<number> {
    if (!events.length) return 0;
    const values: unknown[] = [];
    const rows = events.map(({ streamId, event }, i) => {
      const d = event.data as Partial<{
        vehicle_type: string;
        occupied: number;
        capacity: number;
        occupancy: number;
        status: string;
      }>;
      values.push(
        streamId,
        event.event_id,
        event.event_type,
        event.entity_id,
        event.timestamp,
        d.vehicle_type ?? null,
        d.occupied ?? null,
        d.capacity ?? null,
        d.occupancy ?? null,
        d.status ?? null,
        event.metadata.source,
        JSON.stringify(event),
      );
      const b = i * 12;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`;
    });
    const result = await this.pool.query(
      `INSERT INTO parking_events
         (stream_id, event_id, event_type, entity_id, occurred_at, vehicle_type, occupied, capacity, occupancy, status, source, payload)
       VALUES ${rows.join(',')}
       ON CONFLICT (stream_id) DO NOTHING`,
      values,
    );
    return result.rowCount ?? 0;
  }

  /** Upsert por (id, raised_at): RAISED inserta la alerta, RESOLVED la actualiza. */
  async upsertAlerts(alerts: Alert[]): Promise<number> {
    let count = 0;
    for (const a of alerts) {
      const result = await this.pool.query(
        `INSERT INTO alerts (id, zone_id, zone_name, type, severity, message, value, threshold, unit, status,
                             raised_at, resolved_at, resolution, resolution_message, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id, raised_at) DO UPDATE SET
           status = EXCLUDED.status,
           resolved_at = coalesce(EXCLUDED.resolved_at, alerts.resolved_at),
           resolution = coalesce(EXCLUDED.resolution, alerts.resolution),
           resolution_message = coalesce(EXCLUDED.resolution_message, alerts.resolution_message),
           payload = EXCLUDED.payload,
           updated_at = now()
         WHERE alerts.status <> 'RESOLVED'`,
        [
          a.id,
          a.zone_id,
          a.zone_name,
          a.type,
          a.severity,
          a.message,
          a.value,
          a.threshold,
          a.unit,
          a.status,
          a.timestamp,
          a.resolved_at ?? null,
          a.resolution ?? null,
          a.resolution_message ?? null,
          JSON.stringify(a),
        ],
      );
      count += result.rowCount ?? 0;
    }
    return count;
  }

  async insertSnapshots(zones: ZoneState[]): Promise<number> {
    if (!zones.length) return 0;
    const values: unknown[] = [];
    const rows = zones.map((z, i) => {
      values.push(
        z.zone_id,
        z.occupied,
        z.capacity,
        z.available,
        z.occupancy,
        z.status,
        z.trend,
        z.entries_per_minute,
        z.exits_per_minute,
        z.simulated_time || null,
      );
      const b = i * 10;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
    });
    const result = await this.pool.query(
      `INSERT INTO zone_snapshots
         (zone_id, occupied, capacity, available, occupancy, status, trend, entries_per_minute, exits_per_minute, simulated_time)
       VALUES ${rows.join(',')}`,
      values,
    );
    return result.rowCount ?? 0;
  }

  /** Retención: el histórico permanente también tiene política de crecimiento. */
  async purgeOlderThan(days: number): Promise<{ events: number; snapshots: number; alerts: number }> {
    const ev = await this.pool.query(
      `DELETE FROM parking_events WHERE occurred_at < now() - make_interval(days => $1)`,
      [days],
    );
    const sn = await this.pool.query(
      `DELETE FROM zone_snapshots WHERE captured_at < now() - make_interval(days => $1)`,
      [days],
    );
    const al = await this.pool.query(
      `DELETE FROM alerts WHERE status = 'RESOLVED' AND raised_at < now() - make_interval(days => $1)`,
      [days],
    );
    return { events: ev.rowCount ?? 0, snapshots: sn.rowCount ?? 0, alerts: al.rowCount ?? 0 };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
