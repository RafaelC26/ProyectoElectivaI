import {
  CHANNELS,
  LABELS,
  round2,
  streamIdGreaterThan,
  type AlertChange,
  type MetricsSnapshot,
  type ProcessedMessage,
  type SensorEvent,
  type Thresholds,
  type ZoneConfig,
  type ZoneEvent,
  type ZoneState,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { AlertService } from '../alerts/alert-service';
import { computeMetrics } from '../metrics/metrics-calculator';
import { zoneSelector, type SampleHistory } from '../metrics/sample-history';
import type { StateRepository } from '../redis/state-repository';
import { buildDerivedEvent, deriveAlertEvents, deriveStatusEvents } from './derived-events';
import { calculateState } from './zone-state';

export interface ProcessorDeps {
  repo: StateRepository;
  alerts: AlertService;
  history: SampleHistory;
  zones: ZoneConfig[];
  thresholds: Thresholds;
  logger: Logger;
}

/**
 * PROCESSOR — por cada evento de sensor:
 *   1. valida (lo hace el Subscriber con Zod antes de encolarlo)
 *   2. obtiene el estado anterior           HGETALL parking:zone:<id>
 *   3. calcula el estado actual             ocupación, disponibles, estado, tendencia…
 *   4. agrega al histórico                  ventanas (ZADD) + eventos derivados (XADD parking:stream)
 *   5. actualiza el ranking                 ZADD parking:ranking:occupancy
 *   6. evalúa alertas                       máquina de estados + TTL de cooldown
 *   7. calcula métricas globales            HSET parking:metrics:*
 *   8. publica la actualización procesada   PUBLISH parking-updates / parking-alerts
 */
export class EventProcessor {
  lastProcessedId = '0-0';
  processed = 0;
  duplicates = 0;
  resyncs = 0;
  avgProcessingMs = 0;
  lastEventId = '';
  private readonly zoneById: Map<string, ZoneConfig>;
  /** Momento en que cada zona recibió su primera lectura (calibración desde el estado INIT). */
  private readonly calibratedAt = new Map<string, number>();

  constructor(private readonly deps: ProcessorDeps) {
    this.zoneById = new Map(deps.zones.map((z) => [z.id, z]));
  }

  async process(event: SensorEvent, opts: { replayed: boolean }): Promise<void> {
    const { repo, alerts, history, thresholds, logger } = this.deps;
    const streamId = event.metadata.stream_id;
    if (streamId && !streamIdGreaterThan(streamId, this.lastProcessedId)) {
      this.duplicates++;
      return; // ya procesado (llegó por Pub/Sub y también por la recuperación desde el Stream)
    }
    const zone = this.zoneById.get(event.entity_id);
    if (!zone) {
      logger.warn('Event for unknown zone ignored', { event_id: event.event_id, zone: event.entity_id });
      return;
    }

    const started = performance.now();
    const eventTs = event.metadata.generated_at;
    const kind = event.event_type === 'VEHICLE_ENTERED' ? 'ENTRY' : 'EXIT';
    if (opts.replayed) event.metadata.replayed = true;

    // 2. estado anterior
    const previous = await repo.getZone(zone.id);
    // 4a. ventana deslizante de entradas/salidas
    const windows = await repo.recordMovement(zone.id, kind, event.event_id, eventTs, Date.now());
    // 3. estado actual
    const processedAt = Date.now();
    const { state, gap } = calculateState(previous, event, {
      zone,
      thresholds,
      windows,
      history,
      processedAt: new Date(processedAt).toISOString(),
    });
    if (previous?.last_event === 'INIT') {
      this.calibratedAt.set(zone.id, eventTs);
      logger.info('Zone calibrated from first sensor reading', { zone: zone.id, occupied: state.occupied });
    } else if (previous && gap !== 0) {
      this.resyncs++;
      logger.warn('Occupancy resynchronized from absolute sensor count', {
        zone: zone.id,
        expected: previous.occupied + (kind === 'ENTRY' ? 1 : -1),
        reported: state.occupied,
      });
    }

    // 6. alertas de la zona (antes de guardar, para derivar ZONE_RECOVERED)
    const { changes, recovered } = await alerts.evaluateZone(
      state,
      this.unusualIncrease(state, eventTs),
      event.timestamp,
    );
    const derivedTypes = [...deriveStatusEvents(previous, state), ...deriveAlertEvents(changes, recovered)];
    const ids = await repo.nextEventIds(derivedTypes.length);
    const derived: ZoneEvent[] = derivedTypes.map((type, i) =>
      buildDerivedEvent(type, ids[i], state, event, processedAt),
    );

    // 4b + 5. HSET estado · ZADD ranking · XADD derivados · checkpoint
    const elapsed = performance.now() - started;
    await repo.saveProcessed({ state, derived, kind, streamId, processingMs: elapsed });
    if (streamId) this.lastProcessedId = streamId;

    // 7. métricas globales (lee todas las zonas y el Sorted Set)
    const [allZones, ranking] = await Promise.all([repo.getAllZones(), repo.getRanking()]);
    const groupChanges = await alerts.evaluateGroups(allZones, event.timestamp);
    const metrics = computeMetrics(allZones, ranking, history, thresholds, eventTs);
    await repo.saveMetrics(metrics);

    const processingMs = performance.now() - started;
    this.processed++;
    this.lastEventId = event.event_id;
    this.avgProcessingMs = this.avgProcessingMs === 0 ? processingMs : this.avgProcessingMs * 0.9 + processingMs * 0.1;

    for (const d of derived) this.logDerived(d, state);
    logger.info(`Processed ${event.event_id}`, {
      type: event.event_type,
      zone: zone.id,
      occupied: `${state.occupied}/${state.capacity}`,
      occupancy: state.occupancy,
      status: state.status,
      trend: state.trend,
      ms: round2(processingMs),
      ...(opts.replayed ? { replayed: true } : {}),
    });

    // 8. publicar (durante la recuperación sólo se publica un RESYNC al final)
    if (!opts.replayed) {
      const message: ProcessedMessage = {
        type: 'ZONE_UPDATE',
        event: { ...event, metadata: { ...event.metadata, processed_at: Date.now() } },
        zone: state,
        derived_events: derived,
        metrics,
        alerts: [...changes, ...groupChanges] satisfies AlertChange[],
        processed_at: Date.now(),
      };
      await repo.publish(CHANNELS.PARKING_UPDATES, message);
    }
  }

  /** Incremento de ocupación dentro de la ventana de "crecimiento inusual". */
  unusualIncrease(state: ZoneState, at: number): number | null {
    const since = at - this.deps.thresholds.unusualIncreaseWindowSeconds * 1000;
    // El salto de 0 a la primera lectura real no es un crecimiento inusual.
    if ((this.calibratedAt.get(state.zone_id) ?? 0) > since) return null;
    const min = this.deps.history.min(zoneSelector(state.zone_id), since);
    if (min === null) return null;
    return round2(state.occupancy - min);
  }

  async publishResync(reason: string, recovered: number): Promise<MetricsSnapshot> {
    const { repo, history, thresholds } = this.deps;
    const [zones, ranking] = await Promise.all([repo.getAllZones(), repo.getRanking()]);
    const metrics = computeMetrics(zones, ranking, history, thresholds, Date.now());
    await repo.saveMetrics(metrics);
    const message: ProcessedMessage = { type: 'RESYNC', reason, recovered_events: recovered, zones, metrics };
    await repo.publish(CHANNELS.PARKING_UPDATES, message);
    return metrics;
  }

  private logDerived(event: ZoneEvent, state: ZoneState): void {
    const { logger } = this.deps;
    const ctx = { zone: state.zone_id, event_id: event.event_id, occupancy: state.occupancy };
    switch (event.event_type) {
      case 'ZONE_STATUS_CHANGED':
        logger.info(`${state.zone_id} status ${state.previous_status} → ${state.status}`, ctx);
        break;
      case 'OCCUPANCY_WARNING':
      case 'OCCUPANCY_CRITICAL':
        logger.warn(`${state.zone_id} occupancy reached ${state.occupancy}% (${LABELS.status[state.status]})`, ctx);
        break;
      case 'PARKING_FULL':
        logger.warn(`${state.zone_id} PARKING_FULL ${state.occupied}/${state.capacity}`, ctx);
        break;
      default:
        logger.info(`${event.event_type} ${state.zone_id}`, ctx);
    }
  }
}
