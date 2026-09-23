import {
  CHANNELS,
  KEYS,
  SCENARIOS,
  SIMULATION_MODES,
  eventToStreamFields,
  formatEventId,
  type ScenarioName,
  type SensorEvent,
  type SimulationMode,
  type SimulatorState,
  type SimulatorStatus,
  type SystemEvent,
  type ZoneConfig,
  type ZoneScenarioState,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { Redis } from 'ioredis';
import type { RestorableState } from '../simulation/parking-simulator';

export interface PublishResult {
  streamId: string;
  /** Número de suscriptores conectados que recibieron el mensaje Pub/Sub. */
  receivers: number;
}

/**
 * PUBLICACIÓN en Redis. Cada evento se escribe en dos mecanismos complementarios:
 *   1. XADD parking:stream MAXLEN ~ N  → queda en el histórico reciente (aunque nadie escuche)
 *   2. PUBLISH parking-events <JSON>   → llega de inmediato a los suscriptores conectados
 */
export class PublisherService {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly streamMaxLength: number,
  ) {}

  async nextEventId(): Promise<string> {
    return formatEventId(await this.redis.incr(KEYS.seqEvent));
  }

  async publishSensorEvent(event: SensorEvent): Promise<PublishResult> {
    return this.publish(CHANNELS.PARKING_EVENTS, event);
  }

  async publishSystemEvent(event: SystemEvent): Promise<PublishResult> {
    return this.publish(CHANNELS.SYSTEM_EVENTS, event);
  }

  private async publish(channel: string, event: SensorEvent | SystemEvent): Promise<PublishResult> {
    const streamId = await this.redis.xadd(
      KEYS.stream,
      'MAXLEN',
      '~',
      String(this.streamMaxLength),
      '*',
      ...eventToStreamFields(event),
    );
    if (!streamId) throw new Error('XADD no devolvió un ID');

    const message = { ...event, metadata: { ...event.metadata, stream_id: streamId } };
    const results = await this.redis
      .pipeline()
      .publish(channel, JSON.stringify(message))
      .hincrby(KEYS.statsSystem, 'events_published', 1)
      .exec();
    const receivers = Number(results?.[0]?.[1] ?? 0);
    return { streamId, receivers };
  }

  async saveState(state: SimulatorState & { sim_minute: number }): Promise<void> {
    await this.redis.hset(KEYS.simulatorState, {
      ...state,
      zone_scenarios: JSON.stringify(state.zone_scenarios),
    });
  }

  /**
   * Recupera el estado previo (reloj simulado, escenario y ocupación de cada zona) para
   * que un reinicio del Publisher no "teletransporte" los valores del estacionamiento.
   */
  async loadState(zones: ZoneConfig[]): Promise<RestorableState | null> {
    const [state, ...zoneHashes] = await Promise.all([
      this.redis.hgetall(KEYS.simulatorState),
      ...zones.map((z) => this.redis.hget(KEYS.zone(z.id), 'occupied')),
    ]);
    // Sin estado previo del simulador es un arranque limpio: se usa la ocupación inicial
    // configurada (los Hashes que el Processor crea al iniciar valen 0 y no son una medición).
    if (!state || Object.keys(state).length === 0) return null;
    const occupancy: Record<string, number> = {};
    zones.forEach((z, i) => {
      const value = zoneHashes[i];
      if (value !== null && value !== undefined) occupancy[z.id] = Number(value);
    });
    let zoneScenarios: Record<string, ZoneScenarioState> = {};
    try {
      zoneScenarios = JSON.parse(state.zone_scenarios ?? '{}');
    } catch {
      this.logger.warn('Ignoring corrupt zone_scenarios in simulator state');
    }
    return {
      occupancy,
      mode: (SIMULATION_MODES as readonly string[]).includes(state.mode) ? (state.mode as SimulationMode) : undefined,
      speed: Number(state.speed) || undefined,
      status: state.status as SimulatorStatus,
      simMinute: state.sim_minute !== undefined ? Number(state.sim_minute) : undefined,
      simDay: state.simulated_day !== undefined ? Number(state.simulated_day) : undefined,
      ticks: Number(state.ticks) || 0,
      globalScenario: (SCENARIOS as readonly string[]).includes(state.global_scenario)
        ? (state.global_scenario as ScenarioName)
        : 'NORMAL',
      zoneScenarios,
    };
  }
}
