import {
  CHANNELS,
  round2,
  type AlertChange,
  type ProcessedMessage,
  type Thresholds,
  type ZoneState,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { AlertService } from '../alerts/alert-service';
import type { EventProcessor } from '../processor/event-processor';
import { timeDependentFields } from '../processor/zone-state';
import type { StateRepository } from '../redis/state-repository';
import { computeMetrics } from './metrics-calculator';
import type { SampleHistory } from './sample-history';

/**
 * Cada METRICS_SAMPLE_INTERVAL_MS:
 *  - recalcula las ventanas 1/5/15 min de TODAS las zonas (aunque no tengan eventos nuevos)
 *  - actualiza tendencia, promedio y variación de cada zona
 *  - agrega una muestra a parking:timeseries (Stream) → alimenta las gráficas
 *  - revisa alertas dependientes del tiempo (crecimiento inusual, cooldowns vencidos)
 *  - publica METRICS_SAMPLE en parking-updates
 */
export class TimeseriesSampler {
  private lastProcessed = 0;
  private lastTs = Date.now();

  constructor(
    private readonly deps: {
      repo: StateRepository;
      alerts: AlertService;
      history: SampleHistory;
      processor: EventProcessor;
      thresholds: Thresholds;
      logger: Logger;
    },
  ) {}

  async sample(): Promise<void> {
    const { repo, alerts, history, processor, thresholds } = this.deps;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const [zones, windows] = await Promise.all([repo.getAllZones(), repo.windowCountsAll(now)]);
    const refreshed: ZoneState[] = [];
    for (const zone of zones) {
      const fields = timeDependentFields(
        zone.zone_id,
        zone.occupancy,
        zone.occupancy,
        windows[zone.zone_id],
        history,
        thresholds,
        now,
      );
      await repo.patchZone(zone.zone_id, fields);
      refreshed.push({ ...zone, ...fields });
    }

    const ranking = await repo.getRanking();
    const metrics = computeMetrics(refreshed, ranking, history, thresholds, now);
    const dt = Math.max(0.001, (now - this.lastTs) / 1000);
    const eventsPerSecond = round2((processor.processed - this.lastProcessed) / dt);
    this.lastProcessed = processor.processed;
    this.lastTs = now;

    const simulatedTime = refreshed.reduce(
      (latest, z) => (z.timestamp > latest.ts ? { ts: z.timestamp, sim: z.simulated_time } : latest),
      {
        ts: '',
        sim: '',
      },
    ).sim;

    const sample = {
      ts: now,
      simulated_time: simulatedTime,
      global: metrics.global.occupancy,
      cars: metrics.cars.occupancy,
      motorcycles: metrics.motorcycles.occupancy,
      zones: Object.fromEntries(refreshed.map((z) => [z.zone_id, z.occupancy])),
      entries_1m: metrics.global.entries_1m,
      exits_1m: metrics.global.exits_1m,
      entries_1m_cars: metrics.cars.entries_1m,
      exits_1m_cars: metrics.cars.exits_1m,
      entries_1m_motorcycles: metrics.motorcycles.entries_1m,
      exits_1m_motorcycles: metrics.motorcycles.exits_1m,
      events_per_second: eventsPerSecond,
    };
    const id = await repo.appendSample(sample);
    history.add({ id, ...sample });

    await repo.saveMetrics(metrics);
    await repo.setTemporaryMetric('events_per_second', eventsPerSecond, 10);
    await repo.setTemporaryMetric('avg_processing_ms', round2(processor.avgProcessingMs), 10);

    // Alertas que dependen del paso del tiempo.
    const changes: AlertChange[] = [];
    for (const zone of refreshed) {
      const result = await alerts.evaluateZone(zone, processor.unusualIncrease(zone, now), nowIso);
      changes.push(...result.changes);
    }
    changes.push(...(await alerts.evaluateGroups(refreshed, nowIso)));

    const message: ProcessedMessage = { type: 'METRICS_SAMPLE', sample: { id, ...sample }, metrics };
    await repo.publish(CHANNELS.PARKING_UPDATES, message);
    if (changes.length) this.deps.logger.debug('Time-based alert changes', { count: changes.length });
  }
}
