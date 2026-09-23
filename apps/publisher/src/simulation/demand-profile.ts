import { DemandProfile, type ScheduleEntry } from '@uptc/shared';

export { DemandProfile };

export interface ActiveProfile {
  profile: DemandProfile;
  entryWeight: number;
  exitWeight: number;
  /** Movimientos esperados por minuto simulado, como fracción de la capacidad. */
  intensity: number;
  from: string;
  to: string;
}

export function parseClock(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function formatClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function inRange(minute: number, from: number, to: number): boolean {
  // Rangos que cruzan la medianoche (p. ej. 18:00 → 06:00).
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

/**
 * Perfil de demanda vigente para un minuto del día:
 *   07–08 HIGH_ENTRY · 08–12 STABLE · 12–14 HIGH_EXIT · 14–17 MEDIUM · 17–18 HIGH_EXIT · resto LOW
 */
export function resolveProfile(schedule: ScheduleEntry[], minuteOfDay: number): ActiveProfile {
  const entry =
    schedule.find((s) => inRange(minuteOfDay, parseClock(s.from), parseClock(s.to))) ?? schedule[schedule.length - 1];
  return {
    profile: DemandProfile[entry.profile],
    entryWeight: entry.entryWeight,
    exitWeight: entry.exitWeight,
    intensity: entry.intensity,
    from: entry.from,
    to: entry.to,
  };
}
