import {
  round2,
  type Alert,
  type AlertResolution,
  type AlertSeverity,
  type AlertType,
  type Thresholds,
  type ZoneState,
} from '@uptc/shared';

/**
 * Motor de alertas — máquina de estados por zona (función pura, sin Redis).
 *
 *   NONE ──▶ WARNING ──▶ CRITICAL ──▶ FULL        (escalar es inmediato)
 *   FULL ──▶ CRITICAL ──▶ WARNING ──▶ NONE        (bajar exige cruzar umbral − histéresis)
 *
 * - Mientras el nivel no cambia NO se crean alertas nuevas (sin duplicados).
 * - Cada cambio resuelve la alerta anterior (ESCALATED / DEESCALATED / RECOVERED) y crea la nueva.
 * - Volver a NONE resuelve la alerta y genera ZONE_RECOVERED.
 * - Tras una recuperación se activa un cooldown (clave Redis con TTL) que retrasa una nueva
 *   alerta de advertencia si la zona vuelve a cruzar el umbral enseguida (evita "parpadeo").
 */
export type AlertLevel = 'NONE' | 'WARNING' | 'CRITICAL' | 'FULL';

export const LEVEL_RANK: Record<AlertLevel, number> = { NONE: 0, WARNING: 1, CRITICAL: 2, FULL: 3 };

/** Claves de cooldown: 'OCCUPANCY' agrupa las tres alertas de nivel. */
export type CooldownKey = 'OCCUPANCY' | 'LOW_AVAILABILITY' | 'UNUSUAL_OCCUPANCY_INCREASE';

export const LEVEL_ALERT_TYPES: AlertType[] = ['OCCUPANCY_WARNING', 'HIGH_OCCUPANCY', 'PARKING_FULL'];
export const ZONE_ALERT_TYPES: AlertType[] = [...LEVEL_ALERT_TYPES, 'LOW_AVAILABILITY', 'UNUSUAL_OCCUPANCY_INCREASE'];

export type AlertDraft = Omit<Alert, 'id'>;

export interface ResolutionDraft {
  alert: Alert;
  resolution: AlertResolution;
  message: string;
}

export interface ZoneAlertInput {
  zone: ZoneState;
  level: AlertLevel;
  active: Partial<Record<AlertType, Alert>>;
  cooldowns: Set<CooldownKey>;
  /** Incremento de ocupación (pp) dentro de la ventana de crecimiento inusual. */
  unusualIncrease: number | null;
  thresholds: Thresholds;
  timestamp: string;
}

export interface ZoneAlertResult {
  level: AlertLevel;
  raise: AlertDraft[];
  resolve: ResolutionDraft[];
  recovered: boolean;
  cooldowns: CooldownKey[];
}

export function rawLevel(occupancy: number, t: Thresholds): AlertLevel {
  if (occupancy >= t.occupancy.full) return 'FULL';
  if (occupancy >= t.occupancy.critical) return 'CRITICAL';
  if (occupancy >= t.occupancy.warning) return 'WARNING';
  return 'NONE';
}

function levelThreshold(level: AlertLevel, t: Thresholds): number {
  if (level === 'FULL') return t.occupancy.full;
  if (level === 'CRITICAL') return t.occupancy.critical;
  if (level === 'WARNING') return t.occupancy.warning;
  return 0;
}

/** Nivel siguiente con histéresis: subir es inmediato, bajar exige occupancy < umbral − h. */
export function nextLevel(current: AlertLevel, occupancy: number, t: Thresholds): AlertLevel {
  const raw = rawLevel(occupancy, t);
  if (LEVEL_RANK[raw] >= LEVEL_RANK[current]) return raw;
  return occupancy < levelThreshold(current, t) - t.alertHysteresis ? raw : current;
}

