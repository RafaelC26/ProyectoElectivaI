import {
  KEYS,
  SERVICES,
  STREAM_GROUPS,
  round2,
  type Heartbeat,
  type ServiceState,
  type ServiceStatus,
  type SystemStatus,
} from '@uptc/shared';
import type { Redis } from 'ioredis';
import type { Postgres } from '../db/postgres';

function parseInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

function pairs(list: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < list.length; i += 2) out[String(list[i])] = list[i + 1];
  return out;
}

function parseHeartbeat(raw: string | null): Heartbeat | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Heartbeat;
  } catch {
    return null;
  }
}

export interface SystemContext {
  redis: Redis;
  postgres: Postgres;
  startedAt: number;
  websocketClients: () => number;
  archiveCounts: () => { events: number | null; alerts: number | null; snapshots: number | null };
}

/** Estado de todos los componentes: heartbeats con TTL + INFO de Redis + Streams + PostgreSQL. */
export class SystemService {
  constructor(private readonly ctx: SystemContext) {}

  async getStatus(): Promise<SystemStatus> {
    const { redis, postgres } = this.ctx;
    const now = Date.now();
    const redisReady = redis.status === 'ready';
    const backendUptime = Math.round((now - this.ctx.startedAt) / 1000);

    const base: SystemStatus = {
      timestamp: new Date(now).toISOString(),
      services: [],
      redis: {
        connected: redisReady,
        version: null,
        uptime_s: null,
        used_memory_human: null,
        connected_clients: null,
        ops_per_sec: null,
        keys: null,
      },
      streams: {
        events_length: 0,
        timeseries_length: 0,
        alerts_length: 0,
        archiver_pending: null,
        archiver_lag: null,
        archiver_last_delivered: null,
      },
      postgres: {
        configured: postgres.configured,
        connected: postgres.connected,
        events_archived: null,
        alerts_archived: null,
        snapshots: null,
      },
      throughput: { events_published: 0, events_processed: 0, events_per_second: 0, avg_processing_ms: 0 },
    };

    const counts = this.ctx.archiveCounts();
    base.postgres.events_archived = counts.events;
    base.postgres.alerts_archived = counts.alerts;
    base.postgres.snapshots = counts.snapshots;

    const self = (
      name: string,
      label: string,
      state: ServiceState,
      details: ServiceStatus['details'],
    ): ServiceStatus => ({
      name,
      label,
      state,
      last_seen: base.timestamp,
      uptime_s: backendUptime,
      details,
    });

    if (!redisReady) {
      const unknown = (name: string, label: string): ServiceStatus => ({
        name,
        label,
        state: 'RECONNECTING',
        last_seen: null,
        uptime_s: null,
        details: { note: 'Sin conexión con Redis: estado desconocido' },
      });
      base.services = [
        { ...unknown('redis', 'Redis'), details: { status: redis.status } },
        unknown('publisher', 'Publisher'),
        unknown('processor', 'Subscriber / Processor'),
        self('backend', 'Backend (REST)', 'DEGRADED', { redis: redis.status }),
        self('websocket', 'WebSocket (Socket.IO)', 'ONLINE', { clients: this.ctx.websocketClients() }),
        unknown('simulator', 'Simulador'),
        unknown('archiver', 'Archiver'),
        this.postgresStatus(),
      ];
      return base;
    }

    const results =
      (await redis
        .pipeline()
        .mget(KEYS.heartbeat(SERVICES.PUBLISHER), KEYS.heartbeat(SERVICES.PROCESSOR), KEYS.heartbeat(SERVICES.ARCHIVER))
        .info()
        .xlen(KEYS.stream)
        .xlen(KEYS.timeseries)
        .xlen(KEYS.alertsStream)
        .hgetall(KEYS.statsSystem)
        .mget(KEYS.temporaryMetric('events_per_second'), KEYS.temporaryMetric('avg_processing_ms'))
        .exec()) ?? [];

    const [publisherHb, processorHb, archiverHb] = ((results[0]?.[1] as (string | null)[]) ?? []).map(parseHeartbeat);
    const info = parseInfo(String(results[1]?.[1] ?? ''));
    base.redis = {
      connected: true,
      version: info.redis_version ?? null,
      uptime_s: Number(info.uptime_in_seconds) || null,
      used_memory_human: info.used_memory_human ?? null,
      connected_clients: Number(info.connected_clients) || null,
      ops_per_sec: Number(info.instantaneous_ops_per_sec) || 0,
      keys: Number(/keys=(\d+)/.exec(info.db0 ?? '')?.[1] ?? 0),
    };
    base.streams.events_length = Number(results[2]?.[1] ?? 0);
    base.streams.timeseries_length = Number(results[3]?.[1] ?? 0);
    base.streams.alerts_length = Number(results[4]?.[1] ?? 0);

    const stats = (results[5]?.[1] as Record<string, string>) ?? {};
    const [eps, avgMs] = (results[6]?.[1] as (string | null)[]) ?? [];
    base.throughput = {
      events_published: Number(stats.events_published ?? 0),
      events_processed: Number(stats.events_processed ?? 0),
      events_per_second: Number(eps ?? 0),
      avg_processing_ms: Number(avgMs ?? 0),
    };

    // Consumer group del archiver: pendientes (PEL) y lag respecto al último evento del Stream.
    try {
      const groups = (await redis.xinfo('GROUPS', KEYS.stream)) as unknown[][];
      const group = groups.map(pairs).find((g) => g.name === STREAM_GROUPS.ARCHIVER);
      if (group) {
        base.streams.archiver_pending = Number(group.pending ?? 0);
        base.streams.archiver_lag = group.lag === null || group.lag === undefined ? null : Number(group.lag);
        base.streams.archiver_last_delivered = String(group['last-delivered-id'] ?? '') || null;
      }
    } catch {
      // El Stream todavía no existe.
    }

    const fromHeartbeat = (name: string, label: string, hb: Heartbeat | null): ServiceStatus => ({
      name,
      label,
      state: hb ? 'ONLINE' : 'OFFLINE',
      last_seen: hb ? new Date(hb.ts).toISOString() : null,
      uptime_s: hb ? Math.round((now - Date.parse(hb.started_at)) / 1000) : null,
      details: hb?.details ?? {},
    });

    const publisher = fromHeartbeat('publisher', 'Publisher', publisherHb);
    const simulatorState: ServiceState = !publisherHb
      ? 'OFFLINE'
      : publisherHb.details.status === 'RUNNING'
        ? 'ONLINE'
        : 'PAUSED';
    const archiver = fromHeartbeat('archiver', 'Archiver → PostgreSQL', archiverHb);
    if (archiverHb && archiverHb.details.postgres === 'disconnected') archiver.state = 'DEGRADED';

    base.services = [
      {
        name: 'redis',
        label: 'Redis',
        state: 'ONLINE',
        last_seen: base.timestamp,
        uptime_s: base.redis.uptime_s,
        details: {
          version: base.redis.version,
          memory: base.redis.used_memory_human,
          clients: base.redis.connected_clients,
          ops_per_sec: base.redis.ops_per_sec,
          keys: base.redis.keys,
        },
      },
      publisher,
      fromHeartbeat('processor', 'Subscriber / Processor', processorHb),
      self('backend', 'Backend (REST)', 'ONLINE', { redis: redis.status, postgres: postgres.connected }),
      self('websocket', 'WebSocket (Socket.IO)', 'ONLINE', { clients: this.ctx.websocketClients() }),
      {
        name: 'simulator',
        label: 'Simulador',
        state: simulatorState,
        last_seen: publisher.last_seen,
        uptime_s: publisher.uptime_s,
        details: publisherHb
          ? {
              status: publisherHb.details.status ?? null,
              mode: publisherHb.details.mode ?? null,
              speed: publisherHb.details.speed ?? null,
              simulated_time: publisherHb.details.simulated_time ?? null,
              profile: publisherHb.details.profile ?? null,
            }
          : {},
      },
      archiver,
      this.postgresStatus(),
    ];
    base.throughput.avg_processing_ms = round2(base.throughput.avg_processing_ms);
    return base;
  }

