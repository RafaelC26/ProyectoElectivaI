import { describe, expect, it } from 'vitest';
import { formatEventId, streamIdGreaterThan } from '../src/events/event-factory';
import { SimulatorCommandSchema } from '../src/schemas/command.schema';
import { ThresholdsSchema, ZonesConfigSchema } from '../src/schemas/config.schema';
import { SensorEventSchema } from '../src/schemas/event.schema';

function sensorEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt_000001',
    event_type: 'VEHICLE_ENTERED',
    entity_id: 'MOTOS-02',
    timestamp: '2026-09-22T14:30:00.000Z',
    location: { latitude: null, longitude: null },
    data: {
      vehicle_type: 'MOTORCYCLE',
      zone_name: 'Zona M2',
      capacity: 80,
      occupied: 73,
      available: 7,
      occupancy: 91.25,
      entries_per_minute: 3,
      exits_per_minute: 1,
      ...(overrides.data as object),
    },
    metadata: { source: 'SIMULATOR', schema_version: '1.0', generated_at: 1_790_000_000_000 },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'data')),
  };
}

describe('esquema de eventos (Zod)', () => {
  it('acepta el evento de ejemplo de la sección 12', () => {
    expect(SensorEventSchema.safeParse(sensorEvent()).success).toBe(true);
  });

  it('rechaza occupied > capacity', () => {
    const result = SensorEventSchema.safeParse(sensorEvent({ data: { occupied: 81, available: -1, occupancy: 100 } }));
    expect(result.success).toBe(false);
  });

  it('rechaza available ≠ capacity − occupied', () => {
    expect(SensorEventSchema.safeParse(sensorEvent({ data: { available: 9 } })).success).toBe(false);
  });

  it('rechaza un porcentaje inconsistente', () => {
    expect(SensorEventSchema.safeParse(sensorEvent({ data: { occupancy: 50 } })).success).toBe(false);
  });

  it('rechaza tipos de evento desconocidos y IDs mal formados', () => {
    expect(SensorEventSchema.safeParse(sensorEvent({ event_type: 'VEHICLE_TELEPORTED' })).success).toBe(false);
    expect(SensorEventSchema.safeParse(sensorEvent({ event_id: '42' })).success).toBe(false);
  });

  it('formatea event_id como evt_000001', () => {
    expect(formatEventId(1)).toBe('evt_000001');
    expect(formatEventId(1234567)).toBe('evt_1234567');
  });

  it('compara IDs de Stream correctamente', () => {
    expect(streamIdGreaterThan('1700000000001-0', '1700000000000-5')).toBe(true);
    expect(streamIdGreaterThan('1700000000000-2', '1700000000000-10')).toBe(false);
    expect(streamIdGreaterThan('1700000000000-0', '1700000000000-0')).toBe(false);
  });
});

describe('órdenes del simulador', () => {
  it('valida escenarios y velocidades', () => {
    expect(
      SimulatorCommandSchema.safeParse({ action: 'SET_SCENARIO', scenario: 'FULL', zone_id: 'CARS-C' }).success,
    ).toBe(true);
    expect(
      SimulatorCommandSchema.safeParse({ action: 'SET_SCENARIO', scenario: 'PANIC', zone_id: 'CARS-C' }).success,
    ).toBe(false);
    expect(SimulatorCommandSchema.safeParse({ action: 'SET_SPEED', speed: 3 }).success).toBe(false);
  });

  it('FORCE_ENTRY usa count = 1 por defecto y limita a 50', () => {
    const parsed = SimulatorCommandSchema.parse({ action: 'FORCE_ENTRY', zone_id: 'CARS-A' });
    expect(parsed).toMatchObject({ count: 1 });
    expect(SimulatorCommandSchema.safeParse({ action: 'FORCE_ENTRY', zone_id: 'CARS-A', count: 500 }).success).toBe(
      false,
    );
  });
});

describe('configuración', () => {
  it('rechaza zonas duplicadas o capacidades no positivas', () => {
    const zone = { id: 'CARS-A', name: 'Zona A', vehicleType: 'CAR', capacity: 60 };
    expect(ZonesConfigSchema.safeParse({ zones: [zone, zone] }).success).toBe(false);
    expect(ZonesConfigSchema.safeParse({ zones: [{ ...zone, capacity: 0 }] }).success).toBe(false);
  });

  it('exige warning < critical', () => {
    const base = {
      occupancy: { normal: 60, warning: 80, critical: 90, full: 100 },
      lowAvailability: 5,
      unusualIncreasePercent: 20,
      unusualIncreaseWindowSeconds: 6,
      trend: { threshold: 3, windowSeconds: 30 },
      alertHysteresis: 2,
      alertCooldownSeconds: 30,
    };
    expect(ThresholdsSchema.safeParse(base).success).toBe(true);
    expect(ThresholdsSchema.safeParse({ ...base, occupancy: { ...base.occupancy, warning: 95 } }).success).toBe(false);
  });
});