function levelAlert(level: Exclude<AlertLevel, 'NONE'>, zone: ZoneState, t: Thresholds, ts: string): AlertDraft {
  const base = { zone_id: zone.zone_id, zone_name: zone.zone_name, value: zone.occupancy, unit: '%' as const };
  const occ = `${zone.occupancy}%`;
  const specs: Record<typeof level, { type: AlertType; severity: AlertSeverity; threshold: number; message: string }> =
    {
      WARNING: {
        type: 'OCCUPANCY_WARNING',
        severity: 'WARNING',
        threshold: t.occupancy.warning,
        message: `La ${zone.zone_name} alcanzó ${occ} de ocupación (advertencia ≥ ${t.occupancy.warning}%).`,
      },
      CRITICAL: {
        type: 'HIGH_OCCUPANCY',
        severity: 'CRITICAL',
        threshold: t.occupancy.critical,
        message: `La ${zone.zone_name} alcanzó ${occ} de ocupación.`,
      },
      FULL: {
        type: 'PARKING_FULL',
        severity: 'CRITICAL',
        threshold: t.occupancy.full,
        message: `La ${zone.zone_name} está completamente ocupada (${zone.occupied}/${zone.capacity}).`,
      },
    };
  const spec = specs[level];
  return { ...base, ...spec, status: 'ACTIVE', timestamp: ts };
}

export function evaluateZoneAlerts(input: ZoneAlertInput): ZoneAlertResult {
  const { zone, thresholds: t, active, cooldowns, timestamp } = input;
  const result: ZoneAlertResult = { level: input.level, raise: [], resolve: [], recovered: false, cooldowns: [] };

  // ── 1. Nivel de ocupación (WARNING / CRITICAL / FULL) ────────────────────────
  const level = nextLevel(input.level, zone.occupancy, t);
  const levelAlertActive = LEVEL_ALERT_TYPES.map((type) => active[type]).find(Boolean);

  if (level !== input.level) {
    const rising = LEVEL_RANK[level] > LEVEL_RANK[input.level];
    if (levelAlertActive) {
      const resolution: AlertResolution = level === 'NONE' ? 'RECOVERED' : rising ? 'ESCALATED' : 'DEESCALATED';
      const message =
        resolution === 'RECOVERED'
          ? `${zone.zone_name} se recuperó: ${zone.occupancy}% de ocupación.`
          : `${zone.zone_name} pasó a nivel ${level} (${zone.occupancy}%).`;
      result.resolve.push({ alert: levelAlertActive, resolution, message });
    }
    if (level === 'NONE') {
      if (levelAlertActive) {
        result.recovered = true;
        result.cooldowns.push('OCCUPANCY');
      }
    } else {
      const suppressed = input.level === 'NONE' && level === 'WARNING' && cooldowns.has('OCCUPANCY');
      if (!suppressed) result.raise.push(levelAlert(level, zone, t, timestamp));
    }
    result.level = level;
  } else if (level !== 'NONE' && !levelAlertActive && !cooldowns.has('OCCUPANCY')) {
    // El nivel exige una alerta que no existe (cooldown ya expiró o reinicio del Processor).
    result.raise.push(levelAlert(level, zone, t, timestamp));
  }

  // ── 2. Disponibilidad baja (available <= lowAvailability) ──────────────────
  const low = active.LOW_AVAILABILITY;
  const lowLimit = t.lowAvailability;
  const lowHysteresis = Math.max(1, Math.round(t.alertHysteresis));
  if (!low && zone.available <= lowLimit && result.level !== 'FULL' && !cooldowns.has('LOW_AVAILABILITY')) {
    result.raise.push({
      zone_id: zone.zone_id,
      zone_name: zone.zone_name,
      type: 'LOW_AVAILABILITY',
      severity: 'WARNING',
      message: `La ${zone.zone_name} tiene disponibilidad limitada: ${zone.available} espacios restantes.`,
      value: zone.available,
      threshold: lowLimit,
      unit: 'espacios',
      status: 'ACTIVE',
      timestamp,
    });
  } else if (low && result.level === 'FULL') {
    result.resolve.push({
      alert: low,
      resolution: 'ESCALATED',
      message: `${zone.zone_name} se llenó (ver PARKING_FULL).`,
    });
  } else if (low && zone.available > lowLimit + lowHysteresis) {
    result.resolve.push({
      alert: low,
      resolution: 'CONDITION_CLEARED',
      message: `${zone.zone_name} recuperó disponibilidad: ${zone.available} espacios.`,
    });
    result.cooldowns.push('LOW_AVAILABILITY');
  }

  // ── 3. Crecimiento inusual (incremento >= X pp dentro de la ventana) ────────
  const unusual = active.UNUSUAL_OCCUPANCY_INCREASE;
  const increase = input.unusualIncrease;
  if (
    !unusual &&
    increase !== null &&
    increase >= t.unusualIncreasePercent &&
    !cooldowns.has('UNUSUAL_OCCUPANCY_INCREASE')
  ) {
    result.raise.push({
      zone_id: zone.zone_id,
      zone_name: zone.zone_name,
      type: 'UNUSUAL_OCCUPANCY_INCREASE',
      severity: 'WARNING',
      message: `Crecimiento inusual en la ${zone.zone_name}: +${round2(increase)} pp en ${t.unusualIncreaseWindowSeconds} s.`,
      value: round2(increase),
      threshold: t.unusualIncreasePercent,
      unit: 'pp',
      status: 'ACTIVE',
      timestamp,
    });
  } else if (unusual && (increase === null || increase < t.unusualIncreasePercent / 2)) {
    result.resolve.push({
      alert: unusual,
      resolution: 'CONDITION_CLEARED',
      message: `El crecimiento de ${zone.zone_name} volvió a la normalidad.`,
    });
    result.cooldowns.push('UNUSUAL_OCCUPANCY_INCREASE');
  }

  return result;
}

