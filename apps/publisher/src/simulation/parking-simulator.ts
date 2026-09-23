import type {
  MovementKind,
  ScenarioName,
  SimulationConfig,
  SimulationMode,
  SimulatorState,
  SimulatorStatus,
  ZoneConfig,
  ZoneScenarioState,
} from '@uptc/shared';
import { resolveProfile, type ActiveProfile } from './demand-profile';
import { Random } from './random';
import { ScenarioManager, type ScenarioTransition } from './scenario-manager';
import { SimulatedClock } from './sim-clock';
import { ZoneSimulator, type RawSensorReading } from './zone-simulator';

export interface PlannedMovement {
  zoneId: string;
  kind: MovementKind;
  /** Desfase (ms) dentro del ciclo en que el sensor detecta el movimiento. */
  offsetMs: number;
  manual?: boolean;
}

export interface TickPlan {
  tick: number;
  simulatedTime: string;
  newDay: boolean;
  profile: ActiveProfile;
  movements: PlannedMovement[];
  transitions: ScenarioTransition[];
}

export interface SimulatorOptions {
  zones: ZoneConfig[];
  config: SimulationConfig;
  mode: SimulationMode;
  intervalMs: number;
  startTime: string;
  timeZone: string;
  seed: number;
}

/** Estado persistido en Redis para reanudar la simulación tras un reinicio del Publisher. */
export interface RestorableState {
  mode?: SimulationMode;
  speed?: number;
  status?: SimulatorStatus;
  simMinute?: number;
  simDay?: number;
  ticks?: number;
  globalScenario?: ScenarioName;
  zoneScenarios?: Record<string, ZoneScenarioState>;
  occupancy: Record<string, number>;
}

/**
 * Simulador de sensores de estacionamiento.
 * No genera valores aleatorios independientes: cada zona conserva su ocupación y cada ciclo
 * aplica occupied(t+1) = occupied(t) + entradas − salidas según el perfil de demanda
 * de la hora simulada y el escenario activo.
 */
export class ParkingSimulator {
  readonly zones = new Map<string, ZoneSimulator>();
  readonly clock: SimulatedClock;
  readonly scenarios: ScenarioManager;
  private readonly rng: Random;

  status: SimulatorStatus = 'RUNNING';
  speed = 1;
  ticks = 0;
  eventsPublished = 0;
  readonly startedAt = new Date().toISOString();

  constructor(private readonly opts: SimulatorOptions) {
    this.rng = new Random(opts.seed);
    this.clock = new SimulatedClock(
      opts.mode,
      opts.startTime,
      opts.config.accelerated.dayStart,
      opts.config.accelerated.dayEnd,
      opts.timeZone,
    );
    this.scenarios = new ScenarioManager(opts.config, this.rng);
    for (const zone of opts.zones) this.zones.set(zone.id, new ZoneSimulator(zone, this.initialOccupancy(zone)));
  }

  get mode(): SimulationMode {
    return this.clock.mode;
  }

  get intervalMs(): number {
    return this.opts.intervalMs;
  }

  /** La velocidad x1/x2/x5 acorta el intervalo real entre ciclos. */
  get effectiveIntervalMs(): number {
    return Math.max(250, Math.round(this.opts.intervalMs / this.speed));
  }

  /** Minutos simulados que representa un ciclo. */
  get simMinutesPerTick(): number {
    const realMinutes = this.opts.intervalMs / 60_000;
    return this.mode === 'ACCELERATED_DEMO' ? realMinutes * this.opts.config.accelerated.timeScale : realMinutes;
  }

  currentProfile(): ActiveProfile {
    return resolveProfile(this.opts.config.schedule, this.clock.minuteOfDay());
  }

