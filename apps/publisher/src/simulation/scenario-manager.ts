import {
  LABELS,
  type MovementKind,
  type ScenarioName,
  type SimulationConfig,
  type ZoneScenarioState,
} from '@uptc/shared';
import type { ActiveProfile } from './demand-profile';
import type { Random } from './random';
import type { ZoneSimulator } from './zone-simulator';

export interface ZoneOverride {
  scenario: ScenarioName;
  remainingTicks: number | null;
}

export interface ScenarioTransition {
  zoneId: string | null;
  from: ScenarioName;
  to: ScenarioName;
  message: string;
}

export interface ZonePlan {
  /** Movimientos en orden cronológico. */
  kinds: MovementKind[];
  /** true → los movimientos se concentran al inicio del ciclo (ráfaga). */
  burst: boolean;
}

const GLOBAL_SCENARIOS: ScenarioName[] = ['NORMAL', 'HIGH_DEMAND'];

/**
 * Escenarios especiales forzables desde el panel de control.
 *  - NORMAL / HIGH_DEMAND pueden ser globales o por zona.
 *  - MASS_ENTRY / MASS_EXIT son ráfagas de N ciclos y luego vuelven solos al escenario global.
 *  - NEAR_FULL / FULL se mantienen hasta que se cambie el escenario.
 *  - RECOVERY genera salidas progresivas y termina solo al alcanzar la ocupación objetivo.
 */
export class ScenarioManager {
  global: ScenarioName = 'NORMAL';
  private overrides = new Map<string, ZoneOverride>();

  constructor(
    private readonly cfg: SimulationConfig,
    private readonly rng: Random,
  ) {}

  scenarioFor(zoneId: string): ScenarioName {
    return this.overrides.get(zoneId)?.scenario ?? this.global;
  }

  /** Aplica un escenario a una zona o a todas ('ALL'). Devuelve un texto descriptivo. */
  set(scenario: ScenarioName, target: string, zoneIds: string[]): string {
    const label = LABELS.scenario[scenario];
    if (target === 'ALL') {
      if (GLOBAL_SCENARIOS.includes(scenario)) {
        this.global = scenario;
        this.overrides.clear();
        return `Escenario global: ${label}`;
      }
      for (const id of zoneIds) this.overrides.set(id, this.newOverride(scenario));
      return `Escenario ${label} aplicado a todas las zonas`;
    }
    if (scenario === 'NORMAL' && this.global === 'NORMAL') {
      this.overrides.delete(target);
    } else {
      this.overrides.set(target, this.newOverride(scenario));
    }
    return `Escenario ${label} aplicado a ${target}`;
  }

  reset(): void {
    this.global = 'NORMAL';
    this.overrides.clear();
  }

  snapshot(): Record<string, ZoneScenarioState> {
    const out: Record<string, ZoneScenarioState> = {};
    for (const [id, o] of this.overrides) out[id] = { scenario: o.scenario, remaining_ticks: o.remainingTicks };
    return out;
  }

  restore(global: ScenarioName, overrides: Record<string, ZoneScenarioState>, validZones: Set<string>): void {
    this.global = GLOBAL_SCENARIOS.includes(global) ? global : 'NORMAL';
    this.overrides.clear();
    for (const [id, o] of Object.entries(overrides)) {
      if (validZones.has(id)) this.overrides.set(id, { scenario: o.scenario, remainingTicks: o.remaining_ticks });
    }
  }