  private postgresStatus(): ServiceStatus {
    const { postgres } = this.ctx;
    return {
      name: 'postgres',
      label: 'PostgreSQL',
      state: !postgres.configured ? 'OFFLINE' : postgres.connected ? 'ONLINE' : 'OFFLINE',
      last_seen: null,
      uptime_s: null,
      details: { configured: postgres.configured },
    };
  }

  /** Respuesta de GET /api/health (sección 83). */
  async getHealth(eventsProcessedFallback = 0) {
    const status = await this.getStatus().catch(() => null);
    const find = (name: string) => status?.services.find((s) => s.name === name)?.state;
    const running = (state?: ServiceState) =>
      state === 'ONLINE' ? 'running' : state === 'PAUSED' ? 'paused' : 'stopped';
    const redisConnected = this.ctx.redis.status === 'ready';
    const healthy = redisConnected && find('publisher') !== 'OFFLINE' && find('processor') === 'ONLINE';
    return {
      status: healthy ? 'healthy' : redisConnected ? 'degraded' : 'unhealthy',
      redis: redisConnected ? 'connected' : this.ctx.redis.status,
      publisher: running(find('publisher')),
      processor: running(find('processor')),
      archiver: running(find('archiver')),
      postgres: this.ctx.postgres.connected
        ? 'connected'
        : this.ctx.postgres.configured
          ? 'disconnected'
          : 'not-configured',
      websocket: 'running',
      websocketClients: this.ctx.websocketClients(),
      uptime: Math.round((Date.now() - this.ctx.startedAt) / 1000),
      eventsProcessed: status?.throughput.events_processed ?? eventsProcessedFallback,
    };
  }
}