  /** Planifica un ciclo completo: avanza el reloj y decide entradas/salidas de cada zona. */
  tick(): TickPlan {
    this.ticks += 1;
    const newDay = this.clock.advance(this.simMinutesPerTick);
    const profile = this.currentProfile();
    const interval = this.effectiveIntervalMs;
    const movements: PlannedMovement[] = [];
    const transitions: ScenarioTransition[] = [];

    for (const zone of this.zones.values()) {
      const { plan, transition } = this.scenarios.plan(zone, profile, this.simMinutesPerTick);
      if (transition) transitions.push(transition);
      const span = plan.burst ? interval * 0.35 : interval * 0.9;
      const offsets = plan.kinds.map(() => Math.floor(this.rng.next() * span)).sort((a, b) => a - b);
      plan.kinds.forEach((kind, i) => movements.push({ zoneId: zone.config.id, kind, offsetMs: offsets[i] }));
    }

    movements.sort((a, b) => a.offsetMs - b.offsetMs);
    return { tick: this.ticks, simulatedTime: this.clock.label(), newDay, profile, movements, transitions };
  }

  /**
   * El sensor detecta el movimiento: se aplica sobre el estado ACTUAL de la zona
   * (entrada en zona llena o salida en zona vacía se descartan).
   */
  apply(movement: PlannedMovement, now = Date.now()): RawSensorReading | null {
    const zone = this.zones.get(movement.zoneId);
    if (!zone) return null;
    const count = zone.apply(movement.kind, now);
    if (count === null) return null;
    const direction = movement.kind === 'ENTRY' ? 'IN' : 'OUT';
    return {
      sensorId: `sns-${zone.config.id.toLowerCase()}-${direction.toLowerCase()}`,
      zoneId: zone.config.id.toLowerCase(),
      direction,
      count,
      capacity: zone.capacity,
      detectedAt: now,
      simClock: this.clock.label(),
      window: zone.windowCounts(now),
      scenario: this.scenarios.scenarioFor(zone.config.id),
      manual: movement.manual ?? false,
    };
  }

  /** Movimientos manuales (panel de simulación → "Forzar entrada/salida"). */
  forced(zoneId: string, kind: MovementKind, count: number): PlannedMovement[] {
    return Array.from({ length: count }, (_, i) => ({ zoneId, kind, offsetMs: i * 60, manual: true }));
  }

  setMode(mode: SimulationMode): void {
    this.clock.mode = mode;
  }

  reset(): void {
    this.clock.reset();
    this.scenarios.reset();
    this.ticks = 0;
    for (const zone of this.zones.values()) zone.set(this.initialOccupancy(zone.config));
  }

  restore(state: RestorableState): void {
    for (const [id, occupied] of Object.entries(state.occupancy)) this.zones.get(id)?.set(occupied);
    if (state.mode) this.clock.mode = state.mode;
    if (state.speed && [1, 2, 5].includes(state.speed)) this.speed = state.speed;
    if (state.status === 'PAUSED') this.status = 'PAUSED';
    if (state.simMinute !== undefined && state.simDay !== undefined) this.clock.restore(state.simMinute, state.simDay);
    if (state.ticks) this.ticks = state.ticks;
    if (state.globalScenario) {
      this.scenarios.restore(state.globalScenario, state.zoneScenarios ?? {}, new Set(this.zones.keys()));
    }
  }

  snapshot(): SimulatorState & { sim_minute: number } {
    return {
      status: this.status,
      mode: this.mode,
      speed: this.speed,
      interval_ms: this.opts.intervalMs,
      effective_interval_ms: this.effectiveIntervalMs,
      simulated_time: this.clock.label(),
      simulated_day: this.clock.day,
      sim_minute: this.clock.rawMinute(),
      profile: this.currentProfile().profile,
      global_scenario: this.scenarios.global,
      zone_scenarios: this.scenarios.snapshot(),
      ticks: this.ticks,
      events_published: this.eventsPublished,
      started_at: this.startedAt,
      updated_at: new Date().toISOString(),
    };
  }

  private initialOccupancy(zone: ZoneConfig): number {
    const { min, max } = this.opts.config.initialOccupancy;
    return Math.round(zone.capacity * this.rng.between(min, max));
  }
}