  /** Planifica los movimientos de una zona para el próximo ciclo. */
  plan(
    zone: ZoneSimulator,
    profile: ActiveProfile,
    simMinutes: number,
  ): { plan: ZonePlan; transition?: ScenarioTransition } {
    const id = zone.config.id;
    const override = this.overrides.get(id);
    const scenario = override?.scenario ?? this.global;
    const cap = zone.capacity;
    const occ = zone.occupied;
    const s = this.cfg.scenarios;

    switch (scenario) {
      case 'MASS_ENTRY':
      case 'MASS_EXIT': {
        const params = scenario === 'MASS_ENTRY' ? s.MASS_ENTRY : s.MASS_EXIT;
        const perTick = Math.max(1, Math.ceil((params.fractionOfCapacity * cap) / params.ticks));
        const available = scenario === 'MASS_ENTRY' ? cap - occ : occ;
        const kind: MovementKind = scenario === 'MASS_ENTRY' ? 'ENTRY' : 'EXIT';
        const plan: ZonePlan = { kinds: Array(Math.min(perTick, available)).fill(kind), burst: true };
        const transition = this.consumeTick(id, override!, scenario);
        return { plan, transition };
      }

      case 'NEAR_FULL': {
        const { targetMin, targetMax, stepFraction } = s.NEAR_FULL;
        const minOcc = Math.ceil(targetMin * cap);
        const maxOcc = Math.min(cap - 1, Math.floor(targetMax * cap));
        const kinds: MovementKind[] = [];
        if (occ < minOcc) {
          const step = Math.max(1, Math.round(stepFraction * cap * this.rng.between(0.7, 1.3)));
          kinds.push(...Array(Math.min(step, maxOcc - occ)).fill('ENTRY'));
        } else if (occ > maxOcc) {
          kinds.push(...Array(occ - maxOcc).fill('EXIT'));
        } else {
          // Dentro de la banda 90–99 %: pequeñas oscilaciones sin llegar a 100 %.
          let projected = occ;
          const moves = this.rng.poisson(1.2);
          for (let i = 0; i < moves; i++) {
            if (this.rng.chance(0.5) && projected < maxOcc) {
              kinds.push('ENTRY');
              projected++;
            } else if (projected > minOcc) {
              kinds.push('EXIT');
              projected--;
            }
          }
        }
        return { plan: { kinds, burst: false } };
      }

      case 'FULL': {
        if (occ < cap) {
          const step = Math.max(1, Math.round(s.FULL.stepFraction * cap * this.rng.between(0.8, 1.2)));
          return { plan: { kinds: Array(Math.min(step, cap - occ)).fill('ENTRY'), burst: false } };
        }
        // Zona llena: de vez en cuando sale un vehículo y otro ocupa el espacio de inmediato.
        return { plan: { kinds: this.rng.chance(0.1) ? ['EXIT', 'ENTRY'] : [], burst: false } };
      }

      case 'RECOVERY': {
        const targetOcc = Math.floor(s.RECOVERY.target * cap);
        if (occ <= targetOcc) {
          this.overrides.delete(id);
          const transition: ScenarioTransition = {
            zoneId: id,
            from: 'RECOVERY',
            to: this.global,
            message: `Recuperación completada en ${zone.config.name} (${Math.round(zone.ratio * 100)} %)`,
          };
          return { plan: this.basePlan(zone, profile, simMinutes, this.global), transition };
        }
        const step = Math.max(1, Math.round(s.RECOVERY.stepFraction * cap * this.rng.between(0.8, 1.2)));
        const kinds: MovementKind[] = Array(Math.min(step, occ - targetOcc)).fill('EXIT');
        if (this.rng.chance(0.2)) kinds.push('ENTRY');
        return { plan: { kinds, burst: false } };
      }

      default:
        return { plan: this.basePlan(zone, profile, simMinutes, scenario) };
    }
  }

  /**
   * Plan base según el perfil de demanda:
   *   movimientos ~ Poisson(intensity × capacity × minutos simulados × demandFactor)
   *   cada movimiento es entrada con probabilidad entryWeight (salida en caso contrario).
   * Por encima del "techo" del escenario la probabilidad de entrada decrece de forma
   * cuadrática (los conductores buscan otra zona): así NORMAL no llega a niveles críticos
   * y HIGH_DEMAND sí se acerca a la saturación.
   */
  private basePlan(zone: ZoneSimulator, profile: ActiveProfile, simMinutes: number, scenario: ScenarioName): ZonePlan {
    const hd = scenario === 'HIGH_DEMAND' ? this.cfg.scenarios.HIGH_DEMAND : null;
    const ceiling = hd ? hd.ceiling : this.cfg.normalCeiling;
    const entryWeight = Math.min(0.95, Math.max(0.02, profile.entryWeight + (hd ? hd.entryBoost : 0)));
    const cap = zone.capacity;
    const lambda = profile.intensity * cap * simMinutes * zone.config.demandFactor * (hd ? hd.intensityMultiplier : 1);
    const moves = this.rng.poisson(lambda);

    const kinds: MovementKind[] = [];
    let projected = zone.occupied;
    for (let i = 0; i < moves; i++) {
      const ratio = projected / cap;
      let pEntry = entryWeight;
      if (ratio > ceiling) pEntry *= Math.max(0, (1 - ratio) / (1 - ceiling)) ** 2;
      if (this.rng.chance(pEntry)) {
        if (projected < cap) {
          kinds.push('ENTRY');
          projected++;
        }
      } else if (projected > 0) {
        kinds.push('EXIT');
        projected--;
      }
    }
    return { kinds, burst: false };
  }

  private newOverride(scenario: ScenarioName): ZoneOverride {
    const s = this.cfg.scenarios;
    const ticks = scenario === 'MASS_ENTRY' ? s.MASS_ENTRY.ticks : scenario === 'MASS_EXIT' ? s.MASS_EXIT.ticks : null;
    return { scenario, remainingTicks: ticks };
  }

  private consumeTick(zoneId: string, override: ZoneOverride, scenario: ScenarioName): ScenarioTransition | undefined {
    if (override.remainingTicks === null) return undefined;
    override.remainingTicks -= 1;
    if (override.remainingTicks > 0) return undefined;
    this.overrides.delete(zoneId);
    return {
      zoneId,
      from: scenario,
      to: this.global,
      message: `${LABELS.scenario[scenario]} finalizada en ${zoneId}; vuelve a ${LABELS.scenario[this.global]}`,
    };
  }
}
