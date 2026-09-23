import { describe, expect, it } from 'vitest';
import {
  applyMovement,
  calculateAvailable,
  calculateOccupancy,
  clampOccupied,
  computeZoneSnapshot,
  determineStatus,
  determineTrend,
} from '../src/domain/occupancy';

const T = { normal: 60, warning: 80, critical: 90, full: 100 };

describe('cálculo de ocupación y disponibilidad (secciones 60, 61, 122)', () => {
  it('capacity = 80, occupied = 73 → available = 7, occupancy = 91.25', () => {
    expect(calculateAvailable(80, 73)).toBe(7);
    expect(calculateOccupancy(73, 80)).toBe(91.25);
  });

  it('available = capacity − occupied y nunca es negativo', () => {
    expect(calculateAvailable(60, 60)).toBe(0);
    expect(calculateAvailable(60, 75)).toBe(0);
    expect(calculateAvailable(60, 0)).toBe(60);
  });

  it('redondea el porcentaje a 2 decimales', () => {
    expect(calculateOccupancy(1, 3)).toBe(33.33);
    expect(calculateOccupancy(47, 70)).toBe(67.14);
  });
});

describe('límites (sección 123)', () => {
  it('occupied nunca supera capacity', () => {
    expect(clampOccupied(81, 80)).toBe(80);
    expect(computeZoneSnapshot(80, 95, T).occupied).toBe(80);
  });

  it('occupied nunca es negativo', () => {
    expect(clampOccupied(-3, 80)).toBe(0);
    expect(clampOccupied(Number.NaN, 80)).toBe(0);
  });
});

describe('entrada en zona llena / salida en zona vacía (secciones 124, 125)', () => {
  it('80/80 + entrada → continúa en 80 (no 81/80)', () => {
    expect(applyMovement(80, 80, 'ENTRY')).toEqual({ occupied: 80, applied: false });
  });

  it('0/80 + salida → continúa en 0', () => {
    expect(applyMovement(0, 80, 'EXIT')).toEqual({ occupied: 0, applied: false });
  });

  it('movimientos válidos cambian la ocupación en ±1', () => {
    expect(applyMovement(72, 80, 'ENTRY')).toEqual({ occupied: 73, applied: true });
    expect(applyMovement(73, 80, 'EXIT')).toEqual({ occupied: 72, applied: true });
  });
});

describe('determinación de estado (secciones 19, 121)', () => {
  it.each([
    [0, 'LOW'],
    [59.99, 'LOW'],
    [60, 'NORMAL'],
    [79.99, 'NORMAL'],
    [80, 'WARNING'],
    [89.99, 'WARNING'],
    [90, 'CRITICAL'],
    [91.25, 'CRITICAL'],
    [99.99, 'CRITICAL'],
    [100, 'FULL'],
  ] as const)('%s %% → %s', (occupancy, status) => {
    expect(determineStatus(occupancy, T)).toBe(status);
  });

  it('los umbrales son configurables', () => {
    expect(determineStatus(75, { normal: 50, warning: 70, critical: 85, full: 100 })).toBe('WARNING');
  });
});

describe('tendencia (sección 70)', () => {
  it('RISING / FALLING / STABLE según el umbral', () => {
    expect(determineTrend(9, 3)).toBe('RISING');
    expect(determineTrend(3, 3)).toBe('RISING');
    expect(determineTrend(-4, 3)).toBe('FALLING');
    expect(determineTrend(1.5, 3)).toBe('STABLE');
  });
});
