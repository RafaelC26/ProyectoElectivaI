import { CHANNELS, KEY_PREFIX, fieldsToObject, type RedisKeyInfo } from '@uptc/shared';
import type { Redis } from 'ioredis';
import { assertReady } from '../redis/connections';

export class InvalidKeyError extends Error {}

export interface InspectResult {
  key: string;
  type: string;
  ttl: number;
  command: string;
  value: unknown;
}

/**
 * Panel /debug: explorador de SÓLO LECTURA de las claves parking:* para la demostración
 * (tipos, TTL que disminuye, contenido de Hashes, Streams y Sorted Sets).
 */
export class DebugService {
  constructor(private readonly redis: Redis) {}

  async listKeys(): Promise<RedisKeyInfo[]> {
    assertReady(this.redis);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0' && keys.length < 2000);

    const typePipe = this.redis.pipeline();
    for (const key of keys) typePipe.type(key).ttl(key);
    const typeResults = (await typePipe.exec()) ?? [];
    const types = keys.map((_, i) => String(typeResults[i * 2]?.[1] ?? 'none'));
    const ttls = keys.map((_, i) => Number(typeResults[i * 2 + 1]?.[1] ?? -2));

    const sizePipe = this.redis.pipeline();
    types.forEach((type, i) => {
      const key = keys[i];
      if (type === 'hash') sizePipe.hlen(key);
      else if (type === 'stream') sizePipe.xlen(key);
      else if (type === 'zset') sizePipe.zcard(key);
      else if (type === 'list') sizePipe.llen(key);
      else if (type === 'set') sizePipe.scard(key);
      else sizePipe.strlen(key);
    });
    const sizes = (await sizePipe.exec()) ?? [];

    return keys
      .map((key, i) => ({ key, type: types[i], ttl: ttls[i], size: Number(sizes[i]?.[1] ?? 0) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  async inspect(key: string, count = 10): Promise<InspectResult> {
    if (!key.startsWith(`${KEY_PREFIX}:`)) throw new InvalidKeyError('Sólo se pueden inspeccionar claves parking:*');
    assertReady(this.redis);
    const [type, ttl] = await Promise.all([this.redis.type(key), this.redis.ttl(key)]);
    switch (type) {
      case 'hash':
        return { key, type, ttl, command: `HGETALL ${key}`, value: await this.redis.hgetall(key) };
      case 'stream': {
        const entries = await this.redis.xrevrange(key, '+', '-', 'COUNT', count);
        return {
          key,
          type,
          ttl,
          command: `XREVRANGE ${key} + - COUNT ${count}`,
          value: entries.map(([id, fields]) => {
            const obj = fieldsToObject(fields);
            if (obj.payload) {
              try {
                obj.payload = JSON.parse(obj.payload);
              } catch {
                /* se deja como texto */
              }
            }
            return { id, fields: obj };
          }),
        };
      }
      case 'zset': {
        const raw = await this.redis.zrevrange(key, 0, count * 5 - 1, 'WITHSCORES');
        const members: Array<{ member: string; score: number }> = [];
        for (let i = 0; i < raw.length; i += 2) members.push({ member: raw[i], score: Number(raw[i + 1]) });
        return { key, type, ttl, command: `ZREVRANGE ${key} 0 ${count * 5 - 1} WITHSCORES`, value: members };
      }
      case 'string':
        return { key, type, ttl, command: `GET ${key}`, value: await this.redis.get(key) };
      case 'list':
        return {
          key,
          type,
          ttl,
          command: `LRANGE ${key} 0 ${count - 1}`,
          value: await this.redis.lrange(key, 0, count - 1),
        };
      case 'none':
        return { key, type, ttl, command: `EXISTS ${key}`, value: null };
      default:
        return { key, type, ttl, command: `TYPE ${key}`, value: null };
    }
  }

  /** PUBSUB NUMSUB: cuántos suscriptores tiene cada canal ahora mismo. */
  async pubsub(): Promise<Array<{ channel: string; subscribers: number }>> {
    assertReady(this.redis);
    const channels = Object.values(CHANNELS);
    const raw = (await this.redis.call('PUBSUB', 'NUMSUB', ...channels)) as Array<string | number>;
    const out: Array<{ channel: string; subscribers: number }> = [];
    for (let i = 0; i < raw.length; i += 2) out.push({ channel: String(raw[i]), subscribers: Number(raw[i + 1]) });
    return out;
  }
}
