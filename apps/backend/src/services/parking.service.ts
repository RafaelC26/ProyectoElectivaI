import {
  KEYS,
  fieldsToObject,
  fieldsToSample,
  hashToGroupMetrics,
  hashToZoneState,
  parseAlert,
  parseStreamEntry,
  round2,
  type Alert,
  type AlertChange,
  type GroupMetrics,
  type MetricsSample,
  type ParkingEvent,
  type RankingEntry,
  type ZoneConfig,
  type ZoneEvent,
  type ZoneHistory,
  type ZoneState,
} from '@uptc/shared';
import type { Redis } from 'ioredis';
import { assertReady } from '../redis/connections';

/** Consultas de lectura sobre las estructuras Redis que mantiene el Processor. */
export class ParkingService {
  constructor(
    private readonly redis: Redis,
    private readonly zones: ZoneConfig[],
  ) {}

  /** Estado ACTUAL — HGETALL parking:zone:<id> por cada zona configurada. */
  async getZones(): Promise<ZoneState[]> {
    assertReady(this.redis);
    const pipeline = this.redis.pipeline();
    for (const zone of this.zones) pipeline.hgetall(KEYS.zone(zone.id));
    const results = (await pipeline.exec()) ?? [];
    return results
      .map(([, value]) => hashToZoneState(value as Record<string, string>))
      .filter((z): z is ZoneState => z !== null);
  }

  async getZone(zoneId: string): Promise<ZoneState | null> {
    assertReady(this.redis);
    return hashToZoneState(await this.redis.hgetall(KEYS.zone(zoneId)));
  }

  zoneExists(zoneId: string): boolean {
    return this.zones.some((z) => z.id === zoneId);
  }

  /**
   * HISTÓRICO reciente de una zona:
   *   eventos → XREVRANGE parking:stream (filtrando entity_id)
   *   ocupación temporal → XRANGE parking:timeseries (campo zone:<id>)
   */
  async getZoneHistory(zoneId: string, limit: number, minutes: number): Promise<ZoneHistory> {
    const events = (await this.getEvents({ limit, zone: zoneId })) as ZoneEvent[];
    const samples = await this.getMetricsHistory(minutes);
    return {
      zone_id: zoneId,
      events,
      occupancy: samples
        .filter((s) => s.zones[zoneId] !== undefined)
        .map((s) => ({ ts: s.ts, occupancy: s.zones[zoneId] })),
    };
  }

  async getMetrics(): Promise<{
    global: GroupMetrics | null;
    cars: GroupMetrics | null;
    motorcycles: GroupMetrics | null;
  }> {
    assertReady(this.redis);
    const results =
      (await this.redis
        .pipeline()
        .hgetall(KEYS.metricsGlobal)
        .hgetall(KEYS.metricsCars)
        .hgetall(KEYS.metricsMotorcycles)
        .exec()) ?? [];
    const [global, cars, motorcycles] = results.map(([, v]) => hashToGroupMetrics(v as Record<string, string>));
    return { global, cars, motorcycles };
  }

  /** Muestras de parking:timeseries de los últimos N minutos (XRANGE por tiempo). */
  async getMetricsHistory(minutes: number): Promise<MetricsSample[]> {
    assertReady(this.redis);
    const since = Date.now() - minutes * 60_000;
    const entries = await this.redis.xrange(KEYS.timeseries, String(since), '+');
    return entries.map(([id, fields]) => fieldsToSample(id, fields));
  }

  /** ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES */
  async getRanking(): Promise<RankingEntry[]> {
    assertReady(this.redis);
    const raw = await this.redis.zrevrange(KEYS.ranking, 0, -1, 'WITHSCORES');
    const byId = new Map(this.zones.map((z) => [z.id, z]));
    const out: RankingEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const zone = byId.get(raw[i]);
      if (!zone) continue;
      out.push({
        zone_id: raw[i],
        zone_name: zone.name,
        vehicle_type: zone.vehicleType,
        occupancy: round2(Number(raw[i + 1])),
        rank: out.length + 1,
      });
    }
    return out;
  }

  /** Últimos eventos de parking:stream (más recientes primero), con filtros opcionales. */
  async getEvents(opts: { limit: number; zone?: string; type?: string; before?: string }): Promise<ParkingEvent[]> {
    assertReady(this.redis);
    const out: ParkingEvent[] = [];
    let end = opts.before ? `(${opts.before}` : '+';
    const filtered = Boolean(opts.zone || opts.type);
    const batch = filtered ? 500 : opts.limit;
    // Con filtro se recorre el Stream por bloques hasta reunir `limit` eventos (máx. 5 000 entradas).
    for (let scanned = 0; out.length < opts.limit && scanned < 5000; scanned += batch) {
      const entries = await this.redis.xrevrange(KEYS.stream, end, '-', 'COUNT', batch);
      if (!entries.length) break;
      for (const entry of entries) {
        const parsed = parseStreamEntry(entry);
        if (!parsed) continue;
        if (opts.zone && parsed.event.entity_id !== opts.zone) continue;
        if (opts.type && parsed.event.event_type !== opts.type) continue;
        out.push(parsed.event);
        if (out.length >= opts.limit) break;
      }
      end = `(${entries[entries.length - 1][0]}`;
      if (entries.length < batch) break;
    }
    return out;
  }

  /** HVALS parking:alerts:active */
  async getActiveAlerts(): Promise<Alert[]> {
    assertReady(this.redis);
    const values = await this.redis.hvals(KEYS.alertsActive);
    return values
      .map(parseAlert)
      .filter((a): a is Alert => a !== null)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  /** Historial de alertas — XREVRANGE parking:alerts:stream */
  async getAlertHistory(limit: number, zone?: string): Promise<Array<AlertChange & { stream_id: string }>> {
    assertReady(this.redis);
    const entries = await this.redis.xrevrange(KEYS.alertsStream, '+', '-', 'COUNT', zone ? limit * 5 : limit);
    const out: Array<AlertChange & { stream_id: string }> = [];
    for (const [id, raw] of entries) {
      const fields = fieldsToObject(raw);
      const alert = parseAlert(fields.payload);
      if (!alert || (zone && alert.zone_id !== zone)) continue;
      out.push({ stream_id: id, action: fields.action as AlertChange['action'], alert });
      if (out.length >= limit) break;
    }
    return out;
  }
}
