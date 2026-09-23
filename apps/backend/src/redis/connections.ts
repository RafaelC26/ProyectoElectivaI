import { createRedis, type Logger } from '@uptc/shared/node';
import type { Redis } from 'ioredis';

export interface RedisConnections {
  /** Consultas de la API: falla rápido si Redis no está disponible (la API responde 503). */
  commands: Redis;
  /** Conexión dedicada a SUBSCRIBE (parking-updates, parking-alerts, system-events). */
  subscriber: Redis;
}

export function createConnections(logger: Logger): RedisConnections {
  return {
    commands: createRedis('backend', logger, { maxRetriesPerRequest: 1, enableOfflineQueue: false }),
    subscriber: createRedis('backend-subscriber', logger),
  };
}

export class RedisUnavailableError extends Error {
  constructor() {
    super('Redis no está disponible en este momento');
  }
}

export function assertReady(redis: Redis): void {
  if (redis.status !== 'ready') throw new RedisUnavailableError();
}