export const GROUP_SCOPES = [
  { vehicleType: 'CAR', scopeId: 'CARS', type: 'CAR_PARKING_FULL', name: 'Parqueadero de carros' },
  {
    vehicleType: 'MOTORCYCLE',
    scopeId: 'MOTORCYCLES',
    type: 'MOTORCYCLE_PARKING_FULL',
    name: 'Parqueadero de motocicletas',
  },
] as const;

/** CAR_PARKING_FULL / MOTORCYCLE_PARKING_FULL: todas las zonas de un tipo están llenas. */
export function evaluateGroupAlerts(
  zones: ZoneState[],
  active: Partial<Record<AlertType, Alert>>,
  timestamp: string,
): { raise: AlertDraft[]; resolve: ResolutionDraft[] } {
  const raise: AlertDraft[] = [];
  const resolve: ResolutionDraft[] = [];
  for (const group of GROUP_SCOPES) {
    const members = zones.filter((z) => z.vehicle_type === group.vehicleType);
    if (!members.length) continue;
    const allFull = members.every((z) => z.status === 'FULL');
    const current = active[group.type];
    const capacity = members.reduce((a, z) => a + z.capacity, 0);
    if (allFull && !current) {
      raise.push({
        zone_id: group.scopeId,
        zone_name: group.name,
        type: group.type,
        severity: 'CRITICAL',
        message: `${group.name}: todas las zonas están llenas (${capacity}/${capacity}).`,
        value: 100,
        threshold: 100,
        unit: '%',
        status: 'ACTIVE',
        timestamp,
      });
    } else if (!allFull && current) {
      const free = members.reduce((a, z) => a + z.available, 0);
      resolve.push({
        alert: current,
        resolution: 'RECOVERED',
        message: `${group.name} vuelve a tener ${free} espacios.`,
      });
    }
  }
  return { raise, resolve };
}

export function resolvedCopy(draft: ResolutionDraft, timestamp: string): Alert {
  return {
    ...draft.alert,
    status: 'RESOLVED',
    resolved_at: timestamp,
    resolution: draft.resolution,
    resolution_message: draft.message,
  };
}
