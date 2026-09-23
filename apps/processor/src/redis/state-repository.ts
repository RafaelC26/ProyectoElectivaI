import {
  KEYS,
  computeZoneSnapshot,
  eventToStreamFields,
  fieldsToSample,
  formatEventId,
  hashToZoneState,
  sampleToFields,
  toHash,
  type MetricsSample,
  type MetricsSnapshot,
  type MovementKind,
  type Thresholds,
  type ZoneConfig,
  type ZoneEvent,
  type ZoneState,
} from '@uptc/shared';
import type { Redis } from 'ioredis';
import type { RankingScore } from '../metrics/metrics-calculator';
import { initialZoneState, type WindowCounts } from '../processor/zone-state';

const MINUTE = 60_000;
const WINDOW_RETENTION_MS = 15 * MINUTE;
/** TTL de las ventanas deslizantes: si una zona queda inactiva, sus claves expiran solas. */
const WINDOW_TTL_SECONDS = 16 * 60;

export interface RepositoryOptions {
  streamMaxLength: number;
  timeseriesMaxLength: number;
}

/**
 * Acceso a Redis del Processor.
 *   Hash        parking:zone:<id>               estado actual
 *   Sorted Set  parking:ranking:occupancy       ranking (score = % ocupación)
 *   Sorted Set  parking:window:{entries,exits}:<id>  ventanas deslizantes (score = epoch ms) + TTL
 *   Stream      parking:stream                  histórico reciente (eventos derivados)
 *   Stream      parking:timeseries              muestras de métricas
 *   Hash        parking:metrics:*               métricas agregadas
 *   Hash        parking:stats:*                 contadores
 */
export class StateRepository {
  constructor(
    private readonly redis: Redis,
    private readonly zones: ZoneConfig[],
    private readonly opts: RepositoryOptions,
  ) {}

  async getZone(zoneId: string): Promise<ZoneState | null> {
    return hashToZoneState(await this.redis.hgetall(KEYS.zone(zoneId)));
  }

  async getAllZones(): Promise<ZoneState[]> {
    const pipeline = this.redis.pipeline();
    for (const zone of this.zones) pipeline.hgetall(KEYS.zone(zone.id));
    const results = (await pipeline.exec()) ?? [];
    return results
      .map(([, value]) => hashToZoneState(value as Record<string, string>))
      .filter((z): z is ZoneState => z !== null);
  }

  /** ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES */
  async getRanking(): Promise<RankingScore[]> {
    const raw = await this.redis.zrevrange(KEYS.ranking, 0, -1, 'WITHSCORES');
    const out: RankingScore[] = [];
    for (let i = 0; i < raw.length; i += 2) out.push({ zone_id: raw[i], score: Number(raw[i + 1]) });
    return out;
  }

  /** Crea los Hashes que falten y aplica cambios de nombre/capacidad de config/zones.json. */
  async initializeZones(thresholds: Thresholds): Promise<{ created: string[]; updated: string[]; removed: string[] }> {
    const created: string[] = [];
    const updated: string[] = [];
    const now = new Date().toISOString();
    for (const zone of this.zones) {
      const existing = await this.getZone(zone.id);
      if (!existing) {
        const state = initialZoneState(zone, thresholds, now);
        await this.redis
          .pipeline()
          .hset(KEYS.zone(zone.id), toHash(state))
          .zadd(KEYS.ranking, state.occupancy, zone.id)
          .exec();
        created.push(zone.id);
      } else if (
        existing.capacity !== zone.capacity ||
        existing.zone_name !== zone.name ||
        existing.vehicle_type !== zone.vehicleType
      ) {
        const snap = computeZoneSnapshot(zone.capacity, existing.occupied, thresholds.occupancy);
        await this.redis
          .pipeline()
          .hset(KEYS.zone(zone.id), toHash({ zone_name: zone.name, vehicle_type: zone.vehicleType, ...snap }))
          .zadd(KEYS.ranking, snap.occupancy, zone.id)
          .exec();
        updated.push(zone.id);
      }
    }
    // Zonas que ya no están en la configuración.
    const known = new Set(this.zones.map((z) => z.id));
    const ranked = await this.redis.zrange(KEYS.ranking, 0, -1);
    const removed = ranked.filter((id) => !known.has(id));
    if (removed.length) {
      const pipeline = this.redis.pipeline().zrem(KEYS.ranking, ...removed);
      for (const id of removed) pipeline.del(KEYS.zone(id), KEYS.windowEntries(id), KEYS.windowExits(id));
      await pipeline.exec();
    }
    return { created, updated, removed };
  }

  /**
   * Registra el movimiento en la ventana deslizante y devuelve los conteos 1/5/15 min de la zona:
   *   ZADD parking:window:entries:<id> <epoch ms> <event_id>
   *   ZREMRANGEBYSCORE … -inf (now − 15 min)   → la ventana no crece indefinidamente
   *   EXPIRE … 960                            → TTL si la zona queda inactiva
   *   ZCOUNT … (now − 1/5/15 min) +inf
   */
  async recordMovement(
    zoneId: string,
    kind: MovementKind,
    eventId: string,
    at: number,
    now: number,
  ): Promise<WindowCounts> {
    const key = kind === 'ENTRY' ? KEYS.windowEntries(zoneId) : KEYS.windowExits(zoneId);
    const pipeline = this.redis.pipeline().zadd(key, at, eventId).expire(key, WINDOW_TTL_SECONDS);
    this.appendWindowQueries(pipeline, zoneId, now);
    const results = (await pipeline.exec()) ?? [];
    return this.parseWindowResults(results.slice(2));
  }

