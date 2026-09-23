import { SensorEventSchema } from '@uptc/shared';
import { loadSimulationConfig, loadZones } from '@uptc/shared/node';
import { describe, expect, it } from 'vitest';
import { EventNormalizer, UnknownZoneError } from '../src/publisher/event-normalizer';
import { EventValidationError, validateSensorEvent } from '../src/publisher/event-validator';
import { parseClock, resolveProfile } from '../src/simulation/demand-profile';
import { ParkingSimulator } from '../src/simulation/parking-simulator';

const zones = loadZones();
const config = loadSimulationConfig();

function simulator(seed = 7, intervalMs = 2000) {
  return new ParkingSimulator({
    zones,
    config,
    mode: 'ACCELERATED_DEMO',
    intervalMs,
    startTime: '06:30',
    timeZone: 'America/Bogota',
    seed,
  });
}

/** Ejecuta n ciclos aplicando todos los movimientos; devuelve la ocupación de cada zona por ciclo. */
function run(sim: ParkingSimulator, ticks: number) {
  const history: Array<Record<string, number>> = [];
  for (let i = 0; i < ticks; i++) {
    const plan = sim.tick();
    for (const movement of plan.movements) sim.apply(movement);
    history.push(Object.fromEntries([...sim.zones.values()].map((z) => [z.config.id, z.occupied])));
  }
  return history;
}

describe('perfiles de demanda (secciones 23–29)', () => {
  it.each([
    ['07:30', 'HIGH_ENTRY', 0.8],
    ['10:00', 'STABLE', 0.5],
    ['12:30', 'HIGH_EXIT', 0.25],
    ['15:00', 'MEDIUM', 0.55],
    ['17:30', 'HIGH_EXIT', 0.15],
    ['23:00', 'LOW', 0.3],
    ['03:00', 'LOW', 0.3],
  ])('%s → %s (entryWeight %s)', (clock, profile, entryWeight) => {
    const active = resolveProfile(config.schedule, parseClock(clock));
    expect(active.profile).toBe(profile);
    expect(active.entryWeight).toBe(entryWeight);
  });
});

describe('simulador con continuidad (sección 22)', () => {
  it('durante un día completo la ocupación nunca sale de [0, capacity]', () => {
    const sim = simulator();
    const history = run(sim, 420);
    for (const snapshot of history) {
      for (const zone of zones) {
        expect(snapshot[zone.id]).toBeGreaterThanOrEqual(0);
        expect(snapshot[zone.id]).toBeLessThanOrEqual(zone.capacity);
      }
    }
  });

  it('cada lectura del sensor difiere de la anterior en exactamente ±1', () => {
    const sim = simulator(11);
    const last = new Map([...sim.zones.values()].map((z) => [z.config.id, z.occupied]));
    for (let i = 0; i < 120; i++) {
      for (const movement of sim.tick().movements) {
        const reading = sim.apply(movement);
        if (!reading) continue;
        const id = reading.zoneId.toUpperCase();
        expect(Math.abs(reading.count - last.get(id)!)).toBe(1);
        last.set(id, reading.count);
      }
    }
  });

  it('el pico matutino aumenta la ocupación y el escenario NORMAL no llega a nivel crítico', () => {
    const sim = simulator(3);
    const history = run(sim, 45); // 06:30 → 08:00 en modo acelerado (2 min simulados por ciclo)
    const zone = zones[0];
    const start = history[0][zone.id] / zone.capacity;
    const end = history[history.length - 1][zone.id] / zone.capacity;
    expect(end).toBeGreaterThan(start + 0.3);
    const peak = Math.max(...history.flatMap((h) => zones.map((z) => h[z.id] / z.capacity)));
    expect(peak).toBeLessThan(0.9);
  });

  it('es reproducible con la misma semilla', () => {
    expect(run(simulator(99), 60)).toEqual(run(simulator(99), 60));
  });
});

