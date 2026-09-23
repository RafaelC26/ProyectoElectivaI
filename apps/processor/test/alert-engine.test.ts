import type { Alert, AlertType } from '@uptc/shared';
import { describe, expect, it } from 'vitest';
import {
  evaluateGroupAlerts,
  evaluateZoneAlerts,
  nextLevel,
  resolvedCopy,
  type AlertLevel,
  type CooldownKey,
  type ZoneAlertResult,
} from '../src/alerts/alert-engine';
import { THRESHOLDS, zoneState } from './fixtures';

/** Simula la persistencia del AlertService en memoria para recorrer secuencias completas. */
class AlertHarness {
  level: AlertLevel = 'NONE';
  active: Partial<Record<AlertType, Alert>> = {};
  cooldowns = new Set<CooldownKey>();
  private seq = 0;

  step(occupied: number, unusualIncrease: number | null = null): ZoneAlertResult {
    const result = evaluateZoneAlerts({
      zone: zoneState(occupied),
      level: this.level,
      active: { ...this.active },
      cooldowns: this.cooldowns,
      unusualIncrease,
      thresholds: THRESHOLDS,
      timestamp: new Date().toISOString(),
    });
    for (const r of result.resolve) delete this.active[r.alert.type];
    for (const draft of result.raise) this.active[draft.type] = { id: `alert_${++this.seq}`, ...draft };
    for (const c of result.cooldowns) this.cooldowns.add(c);
    this.level = result.level;
    return result;
  }
}

const types = (r: ZoneAlertResult) => r.raise.map((a) => a.type);

describe('máquina de estados de alertas (secciones 72–80)', () => {
  it('secuencia de la sección 131: 78 % → 82 % → 91 % → 100 % → 75 %', () => {
    const h = new AlertHarness();
    expect(types(h.step(62))).toEqual([]); // 77.5 %
    expect(types(h.step(66))).toEqual(['OCCUPANCY_WARNING']); // 82.5 %

    const critical = h.step(73); // 91.25 %
    expect(types(critical)).toEqual(['HIGH_OCCUPANCY']);
    expect(critical.resolve.map((r) => [r.alert.type, r.resolution])).toEqual([['OCCUPANCY_WARNING', 'ESCALATED']]);
    expect(critical.raise[0]).toMatchObject({ severity: 'CRITICAL', value: 91.25, threshold: 90, status: 'ACTIVE' });

    const full = h.step(80);
    expect(types(full)).toEqual(['PARKING_FULL']);
    expect(full.raise[0].severity).toBe('CRITICAL');

    const recovered = h.step(60); // 75 %
    expect(recovered.recovered).toBe(true);
    expect(recovered.resolve.map((r) => r.resolution)).toContain('RECOVERED');
    expect(recovered.cooldowns).toContain('OCCUPANCY');
    expect(Object.keys(h.active)).toEqual([]);
  });

  it('no genera alertas duplicadas mientras el nivel se mantiene', () => {
    const h = new AlertHarness();
    h.step(73);
    for (const occupied of [73, 74, 73, 75, 74]) {
      const r = h.step(occupied);
      expect(r.raise.filter((a) => a.type === 'HIGH_OCCUPANCY')).toEqual([]);
    }
  });

  it('aplica histéresis: bajar de CRITICAL exige < 88 %', () => {
    expect(nextLevel('CRITICAL', 89, THRESHOLDS)).toBe('CRITICAL');
    expect(nextLevel('CRITICAL', 87.5, THRESHOLDS)).toBe('WARNING');
    expect(nextLevel('WARNING', 78.75, THRESHOLDS)).toBe('WARNING');
    expect(nextLevel('WARNING', 77.5, THRESHOLDS)).toBe('NONE');
    expect(nextLevel('NONE', 90, THRESHOLDS)).toBe('CRITICAL'); // escalar es inmediato
  });

  it('el cooldown (TTL) evita volver a alertar tras una recuperación reciente', () => {
    const h = new AlertHarness();
    h.step(66); // WARNING
    h.step(60); // recuperada → cooldown
    const again = h.step(66);
    expect(types(again)).toEqual([]);
    expect(again.level).toBe('WARNING');
    h.cooldowns.clear(); // el TTL expiró
    expect(types(h.step(66))).toEqual(['OCCUPANCY_WARNING']);
  });

  it('LOW_AVAILABILITY: available <= 5, se resuelve al superar 5 + histéresis', () => {
    const h = new AlertHarness();
    expect(types(h.step(75))).toContain('LOW_AVAILABILITY');
    expect(h.active.LOW_AVAILABILITY?.value).toBe(5);
    expect(h.step(74).resolve).toEqual([]); // 6 disponibles: todavía dentro de la histéresis
    const cleared = h.step(72);
    expect(cleared.resolve.map((r) => [r.alert.type, r.resolution])).toContainEqual([
      'LOW_AVAILABILITY',
      'CONDITION_CLEARED',
    ]);
  });

  it('PARKING_FULL reemplaza a LOW_AVAILABILITY', () => {
    const h = new AlertHarness();
    h.step(77);
    const full = h.step(80);
    expect(types(full)).toContain('PARKING_FULL');
    expect(full.resolve.map((r) => [r.alert.type, r.resolution])).toContainEqual(['LOW_AVAILABILITY', 'ESCALATED']);
  });

  it('UNUSUAL_OCCUPANCY_INCREASE: >= 20 pp en la ventana', () => {
    const h = new AlertHarness();
    expect(types(h.step(40, 12))).toEqual([]);
    const raised = h.step(50, 25);
    expect(types(raised)).toEqual(['UNUSUAL_OCCUPANCY_INCREASE']);
    expect(raised.raise[0]).toMatchObject({ unit: 'pp', value: 25, threshold: 20 });
    const cleared = h.step(50, 4);
    expect(cleared.resolve[0].resolution).toBe('CONDITION_CLEARED');
  });

  it('la alerta resuelta conserva sus datos y registra fecha y motivo', () => {
    const h = new AlertHarness();
    h.step(73);
    const r = h.step(60);
    const resolved = resolvedCopy(r.resolve[0], '2026-09-22T15:00:00.000Z');
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolution: 'RECOVERED',
      resolved_at: '2026-09-22T15:00:00.000Z',
      type: 'HIGH_OCCUPANCY',
    });
  });
});

describe('alertas por tipo de parqueadero (sección 78)', () => {
  const car = (id: string, status: 'FULL' | 'CRITICAL') => ({
    ...zoneState(0),
    zone_id: id,
    vehicle_type: 'CAR' as const,
    capacity: 50,
    status,
    available: status === 'FULL' ? 0 : 3,
  });

  it('CAR_PARKING_FULL cuando todas las zonas de carros están llenas', () => {
    const { raise } = evaluateGroupAlerts([car('A', 'FULL'), car('B', 'FULL'), zoneState(40)], {}, 'now');
    expect(raise.map((a) => a.type)).toEqual(['CAR_PARKING_FULL']);
  });

  it('se resuelve cuando alguna zona libera espacios', () => {
    const active = { CAR_PARKING_FULL: { id: 'alert_9', type: 'CAR_PARKING_FULL' } as Alert };
    const { resolve } = evaluateGroupAlerts([car('A', 'FULL'), car('B', 'CRITICAL')], active, 'now');
    expect(resolve.map((r) => r.resolution)).toEqual(['RECOVERED']);
  });
});
