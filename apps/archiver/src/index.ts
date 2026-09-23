import { join } from 'node:path';
import {
  KEYS,
  SERVICES,
  STREAM_GROUPS,
  fieldsToObject,
  hashToZoneState,
  parseAlert,
  parseStreamEntry,
  type Alert,
  type ZoneState,
} from '@uptc/shared';
import {
  createLogger,
  createRedis,
  envNumber,
  envOptional,
  envString,
  findProjectRoot,
  isReady,
  loadEnv,
  loadZones,
  onShutdown,
  startHeartbeat,
  waitForReady,
} from '@uptc/shared/node';
import { ArchiveRepository, type ArchivedEvent } from './archive-repository';

/**
 * ARCHIVER — Redis Streams (consumer group) → PostgreSQL.
 *
 *   XGROUP CREATE parking:stream archiver 0 MKSTREAM
 *   XREADGROUP GROUP archiver <consumer> COUNT 200 BLOCK 5000 STREAMS parking:stream parking:alerts:stream > >
 *   INSERT … ON CONFLICT DO NOTHING   →   XACK
 *
 * A diferencia de Pub/Sub, si este servicio se detiene los eventos NO se pierden: quedan en el
 * Stream (lag del grupo) y se archivan al volver. Las entradas leídas pero no confirmadas (PEL)
 * se reintentan al iniciar.
 */
loadEnv();
const logger = createLogger('archiver');
const zones = loadZones();
const databaseUrl = envOptional('DATABASE_URL');
const consumer = envString('ARCHIVER_CONSUMER', 'archiver-1');
const snapshotIntervalMs = envNumber('ARCHIVE_SNAPSHOT_INTERVAL_MS', 60_000);
const retentionDays = envNumber('ARCHIVE_RETENTION_DAYS', 30);
const schemaPath = envString('SCHEMA_PATH', join(findProjectRoot(), 'db', 'schema.sql'));
const STREAMS = [KEYS.stream, KEYS.alertsStream] as const;
const BATCH = 200;

const redis = createRedis('archiver', logger);
// XREADGROUP BLOCK ocupa la conexión: se usa una dedicada.
const reader = createRedis('archiver-reader', logger);

let repo: ArchiveRepository | null = null;
let postgresUp = false;
let stopping = false;
const stats = { events: 0, alerts: 0, snapshots: 0, batches: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureGroups(): Promise<void> {
  for (const stream of STREAMS) {
    try {
      await redis.xgroup('CREATE', stream, STREAM_GROUPS.ARCHIVER, '0', 'MKSTREAM');
      logger.info('Consumer group created', { stream, group: STREAM_GROUPS.ARCHIVER });
    } catch (error) {
      if (!(error as Error).message.includes('BUSYGROUP')) throw error;
    }
  }
}

async function connectPostgres(): Promise<boolean> {
  if (!repo) return false;
  try {
    await repo.ping();
    if (!postgresUp) {
      await repo.applySchema(schemaPath);
      await repo.upsertZones(zones);
      logger.info('PostgreSQL connected, schema ready', { zones: zones.length });
    }
    postgresUp = true;
  } catch (error) {
    if (postgresUp || stats.batches === 0) {
      logger.warn('PostgreSQL unavailable — events stay in parking:stream until it returns', {
        error: (error as Error).message,
      });
    }
    postgresUp = false;
  }
  return postgresUp;
}

type StreamReply = Array<[string, Array<[string, string[] | null]>]> | null;

async function handleBatch(reply: StreamReply): Promise<number> {
  if (!reply || !repo) return 0;
  let handled = 0;
  for (const [stream, entries] of reply) {
    if (!entries.length) continue;
    const ids = entries.map(([id]) => id);
    if (stream === KEYS.stream) {
      const events: ArchivedEvent[] = [];
      for (const [id, fields] of entries) {
        if (!fields) continue; // entrada recortada por MAXLEN antes de archivarse
        const parsed = parseStreamEntry([id, fields]);
        if (parsed) events.push({ streamId: id, event: parsed.event });
      }
      stats.events += await repo.insertEvents(events);
    } else {
      const alerts: Alert[] = [];
      for (const [, fields] of entries) {
        const alert = fields ? parseAlert(fieldsToObject(fields).payload) : null;
        if (alert) alerts.push(alert);
      }
      stats.alerts += await repo.upsertAlerts(alerts);
    }
    // Confirmación sólo después de escribir en PostgreSQL.
    await redis.xack(stream, STREAM_GROUPS.ARCHIVER, ...ids);
    handled += entries.length;
  }
  if (handled) stats.batches++;
  return handled;
}

async function drainPending(): Promise<void> {
  // "0" = entradas entregadas a este consumidor pero sin XACK (p. ej. tras una caída).
  for (;;) {
    const reply = (await reader.xreadgroup(
      'GROUP',
      STREAM_GROUPS.ARCHIVER,
      consumer,
      'COUNT',
      BATCH,
      'STREAMS',
      ...STREAMS,
      '0',
      '0',
    )) as StreamReply;
    const handled = await handleBatch(reply);
    if (!handled) break;
    logger.info('Pending entries archived after restart', { entries: handled });
  }
}

async function consumeLoop(): Promise<void> {
  let pendingDrained = false;
  while (!stopping) {
    if (!isReady(redis) || !isReady(reader)) {
      await sleep(1000);
      continue;
    }
    if (!postgresUp && !(await connectPostgres())) {
      await sleep(5000);
      continue;
    }
    try {
      if (!pendingDrained) {
        await drainPending();
        pendingDrained = true;
      }
      const reply = (await reader.xreadgroup(
        'GROUP',
        STREAM_GROUPS.ARCHIVER,
        consumer,
        'COUNT',
        BATCH,
        'BLOCK',
        5000,
        'STREAMS',
        ...STREAMS,
        '>',
        '>',
      )) as StreamReply;
      const handled = await handleBatch(reply);
      if (handled) logger.debug('Archived batch', { entries: handled });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('NOGROUP')) {
        await ensureGroups();
        continue;
      }
      logger.warn('Archive batch failed — will retry', { error: message });
      postgresUp = false;
      pendingDrained = false;
      await sleep(3000);
    }
  }
}

