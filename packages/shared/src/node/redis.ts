import { hostname } from 'node:os';
import { Redis, type RedisOptions } from 'ioredis';
import { KEYS } from '../constants/redis-keys';
import type { Heartbeat } from '../types/models';
import { envNumber, envOptional, envString } from './env';
import type { Logger } from './logger';

/** Reintentos de reconexión: 1 s → 2 s → 5 s → 5 s … (sección 114). */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000] as const;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(attempt, 1) - 1, RECONNECT_DELAYS_MS.length - 1)];
}

/**
 * Crea una conexión ioredis con reconexión automática y logs de estado.
 * Por defecto los comandos esperan a que Redis vuelva (maxRetriesPerRequest: null);
 * el backend HTTP usa opciones que fallan rápido para responder 503.
 */
export function createRedis(name: string, logger: Logger, overrides: RedisOptions = {}): Redis {
  let attempts = 0;
  const client = new Redis({
    host: envString('REDIS_HOST', 'localhost'),
    port: envNumber('REDIS_PORT', 6379),
    password: envOptional('REDIS_PASSWORD'),
    connectionName: `uptc:${name}`,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      attempts = times;
      const delay = reconnectDelay(times);
      logger.warn('Redis reconnect scheduled', { connection: name, attempt: times, delay_ms: delay });
      return delay;
    },
    ...overrides,
  });

  let lastError = '';
  client.on('ready', () => {
    logger.info(attempts > 0 ? 'Redis reconnected' : 'Redis connected', { connection: name, attempts });
    attempts = 0;
    lastError = '';
  });
  client.on('error', (error: Error) => {
    // Evita repetir el mismo error en cada intento de reconexión.
    if (error.message !== lastError) logger.error('Redis error', { connection: name, error: error.message });
    lastError = error.message;
  });
  client.on('close', () => logger.warn('Redis connection closed', { connection: name }));
  return client;
}

export function isReady(client: Redis): boolean {
  return client.status === 'ready';
}

export function waitForReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => client.once('ready', () => resolve()));
}

/**
 * Heartbeat con TTL: SET parking:heartbeat:<service> <json> EX <ttl>.
 * Si el servicio muere, la clave expira sola y el sistema lo marca OFFLINE.
 */
export function startHeartbeat(
  client: Redis,
  service: string,
  logger: Logger,
  details: () => Heartbeat['details'] = () => ({}),
): () => void {
  const ttl = envNumber('HEARTBEAT_TTL_SECONDS', 10);
  const startedAt = new Date().toISOString();
  const instance = `${hostname()}-${process.pid}`;

  const beat = async () => {
    if (client.status !== 'ready') return;
    const payload: Heartbeat = {
      service,
      instance,
      pid: process.pid,
      started_at: startedAt,
      ts: Date.now(),
      redis: 'ready',
      details: details(),
    };
    await client.set(KEYS.heartbeat(service), JSON.stringify(payload), 'EX', ttl);
  };

  void beat().catch(() => undefined);
  const timer = setInterval(
    () => {
      beat().catch((error: Error) => logger.debug('Heartbeat failed', { error: error.message }));
    },
    Math.max(1000, (ttl * 1000) / 3),
  );
  return () => clearInterval(timer);
}

/** Ejecuta la limpieza ante SIGINT/SIGTERM (docker stop). */
export function onShutdown(logger: Logger, cleanup: () => Promise<void> | void): void {
  let closing = false;
  const handler = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info('Shutting down', { signal });
    try {
      await cleanup();
    } catch (error) {
      logger.error('Error during shutdown', { error: (error as Error).message });
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void handler('SIGINT'));
  process.on('SIGTERM', () => void handler('SIGTERM'));
}
