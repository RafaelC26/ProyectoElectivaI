/**
 * Pruebas de integración contra un Redis real (secciones 126–132).
 *   npm run test:integration   → levanta un Redis desechable en el puerto 6380 y ejecuta la suite
 * No se usa el Redis del sistema: los canales Pub/Sub son globales a toda la instancia
 * (no dependen del número de base de datos) y el Processor en ejecución recibiría los eventos.
 * Si no hay Redis en REDIS_TEST_PORT, la suite se omite.
 */
process.env.LOG_LEVEL = 'error';

import {
  CHANNELS,
  KEYS,
  NULL_LOCATION,
  SCHEMA_VERSION,
  calculateOccupancy,
  parseAlert,
  parseStreamEntry,
  type SensorEvent,
} from '@uptc/shared';
import { createLogger, loadThresholds, loadZones } from '@uptc/shared/node';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertService } from '../../apps/processor/src/alerts/alert-service';
import { SampleHistory } from '../../apps/processor/src/metrics/sample-history';
import { EventProcessor } from '../../apps/processor/src/processor/event-processor';
import { SerialQueue } from '../../apps/processor/src/processor/serial-queue';
import { StateRepository } from '../../apps/processor/src/redis/state-repository';
import { EventSubscriber } from '../../apps/processor/src/subscriber/event-subscriber';
import { PublisherService } from '../../apps/publisher/src/publisher/publisher.service';

const options = {
  host: process.env.REDIS_TEST_HOST ?? 'localhost',
  port: Number(process.env.REDIS_TEST_PORT ?? 6380),
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
  lazyConnect: true,
};