  async windowCountsAll(now: number): Promise<Record<string, WindowCounts>> {
    const pipeline = this.redis.pipeline();
    for (const zone of this.zones) this.appendWindowQueries(pipeline, zone.id, now);
    const results = (await pipeline.exec()) ?? [];
    const out: Record<string, WindowCounts> = {};
    this.zones.forEach((zone, i) => {
      out[zone.id] = this.parseWindowResults(results.slice(i * 8, (i + 1) * 8));
    });
    return out;
  }

  private appendWindowQueries(pipeline: ReturnType<Redis['pipeline']>, zoneId: string, now: number): void {
    const cutoff = now - WINDOW_RETENTION_MS;
    for (const key of [KEYS.windowEntries(zoneId), KEYS.windowExits(zoneId)]) {
      pipeline.zremrangebyscore(key, '-inf', `(${cutoff}`);
      pipeline.zcount(key, `(${now - MINUTE}`, '+inf');
      pipeline.zcount(key, `(${now - 5 * MINUTE}`, '+inf');
      pipeline.zcount(key, `(${now - 15 * MINUTE}`, '+inf');
    }
  }

  private parseWindowResults(results: Array<[Error | null, unknown]>): WindowCounts {
    const n = (i: number) => Number(results[i]?.[1] ?? 0);
    // Orden: [zrem, e1, e5, e15, zrem, x1, x5, x15]
    return {
      entries_1m: n(1),
      entries_5m: n(2),
      entries_15m: n(3),
      exits_1m: n(5),
      exits_5m: n(6),
      exits_15m: n(7),
    };
  }

  async nextEventIds(count: number): Promise<string[]> {
    if (count === 0) return [];
    const last = await this.redis.incrby(KEYS.seqEvent, count);
    return Array.from({ length: count }, (_, i) => formatEventId(last - count + 1 + i));
  }

  /**
   * Persiste el resultado del procesamiento en un solo viaje a Redis:
   *   HSET estado · ZADD ranking · XADD eventos derivados · HINCRBY estadísticas · SET checkpoint
   */
  async saveProcessed(params: {
    state: ZoneState;
    derived: ZoneEvent[];
    kind: MovementKind;
    streamId?: string;
    processingMs: number;
  }): Promise<void> {
    const { state, derived, kind, streamId } = params;
    const pipeline = this.redis
      .pipeline()
      .hset(KEYS.zone(state.zone_id), toHash(state))
      .zadd(KEYS.ranking, state.occupancy, state.zone_id)
      .hincrby(kind === 'ENTRY' ? KEYS.statsEntries : KEYS.statsExits, state.zone_id, 1)
      .hincrby(kind === 'ENTRY' ? KEYS.statsEntries : KEYS.statsExits, 'total', 1)
      .hincrby(KEYS.statsSystem, 'events_processed', 1)
      .hincrbyfloat(KEYS.statsSystem, 'processing_ms_total', params.processingMs);
    for (const event of derived) {
      pipeline.xadd(KEYS.stream, 'MAXLEN', '~', String(this.opts.streamMaxLength), '*', ...eventToStreamFields(event));
    }
    if (streamId) pipeline.set(KEYS.processorCheckpoint, streamId);
    await pipeline.exec();
  }

  async patchZone(zoneId: string, fields: Partial<ZoneState>): Promise<void> {
    await this.redis.hset(KEYS.zone(zoneId), toHash(fields));
  }

  async saveMetrics(metrics: MetricsSnapshot): Promise<void> {
    await this.redis
      .pipeline()
      .hset(KEYS.metricsGlobal, toHash(metrics.global))
      .hset(KEYS.metricsCars, toHash(metrics.cars))
      .hset(KEYS.metricsMotorcycles, toHash(metrics.motorcycles))
      .exec();
  }

  /** XADD parking:timeseries MAXLEN ~ N * ts … global … zone:<id> … */
  async appendSample(sample: Omit<MetricsSample, 'id'>): Promise<string> {
    const id = await this.redis.xadd(
      KEYS.timeseries,
      'MAXLEN',
      '~',
      String(this.opts.timeseriesMaxLength),
      '*',
      ...sampleToFields(sample),
    );
    return id ?? `${sample.ts}-0`;
  }

  async loadSamples(since: number): Promise<MetricsSample[]> {
    const entries = await this.redis.xrange(KEYS.timeseries, String(since), '+');
    return entries.map(([id, fields]) => fieldsToSample(id, fields));
  }

  /** Métricas temporales con TTL: desaparecen solas si el Processor deja de actualizarlas. */
  async setTemporaryMetric(name: string, value: number, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEYS.temporaryMetric(name), String(value), 'EX', ttlSeconds);
  }

  async getCheckpoint(): Promise<string | null> {
    return this.redis.get(KEYS.processorCheckpoint);
  }

  async setCheckpoint(streamId: string): Promise<void> {
    await this.redis.set(KEYS.processorCheckpoint, streamId);
  }

  async lastStreamId(): Promise<string | null> {
    const last = await this.redis.xrevrange(KEYS.stream, '+', '-', 'COUNT', 1);
    return last[0]?.[0] ?? null;
  }

  /** Entradas del Stream posteriores a un ID (exclusivo). */
  async readStreamAfter(streamId: string, count: number): Promise<Array<[string, string[]]>> {
    return this.redis.xrange(KEYS.stream, `(${streamId}`, '+', 'COUNT', count);
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    return this.redis.publish(channel, JSON.stringify(payload));
  }
}
