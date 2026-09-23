import {
  clampOccupied,
  computeZoneSnapshot,
  determineTrend,
  round2,
  type SensorEvent,
  type Thresholds,
  type ZoneConfig,
  type ZoneState,
} from '@uptc/shared';
import { zoneSelector, type SampleHistory } from '../metrics/sample-history';

const MINUTE = 60_000;

export interface WindowCounts {
  entries_1m: number;
  exits_1m: number;
  entries_5m: number;
  exits_5m: number;
  entries_15m: number;
  exits_15m: number;
}

export const EMPTY_WINDOWS: WindowCounts = {
  entries_1m: 0,
  exits_1m: 0,
  entries_5m: 0,
  exits_5m: 0,
  entries_15m: 0,
  exits_15m: 0,
};

export interface StateContext {
  zone: ZoneConfig;
  thresholds: Thresholds;
  windows: WindowCounts;
  history: SampleHistory;
  processedAt: string;
}

/** Estado inicial de una zona sin eventos todavía. */
export function initialZoneState(zone: ZoneConfig, thresholds: Thresholds, nowIso: string): ZoneState {
  const snap = computeZoneSnapshot(zone.capacity, 0, thresholds.occupancy);
  return {
    zone_id: zone.id,
    zone_name: zone.name,
    vehicle_type: zone.vehicleType,
    ...snap,
    previous_occupancy: 0,
    occupancy_delta: 0,
    ...windowFields(EMPTY_WINDOWS),
    total_entries: 0,
    total_exits: 0,
    previous_status: snap.status,
    trend: 'STABLE',
    trend_delta: 0,
    avg_occupancy_5m: 0,
    variation_5m: 0,
    last_event: 'INIT',
    last_event_id: '',
    timestamp: nowIso,
    last_update: nowIso,
    simulated_time: '',
  };
}

function windowFields(w: WindowCounts) {
  return {
    entries_per_minute: w.entries_1m,
    exits_per_minute: w.exits_1m,
    entries_5m: w.entries_5m,
    exits_5m: w.exits_5m,
    entries_15m: w.entries_15m,
    exits_15m: w.exits_15m,
  };
}

/** Campos que dependen del tiempo (ventanas, tendencia, promedio, variación). */
export function timeDependentFields(
  zoneId: string,
  occupancy: number,
  fallbackPrevious: number,
  windows: WindowCounts,
  history: SampleHistory,
  thresholds: Thresholds,
  at: number,
) {
  const select = zoneSelector(zoneId);
  const refTrend = history.valueAt(select, at - thresholds.trend.windowSeconds * 1000);
  const trendDelta = round2(occupancy - (refTrend ?? fallbackPrevious));
  const ref5m = history.valueAt(select, at - 5 * MINUTE);
  return {
    ...windowFields(windows),
    trend: determineTrend(trendDelta, thresholds.trend.threshold),
    trend_delta: trendDelta,
    avg_occupancy_5m: round2(history.average(select, at - 5 * MINUTE) ?? occupancy),
    variation_5m: round2(occupancy - (ref5m ?? fallbackPrevious)),
  };
}

/**
 * Calcula el nuevo estado de la zona a partir del estado anterior y la lectura del sensor.
 * El sensor informa el conteo ABSOLUTO de vehículos: si el Processor perdió eventos
 * (gap ≠ 0) el estado se corrige solo con la siguiente medición.
 */
export function calculateState(
  previous: ZoneState | null,
  event: SensorEvent,
  ctx: StateContext,
): { state: ZoneState; gap: number } {
  const { zone, thresholds } = ctx;
  const entered = event.event_type === 'VEHICLE_ENTERED';
  const snap = computeZoneSnapshot(zone.capacity, event.data.occupied, thresholds.occupancy);
  const previousOccupancy = previous?.occupancy ?? snap.occupancy;
  const expected = previous ? clampOccupied(previous.occupied + (entered ? 1 : -1), zone.capacity) : snap.occupied;

  const state: ZoneState = {
    zone_id: zone.id,
    zone_name: zone.name,
    vehicle_type: zone.vehicleType,
    ...snap,
    previous_occupancy: previousOccupancy,
    occupancy_delta: round2(snap.occupancy - previousOccupancy),
    total_entries: (previous?.total_entries ?? 0) + (entered ? 1 : 0),
    total_exits: (previous?.total_exits ?? 0) + (entered ? 0 : 1),
    previous_status: previous?.status ?? snap.status,
    ...timeDependentFields(
      zone.id,
      snap.occupancy,
      previousOccupancy,
      ctx.windows,
      ctx.history,
      thresholds,
      event.metadata.generated_at,
    ),
    last_event: event.event_type,
    last_event_id: event.event_id,
    timestamp: event.timestamp,
    last_update: ctx.processedAt,
    simulated_time: event.metadata.simulated_time ?? previous?.simulated_time ?? '',
  };
  return { state, gap: snap.occupied - expected };
}
