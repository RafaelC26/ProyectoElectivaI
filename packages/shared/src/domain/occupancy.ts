import type { MovementKind, OccupancyThresholds, Trend, ZoneStatus } from '../types/domain';

/** Redondeo a 2 decimales (73 / 80 × 100 = 91.25). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Garantiza 0 <= occupied <= capacity. */
export function clampOccupied(occupied: number, capacity: number): number {
  if (!Number.isFinite(occupied) || capacity <= 0) return 0;
  return Math.min(Math.max(Math.round(occupied), 0), capacity);
}

/** available = capacity - occupied  (nunca negativo). */
export function calculateAvailable(capacity: number, occupied: number): number {
  return capacity - clampOccupied(occupied, capacity);
}

/** occupancy_percentage = occupied / capacity × 100 */
export function calculateOccupancy(occupied: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return round2((clampOccupied(occupied, capacity) / capacity) * 100);
}

export const STATUS_RANK: Record<ZoneStatus, number> = {
  LOW: 0,
  NORMAL: 1,
  WARNING: 2,
  CRITICAL: 3,
  FULL: 4,
};

/**
 * Clasificación por umbrales configurables:
 *   [0, normal) LOW · [normal, warning) NORMAL · [warning, critical) WARNING · [critical, full) CRITICAL · full FULL
 */
export function determineStatus(occupancy: number, t: OccupancyThresholds): ZoneStatus {
  if (occupancy >= t.full) return 'FULL';
  if (occupancy >= t.critical) return 'CRITICAL';
  if (occupancy >= t.warning) return 'WARNING';
  if (occupancy >= t.normal) return 'NORMAL';
  return 'LOW';
}

/** Tendencia a partir de la variación de ocupación (puntos porcentuales). */
export function determineTrend(delta: number, threshold: number): Trend {
  if (delta >= threshold) return 'RISING';
  if (delta <= -threshold) return 'FALLING';
  return 'STABLE';
}

/**
 * Aplica una entrada o salida respetando los límites físicos:
 * una entrada en una zona llena o una salida en una zona vacía no se aplican.
 */
export function applyMovement(
  occupied: number,
  capacity: number,
  kind: MovementKind,
): { occupied: number; applied: boolean } {
  const current = clampOccupied(occupied, capacity);
  if (kind === 'ENTRY') {
    return current >= capacity ? { occupied: current, applied: false } : { occupied: current + 1, applied: true };
  }
  return current <= 0 ? { occupied: current, applied: false } : { occupied: current - 1, applied: true };
}

export interface ZoneSnapshot {
  capacity: number;
  occupied: number;
  available: number;
  occupancy: number;
  status: ZoneStatus;
}

/** Deriva todas las variables de ocupación a partir de (capacity, occupied). */
export function computeZoneSnapshot(capacity: number, occupied: number, t: OccupancyThresholds): ZoneSnapshot {
  const safe = clampOccupied(occupied, capacity);
  const occupancy = calculateOccupancy(safe, capacity);
  return {
    capacity,
    occupied: safe,
    available: capacity - safe,
    occupancy,
    status: determineStatus(occupancy, t),
  };
}
