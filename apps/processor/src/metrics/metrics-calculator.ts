import {
  calculateOccupancy,
  determineTrend,
  round2,
  type GroupMetrics,
  type MetricsScope,
  type MetricsSnapshot,
  type RankingEntry,
  type Thresholds,
  type ZoneState,
} from '@uptc/shared';
import type { SampleHistory, SampleSelector } from './sample-history';

const MINUTE = 60_000;

export interface RankingScore {
  zone_id: string;
  score: number;
}

/**
 * Métricas derivadas de un grupo de zonas (global, carros o motocicletas):
 *   ocupación = Σ ocupados / Σ capacidad × 100 · disponibles · entradas/salidas por ventana
 *   promedios 1/5/15 min · variación 5 min · tendencia · zonas críticas · zona más ocupada
 */
export function computeGroupMetrics(
  scope: MetricsScope,
  zones: ZoneState[],
  ranking: RankingScore[],
  history: SampleHistory,
  select: SampleSelector,
  thresholds: Thresholds,
  now: number,
): GroupMetrics {
  const sum = (pick: (z: ZoneState) => number) => zones.reduce((acc, z) => acc + pick(z), 0);
  const capacity = sum((z) => z.capacity);
  const occupied = sum((z) => z.occupied);
  const occupancy = calculateOccupancy(occupied, capacity);

  const avg = (windowMs: number) => round2(history.average(select, now - windowMs) ?? occupancy);
  const ref5m = history.valueAt(select, now - 5 * MINUTE);
  const refTrend = history.valueAt(select, now - thresholds.trend.windowSeconds * 1000);

  const ids = new Set(zones.map((z) => z.zone_id));
  const top = ranking.find((r) => ids.has(r.zone_id)) ?? null;

  return {
    scope,
    zones: zones.length,
    capacity,
    occupied,
    available: capacity - occupied,
    occupancy,
    entries_1m: sum((z) => z.entries_per_minute),
    exits_1m: sum((z) => z.exits_per_minute),
    entries_5m: sum((z) => z.entries_5m),
    exits_5m: sum((z) => z.exits_5m),
    entries_15m: sum((z) => z.entries_15m),
    exits_15m: sum((z) => z.exits_15m),
    avg_occupancy_1m: avg(MINUTE),
    avg_occupancy_5m: avg(5 * MINUTE),
    avg_occupancy_15m: avg(15 * MINUTE),
    variation_5m: round2(occupancy - (ref5m ?? occupancy)),
    trend: determineTrend(occupancy - (refTrend ?? occupancy), thresholds.trend.threshold),
    critical_zones: zones.filter((z) => z.status === 'CRITICAL' || z.status === 'FULL').length,
    full_zones: zones.filter((z) => z.status === 'FULL').length,
    most_occupied_zone: top?.zone_id ?? null,
    most_occupied_value: top ? round2(top.score) : 0,
    updated_at: new Date(now).toISOString(),
  };
}

export function computeMetrics(
  zones: ZoneState[],
  ranking: RankingScore[],
  history: SampleHistory,
  thresholds: Thresholds,
  now: number,
): MetricsSnapshot {
  const cars = zones.filter((z) => z.vehicle_type === 'CAR');
  const motorcycles = zones.filter((z) => z.vehicle_type === 'MOTORCYCLE');
  const byId = new Map(zones.map((z) => [z.zone_id, z]));

  const rankingEntries: RankingEntry[] = ranking
    .filter((r) => byId.has(r.zone_id))
    .map((r, i) => {
      const zone = byId.get(r.zone_id)!;
      return {
        zone_id: r.zone_id,
        zone_name: zone.zone_name,
        vehicle_type: zone.vehicle_type,
        occupancy: round2(r.score),
        rank: i + 1,
      };
    });

  return {
    global: computeGroupMetrics('GLOBAL', zones, ranking, history, (s) => s.global, thresholds, now),
    cars: computeGroupMetrics('CAR', cars, ranking, history, (s) => s.cars, thresholds, now),
    motorcycles: computeGroupMetrics(
      'MOTORCYCLE',
      motorcycles,
      ranking,
      history,
      (s) => s.motorcycles,
      thresholds,
      now,
    ),
    ranking: rankingEntries,
  };
}
