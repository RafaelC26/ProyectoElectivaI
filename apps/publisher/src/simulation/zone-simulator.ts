import { applyMovement, clampOccupied, type MovementKind, type ZoneConfig } from '@uptc/shared';

/**
 * Lectura "cruda" tal como la entregaría un sensor de conteo en la entrada/salida de la zona.
 * Formato propio del dispositivo (camelCase, dirección IN/OUT, epoch ms): el Publisher
 * la NORMALIZA al modelo de eventos común antes de validarla y publicarla.
 */
export interface RawSensorReading {
  sensorId: string;
  zoneId: string;
  direction: 'IN' | 'OUT';
  count: number;
  capacity: number;
  detectedAt: number;
  simClock: string;
  window: { in: number; out: number };
  scenario: string;
  manual: boolean;
}

const WINDOW_MS = 60_000;

/** Sensor virtual de una zona: conserva la ocupación anterior (continuidad) y respeta la capacidad. */
export class ZoneSimulator {
  private recent: Array<{ at: number; kind: MovementKind }> = [];
  occupied: number;

  constructor(
    readonly config: ZoneConfig,
    occupied: number,
  ) {
    this.occupied = clampOccupied(occupied, config.capacity);
  }

  get capacity(): number {
    return this.config.capacity;
  }

  get ratio(): number {
    return this.occupied / this.config.capacity;
  }

  /** occupied(t+1) = occupied(t) ± 1, nunca < 0 ni > capacity. Devuelve null si el movimiento es imposible. */
  apply(kind: MovementKind, now: number): number | null {
    const result = applyMovement(this.occupied, this.config.capacity, kind);
    if (!result.applied) return null;
    this.occupied = result.occupied;
    this.recent.push({ at: now, kind });
    this.prune(now);
    return this.occupied;
  }

  /** Conteo del propio sensor en el último minuto (dato de diagnóstico que viaja en el evento). */
  windowCounts(now: number): { in: number; out: number } {
    this.prune(now);
    let entries = 0;
    for (const m of this.recent) if (m.kind === 'ENTRY') entries++;
    return { in: entries, out: this.recent.length - entries };
  }

  set(occupied: number): void {
    this.occupied = clampOccupied(occupied, this.config.capacity);
    this.recent = [];
  }

  private prune(now: number): void {
    while (this.recent.length && now - this.recent[0].at > WINDOW_MS) this.recent.shift();
  }
}
