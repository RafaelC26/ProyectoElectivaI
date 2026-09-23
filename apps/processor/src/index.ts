import { SERVICES, round2 } from '@uptc/shared';
import {
  createLogger,
  createRedis,
  envNumber,
  isReady,
  loadEnv,
  loadThresholds,
  loadZones,
  onShutdown,
  startHeartbeat,
  waitForReady,
} from '@uptc/shared/node';
import { AlertService } from './alerts/alert-service';
import { SampleHistory } from './metrics/sample-history';
import { TimeseriesSampler } from './metrics/timeseries-sampler';
import { EventProcessor } from './processor/event-processor';
import { SerialQueue } from './processor/serial-queue';
import { StateRepository } from './redis/state-repository';
import { EventSubscriber } from './subscriber/event-subscriber';

loadEnv();
const logger = createLogger('processor');
const zones = loadZones();
const thresholds = loadThresholds();
const sampleIntervalMs = envNumber('METRICS_SAMPLE_INTERVAL_MS', 2000);

// Dos conexiones: una en modo suscriptor (SUBSCRIBE bloquea la conexión) y otra para comandos.
const redis = createRedis('processor', logger);
const subscriberConnection = createRedis('processor-subscriber', logger);

const repo = new StateRepository(redis, zones, {
  streamMaxLength: envNumber('STREAM_MAX_LENGTH', 10_000),
  timeseriesMaxLength: envNumber('TIMESERIES_MAX_LENGTH', 5000),
});
const alerts = new AlertService(redis, thresholds, logger.child('alerts'), envNumber('ALERTS_STREAM_MAX_LENGTH', 2000));
const history = new SampleHistory();
const queue = new SerialQueue(logger);
const processor = new EventProcessor({ repo, alerts, history, zones, thresholds, logger });
const subscriber = new EventSubscriber(subscriberConnection, repo, queue, processor, logger.child('subscriber'));
const sampler = new TimeseriesSampler({ repo, alerts, history, processor, thresholds, logger });

let samplerTimer: NodeJS.Timeout | undefined;

async function main() {
  await waitForReady(redis);

  const init = await repo.initializeZones(thresholds);
  logger.info('Zones initialized from config/zones.json', {
    zones: zones.length,
    created: init.created.join(',') || '-',
    updated: init.updated.join(',') || '-',
    removed: init.removed.join(',') || '-',
  });

  const samples = await repo.loadSamples(Date.now() - 16 * 60_000);
  history.load(samples);
  logger.info('Timeseries history loaded from parking:timeseries', { samples: samples.length });

  const checkpoint = await repo.getCheckpoint();
  processor.lastProcessedId = checkpoint ?? '0-0';
  logger.info('Processor checkpoint', { last_stream_id: processor.lastProcessedId });

  startHeartbeat(redis, SERVICES.PROCESSOR, logger, () => ({
    events_received: subscriber.received,
    events_processed: processor.processed,
    events_recovered: subscriber.recovered,
    events_invalid: subscriber.invalid,
    duplicates_skipped: processor.duplicates,
    resyncs: processor.resyncs,
    queue_pending: queue.pending,
    avg_processing_ms: round2(processor.avgProcessingMs),
    last_event_id: processor.lastEventId,
    last_stream_id: processor.lastProcessedId,
  }));

  await subscriber.start();

  samplerTimer = setInterval(() => {
    // Si hay una cola acumulada se omite la muestra para no competir con los eventos.
    if (!isReady(redis) || queue.pending > 25) return;
    void queue.push(() => sampler.sample());
  }, sampleIntervalMs);

  logger.info('Processor running', { sample_interval_ms: sampleIntervalMs });
}

onShutdown(logger, async () => {
  if (samplerTimer) clearInterval(samplerTimer);
  await Promise.race([queue.drain(), new Promise((r) => setTimeout(r, 3000))]);
  await Promise.allSettled([subscriberConnection.quit(), redis.quit()]);
});

main().catch((error: Error) => {
  logger.error('Processor crashed', { error: error.message });
  process.exit(1);
});