async function probe(): Promise<boolean> {
  const client = new Redis(options);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const redisAvailable = await probe();
const logger = createLogger('test');
const zones = loadZones();
const thresholds = loadThresholds();
const clients: Redis[] = [];

function connect(): Redis {
  const client = new Redis({ ...options, lazyConnect: false });
  clients.push(client);
  return client;
}

let seq = 0;
function event(zoneId: string, occupied: number, type: SensorEvent['event_type'] = 'VEHICLE_ENTERED'): SensorEvent {
  const zone = zones.find((z) => z.id === zoneId)!;
  seq++;
  return {
    event_id: `evt_${String(seq).padStart(6, '0')}`,
    event_type: type,
    entity_id: zoneId,
    timestamp: new Date().toISOString(),
    location: { ...NULL_LOCATION },
    data: {
      vehicle_type: zone.vehicleType,
      zone_name: zone.name,
      capacity: zone.capacity,
      occupied,
      available: zone.capacity - occupied,
      occupancy: calculateOccupancy(occupied, zone.capacity),
    },
    metadata: {
      source: 'SIMULATOR',
      schema_version: SCHEMA_VERSION,
      generated_at: Date.now(),
      simulated_time: '10:00',
    },
  };
}

function processorFor(redis: Redis) {
  const repo = new StateRepository(redis, zones, { streamMaxLength: 10_000, timeseriesMaxLength: 1000 });
  const alerts = new AlertService(redis, thresholds, logger, 1000);
  const processor = new EventProcessor({ repo, alerts, history: new SampleHistory(), zones, thresholds, logger });
  return { repo, alerts, processor };
}

describe.skipIf(!redisAvailable)('Redis — integración del pipeline', () => {
  const redis = redisAvailable ? connect() : (null as unknown as Redis);

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis?.flushdb();
    for (const client of clients) client.disconnect();
  });

  it('Pub/Sub: Publisher → Redis → Subscriber (sección 126)', async () => {
    const subscriber = connect();
    const received = new Promise<SensorEvent>((resolve) => {
      subscriber.on('message', (_channel: string, raw: string) => resolve(JSON.parse(raw)));
    });
    await subscriber.subscribe(CHANNELS.PARKING_EVENTS);

    const publisher = new PublisherService(redis, logger, 10_000);
    const sent = event('CARS-A', 12);
    const { streamId, receivers } = await publisher.publishSensorEvent(sent);

    const message = await received;
    expect(receivers).toBe(1);
    expect(message.event_id).toBe(sent.event_id);
    expect(message.event_type).toBe('VEHICLE_ENTERED');
    expect(message.metadata.stream_id).toBe(streamId);
    await subscriber.quit();
  });

  it('Stream: el evento queda en parking:stream y el crecimiento se limita con MAXLEN ~ (secciones 50, 127)', async () => {
    const publisher = new PublisherService(redis, logger, 100);
    const first = event('CARS-B', 5);
    await publisher.publishSensorEvent(first);
    const range = await redis.xrange(KEYS.stream, '-', '+');
    expect(parseStreamEntry(range[0])?.event.event_id).toBe(first.event_id);

    for (let i = 0; i < 400; i++) await publisher.publishSensorEvent(event('CARS-B', 5));
    const length = await redis.xlen(KEYS.stream);
    expect(length).toBeGreaterThanOrEqual(100);
    expect(length).toBeLessThan(401); // recorte aproximado: nunca crece indefinidamente
  });

  it('Hash + Sorted Set + alertas + TTL: secuencia 77.5 → 82.5 → 91.25 → 100 → 75 % (secciones 128, 129, 131)', async () => {
    const { repo, processor } = processorFor(redis);
    await repo.initializeZones(thresholds);

    for (const occupied of [62, 66, 73, 80]) await processor.process(event('MOTOS-02', occupied), { replayed: false });

    // Estado actual: HGETALL parking:zone:MOTOS-02
    const hash = await redis.hgetall(KEYS.zone('MOTOS-02'));
    expect(hash).toMatchObject({
      occupied: '80',
      available: '0',
      occupancy: '100',
      status: 'FULL',
      vehicle_type: 'MOTORCYCLE',
    });

    // Ranking: ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES
    const top = await redis.zrevrange(KEYS.ranking, 0, 0, 'WITHSCORES');
    expect(top).toEqual(['MOTOS-02', '100']);

    const active = (await redis.hvals(KEYS.alertsActive)).map(parseAlert);
    expect(active.map((a) => a?.type)).toContain('PARKING_FULL');
    expect(active.filter((a) => a?.type === 'HIGH_OCCUPANCY')).toHaveLength(0); // escalada: sin duplicados

    await processor.process(event('MOTOS-02', 60, 'VEHICLE_EXITED'), { replayed: false });
    expect(await redis.hlen(KEYS.alertsActive)).toBe(0);

    // Historial de alertas y eventos derivados en los Streams
    const alertLog = (await redis.xrange(KEYS.alertsStream, '-', '+')).map(([, f]) => `${f[1]}:${f[7]}`);
    expect(alertLog).toEqual(
      expect.arrayContaining([
        'RAISED:OCCUPANCY_WARNING',
        'RAISED:HIGH_OCCUPANCY',
        'RAISED:PARKING_FULL',
        'RESOLVED:PARKING_FULL',
      ]),
    );
    const derived = (await redis.xrange(KEYS.stream, '-', '+')).map((e) => parseStreamEntry(e)?.event.event_type);
    expect(derived).toEqual(
      expect.arrayContaining([
        'OCCUPANCY_WARNING',
        'OCCUPANCY_CRITICAL',
        'PARKING_FULL',
        'PARKING_AVAILABLE',
        'ZONE_RECOVERED',
      ]),
    );

    // TTL: cooldown tras la recuperación y ventanas deslizantes
    const cooldownTtl = await redis.ttl(KEYS.alertCooldown('MOTOS-02', 'OCCUPANCY'));
    expect(cooldownTtl).toBeGreaterThan(0);
    expect(cooldownTtl).toBeLessThanOrEqual(thresholds.alertCooldownSeconds);
    expect(await redis.ttl(KEYS.windowEntries('MOTOS-02'))).toBeGreaterThan(0);

    // Métricas agregadas
    const metrics = await redis.hgetall(KEYS.metricsMotorcycles);
    expect(metrics.scope).toBe('MOTORCYCLE');
  });

  it('Subscriber desconectado: Pub/Sub pierde los mensajes, parking:stream los conserva y se recuperan (sección 132)', async () => {
    const { repo, processor } = processorFor(redis);
    await repo.initializeZones(thresholds);
    const publisher = new PublisherService(redis, logger, 10_000);

    // 1. El Processor alcanza a procesar un evento y guarda su checkpoint.
    const firstEvent = event('CARS-C', 10);
    const first = await publisher.publishSensorEvent(firstEvent);
    await processor.process(
      { ...firstEvent, metadata: { ...firstEvent.metadata, stream_id: first.streamId } },
      { replayed: false },
    );

    // 2. El Subscriber está caído: nadie recibe los mensajes Pub/Sub.
    const missed = [];
    for (const occupied of [11, 12, 13, 14]) missed.push(await publisher.publishSensorEvent(event('CARS-C', occupied)));
    expect(missed.every((r) => r.receivers === 0)).toBe(true);
    expect(await redis.hget(KEYS.zone('CARS-C'), 'occupied')).toBe('10');

    // 3. Al volver, el Subscriber lee parking:stream desde el checkpoint y recupera lo perdido.
    const fresh = processorFor(redis);
    fresh.processor.lastProcessedId = (await fresh.repo.getCheckpoint())!;
    const subscriber = new EventSubscriber(connect(), fresh.repo, new SerialQueue(logger), fresh.processor, logger);
    await subscriber.start();

    expect(subscriber.recovered).toBe(4);
    expect(await redis.hget(KEYS.zone('CARS-C'), 'occupied')).toBe('14');
    expect(await redis.get(KEYS.processorCheckpoint)).toBe(missed[missed.length - 1].streamId);
  });
});