async function takeSnapshot(): Promise<void> {
  if (!repo || !postgresUp || !isReady(redis)) return;
  const pipeline = redis.pipeline();
  for (const zone of zones) pipeline.hgetall(KEYS.zone(zone.id));
  const states = ((await pipeline.exec()) ?? [])
    .map(([, v]) => hashToZoneState(v as Record<string, string>))
    .filter((z): z is ZoneState => z !== null);
  try {
    stats.snapshots += await repo.insertSnapshots(states);
    logger.info('Zone snapshot archived', { zones: states.length });
  } catch (error) {
    logger.warn('Snapshot failed', { error: (error as Error).message });
  }
}

async function purge(): Promise<void> {
  if (!repo || !postgresUp) return;
  try {
    const removed = await repo.purgeOlderThan(retentionDays);
    if (removed.events || removed.snapshots || removed.alerts) {
      logger.info('Retention purge', { days: retentionDays, ...removed });
    }
  } catch (error) {
    logger.warn('Retention purge failed', { error: (error as Error).message });
  }
}

async function main() {
  await waitForReady(redis);
  await ensureGroups();

  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set — archiver idle (Redis keeps working without PostgreSQL)');
  } else {
    repo = new ArchiveRepository(databaseUrl);
    repo.pool.on('error', (error) => logger.warn('PostgreSQL pool error', { error: error.message }));
    await connectPostgres();
  }

  startHeartbeat(redis, SERVICES.ARCHIVER, logger, () => ({
    postgres: !databaseUrl ? 'not-configured' : postgresUp ? 'connected' : 'disconnected',
    consumer,
    events_archived: stats.events,
    alerts_archived: stats.alerts,
    snapshots: stats.snapshots,
    retention_days: retentionDays,
  }));

  let reported = { events: 0, alerts: 0 };
  const report = () => {
    if (stats.events === reported.events && stats.alerts === reported.alerts) return;
    logger.info('Archived to PostgreSQL', {
      new_events: stats.events - reported.events,
      new_alerts: stats.alerts - reported.alerts,
      total_events: stats.events,
      total_alerts: stats.alerts,
    });
    reported = { events: stats.events, alerts: stats.alerts };
  };
  const timers = [
    setInterval(() => void takeSnapshot(), snapshotIntervalMs),
    setInterval(() => void purge(), 3_600_000),
    setInterval(report, 15_000),
  ];
  void purge();

  onShutdown(logger, async () => {
    stopping = true;
    timers.forEach(clearInterval);
    reader.disconnect();
    await Promise.allSettled([redis.quit(), repo?.close()]);
  });

  if (repo) await consumeLoop();
}

main().catch((error: Error) => {
  logger.error('Archiver crashed', { error: error.message });
  process.exit(1);
});