describe('escenarios especiales (secciones 34–41)', () => {
  it('FULL lleva la zona exactamente a occupied = capacity y nunca la supera', () => {
    const sim = simulator();
    sim.scenarios.set(
      'FULL',
      'CARS-C',
      zones.map((z) => z.id),
    );
    const history = run(sim, 25);
    const capacity = zones.find((z) => z.id === 'CARS-C')!.capacity;
    expect(history.some((h) => h['CARS-C'] === capacity)).toBe(true);
    expect(history.every((h) => h['CARS-C'] <= capacity)).toBe(true);
  });

  it('NEAR_FULL estabiliza la zona entre 90 % y 99 %', () => {
    const sim = simulator();
    sim.scenarios.set(
      'NEAR_FULL',
      'MOTOS-02',
      zones.map((z) => z.id),
    );
    const history = run(sim, 40).slice(-10);
    for (const h of history) {
      expect(h['MOTOS-02'] / 80).toBeGreaterThanOrEqual(0.9);
      expect(h['MOTOS-02'] / 80).toBeLessThan(1);
    }
  });

  it('RECOVERY genera salidas progresivas y vuelve solo al escenario global', () => {
    const sim = simulator();
    sim.zones.get('CARS-C')!.set(50);
    sim.scenarios.set(
      'RECOVERY',
      'CARS-C',
      zones.map((z) => z.id),
    );
    const values: number[] = [];
    let finished = false;
    for (let i = 0; i < 20 && !finished; i++) {
      const plan = sim.tick();
      for (const m of plan.movements) sim.apply(m);
      values.push(sim.zones.get('CARS-C')!.occupied);
      finished = plan.transitions.some((t) => t.zoneId === 'CARS-C' && t.from === 'RECOVERY');
    }
    expect(finished).toBe(true);
    expect(values[1]).toBeLessThan(50);
    expect(sim.scenarios.scenarioFor('CARS-C')).toBe('NORMAL');
  });

  it('MASS_ENTRY es una ráfaga de 3 ciclos y luego expira', () => {
    const sim = simulator();
    sim.scenarios.set(
      'MASS_ENTRY',
      'CARS-A',
      zones.map((z) => z.id),
    );
    const before = sim.zones.get('CARS-A')!.occupied;
    const transitions = [];
    for (let i = 0; i < 3; i++) {
      const plan = sim.tick();
      for (const m of plan.movements) sim.apply(m);
      transitions.push(...plan.transitions);
    }
    expect(sim.zones.get('CARS-A')!.occupied - before).toBeGreaterThanOrEqual(Math.round(60 * 0.25));
    expect(transitions.some((t) => t.from === 'MASS_ENTRY')).toBe(true);
    expect(sim.scenarios.scenarioFor('CARS-A')).toBe('NORMAL');
  });

  it('una entrada forzada en una zona llena se descarta', () => {
    const sim = simulator();
    sim.zones.get('CARS-A')!.set(60);
    const [movement] = sim.forced('CARS-A', 'ENTRY', 1);
    expect(sim.apply(movement)).toBeNull();
    expect(sim.zones.get('CARS-A')!.occupied).toBe(60);
  });
});

describe('Publisher: normalización y validación (secciones 43–45)', () => {
  const normalizer = new EventNormalizer(zones);

  it('convierte la lectura cruda del sensor en un evento válido del modelo común', () => {
    const sim = simulator();
    sim.zones.get('MOTOS-02')!.set(72);
    const reading = sim.apply({ zoneId: 'MOTOS-02', kind: 'ENTRY', offsetMs: 0 })!;
    expect(reading.zoneId).toBe('motos-02'); // formato propio del sensor
    const event = validateSensorEvent(normalizer.normalize(reading, 'evt_000123'));
    expect(event).toMatchObject({
      event_type: 'VEHICLE_ENTERED',
      entity_id: 'MOTOS-02',
      data: { vehicle_type: 'MOTORCYCLE', capacity: 80, occupied: 73, available: 7, occupancy: 91.25 },
      location: { latitude: null, longitude: null },
      metadata: { source: 'SIMULATOR', schema_version: '1.0', sensor_id: 'SNS-MOTOS-02-IN' },
    });
    expect(SensorEventSchema.safeParse(event).success).toBe(true);
  });

  it('rechaza zonas desconocidas y eventos inconsistentes', () => {
    expect(() =>
      normalizer.normalize(
        {
          sensorId: 'x',
          zoneId: 'nope',
          direction: 'IN',
          count: 1,
          capacity: 10,
          detectedAt: Date.now(),
          simClock: '07:00',
          window: { in: 0, out: 0 },
          scenario: 'NORMAL',
          manual: false,
        },
        'evt_000001',
      ),
    ).toThrow(UnknownZoneError);

    const valid = normalizer.normalize(
      {
        sensorId: 'sns-cars-a-in',
        zoneId: 'cars-a',
        direction: 'IN',
        count: 10,
        capacity: 60,
        detectedAt: Date.now(),
        simClock: '07:00',
        window: { in: 1, out: 0 },
        scenario: 'NORMAL',
        manual: false,
      },
      'evt_000002',
    );
    expect(() => validateSensorEvent({ ...valid, data: { ...valid.data, available: 99 } })).toThrow(
      EventValidationError,
    );
  });
});
