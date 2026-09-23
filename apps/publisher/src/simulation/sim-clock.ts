import type { SimulationMode } from '@uptc/shared';
import { formatClock, parseClock } from './demand-profile';

/**
 * Reloj simulado.
 *  - REAL_TIME_PROFILE: usa la hora actual (zona horaria configurable, por defecto America/Bogota).
 *  - ACCELERATED_DEMO: avanza timeScale veces más rápido (60 → 1 minuto real = 1 hora simulada)
 *    y recorre sólo la jornada [dayStart, dayEnd); al terminar salta al día siguiente.
 */
export class SimulatedClock {
  private minute: number;
  day = 1;

  constructor(
    public mode: SimulationMode,
    private readonly startTime: string,
    private readonly dayStart: string,
    private readonly dayEnd: string,
    private readonly timeZone: string,
  ) {
    this.minute = parseClock(startTime);
  }

  /** Avanza el reloj acelerado. Devuelve true si comenzó un nuevo día. */
  advance(simMinutes: number): boolean {
    if (this.mode !== 'ACCELERATED_DEMO') return false;
    this.minute += simMinutes;
    if (this.minute >= parseClock(this.dayEnd)) {
      this.minute = parseClock(this.dayStart);
      this.day += 1;
      return true;
    }
    return false;
  }

  minuteOfDay(): number {
    if (this.mode === 'ACCELERATED_DEMO') return this.minute;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return hour * 60 + minute;
  }

  label(): string {
    return formatClock(this.minuteOfDay());
  }

  restore(minute: number, day: number): void {
    this.minute = minute;
    this.day = Math.max(1, day);
  }

  reset(): void {
    this.minute = parseClock(this.startTime);
    this.day = 1;
  }

  rawMinute(): number {
    return this.minute;
  }
}
