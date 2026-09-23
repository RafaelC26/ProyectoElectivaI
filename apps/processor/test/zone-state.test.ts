import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/metrics-calculator';
import { SampleHistory } from '../src/metrics/sample-history';
import { deriveAlertEvents, deriveStatusEvents } from '../src/processor/derived-events';
import { EMPTY_WINDOWS, calculateState } from '../src/processor/zone-state';
import { THRESHOLDS, ZONE_M2, sensorEvent, zoneState } from './fixtures';

const ctx = () => ({
  zone: ZONE_M2,
  thresholds: THRESHOLDS,
  windows: { ...EMPTY_WINDOWS, entries_1m: 3, exits_1m: 1 },
  history: new SampleHistory(),
  processedAt: new Date().toISOString(),
});

describe('estado actual de la zona (secciones 14, 57–61)', () => {
  it('72/80 + VEHICLE_ENTERED → 73/80, 91.25 %, 7 disponibles, CRITICAL', () => {
    const previous = zoneState(72, { total_entries: 10 });
    const { state, gap } = calculateState(previous, sensorEvent(73), ctx());
    expect(state).toMatchObject({
      occupied: 73,
      available: 7,
      occupancy: 91.25,
      status: 'CRITICAL',
      previous_status: 'CRITICAL', // 72/80 = 90 % ya es crítico
      previous_occupancy: 90,
      occupancy_delta: 1.25,
      total_entries: 11,
      entries_per_minute: 3,
      exits_per_minute: 1,
      last_event: 'VEHICLE_ENTERED',
    });
    expect(gap).toBe(0);
  });

  it('detecta eventos perdidos (gap) y se corrige con la lectura absoluta', () => {
    const { state, gap } = calculateState(zoneState(70), sensorEvent(73), ctx());
    expect(state.occupied).toBe(73);
    expect(gap).toBe(2);
  });

  it('nunca supera la capacidad aunque el sensor informe un valor mayor', () => {
    const event = sensorEvent(80);
    event.data.occupied = 85;
    const { state } = calculateState(zoneState(80), event, ctx());
    expect(state.occupied).toBe(80);
    expect(state.available).toBe(0);
  });
});

describe('eventos derivados (secciones 16–18)', () => {
  it('CRITICAL → FULL genera ZONE_STATUS_CHANGED y PARKING_FULL', () => {
    expect(deriveStatusEvents(zoneState(79), zoneState(80))).toEqual(['ZONE_STATUS_CHANGED', 'PARKING_FULL']);
  });

  it('FULL → CRITICAL genera PARKING_AVAILABLE', () => {
    expect(deriveStatusEvents(zoneState(80), zoneState(79))).toEqual(['ZONE_STATUS_CHANGED', 'PARKING_AVAILABLE']);
  });

  it('sin cambio de categoría no hay eventos derivados', () => {
    expect(deriveStatusEvents(zoneState(73), zoneState(74))).toEqual([]);
  });

  it('las alertas levantadas producen OCCUPANCY_WARNING / OCCUPANCY_CRITICAL y la recuperación ZONE_RECOVERED', () => {
    const alert = {
      id: 'alert_000001',
      zone_id: 'MOTOS-02',
      zone_name: 'Zona M2',
      severity: 'WARNING',
      message: '',
      value: 80,
      threshold: 80,
      unit: '%',
      status: 'ACTIVE',
      timestamp: '',
    } as const;
    expect(deriveAlertEvents([{ action: 'RAISED', alert: { ...alert, type: 'OCCUPANCY_WARNING' } }], false)).toEqual([
      'OCCUPANCY_WARNING',
    ]);
    expect(deriveAlertEvents([{ action: 'RAISED', alert: { ...alert, type: 'HIGH_OCCUPANCY' } }], false)).toEqual([
      'OCCUPANCY_CRITICAL',
    ]);
    expect(deriveAlertEvents([], true)).toEqual(['ZONE_RECOVERED']);
  });
});

describe('métricas derivadas (secciones 62–69)', () => {
  const car = (id: string, occupied: number, capacity: number, status = 'NORMAL') => ({
    ...zoneState(0),
    zone_id: id,
    zone_name: id,
    vehicle_type: 'CAR' as const,
    capacity,
    occupied,
    available: capacity - occupied,
    occupancy: (occupied / capacity) * 100,
    status: status as 'NORMAL',
    entries_per_minute: 2,
  });

  it('ocupación global, por tipo, zonas críticas y zona más ocupada', () => {
    const zones = [car('A', 43, 60), car('B', 65, 70, 'CRITICAL'), zoneState(73, { entries_per_minute: 5 })];
    const ranking = [
      { zone_id: 'B', score: 92.86 },
      { zone_id: 'MOTOS-02', score: 91.25 },
      { zone_id: 'A', score: 71.67 },
    ];
    const metrics = computeMetrics(zones, ranking, new SampleHistory(), THRESHOLDS, Date.now());
    expect(metrics.global).toMatchObject({
      capacity: 210,
      occupied: 181,
      available: 29,
      occupancy: 86.19,
      critical_zones: 2,
    });
    expect(metrics.cars).toMatchObject({ capacity: 130, occupied: 108, occupancy: 83.08, entries_1m: 4 });
    expect(metrics.motorcycles).toMatchObject({
      capacity: 80,
      occupied: 73,
      occupancy: 91.25,
      most_occupied_zone: 'MOTOS-02',
    });
    expect(metrics.global.most_occupied_zone).toBe('B');
    expect(metrics.ranking.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('variación y promedio usan la ventana temporal', () => {
    const history = new SampleHistory();
    const now = 1_790_000_600_000;
    for (let i = 0; i <= 10; i++) {
      history.add({
        id: `${i}`,
        ts: now - (10 - i) * 30_000,
        simulated_time: '',
        global: 60 + i * 2,
        cars: 0,
        motorcycles: 0,
        zones: {},
        entries_1m: 0,
        exits_1m: 0,
        entries_1m_cars: 0,
        exits_1m_cars: 0,
        entries_1m_motorcycles: 0,
        exits_1m_motorcycles: 0,
        events_per_second: 0,
      });
    }
    // Hace 5 min (300 s) la ocupación global era 60 → la actual (80) da +20 pp.
    expect(history.valueAt((s) => s.global, now - 300_000)).toBe(60);
    expect(history.valueAt((s) => s.global, now - 45_000)).toBe(76); // última muestra anterior al instante
    expect(history.average((s) => s.global, now - 60_000)).toBe(78);
    expect(history.min((s) => s.global, now - 90_000)).toBe(74);
  });
});
