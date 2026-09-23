import type { MetricsSample } from '@uptc/shared';

export type SampleSelector = (sample: MetricsSample) => number | undefined;

/**
 * Copia en memoria de las muestras recientes de parking:timeseries (últimos ~16 min).
 * La fuente de verdad es el Stream de Redis; esta copia se reconstruye con XRANGE al
 * iniciar el Processor y permite calcular ventanas temporales sin consultar Redis por evento.
 */
export class SampleHistory {
  private samples: MetricsSample[] = [];

  constructor(private readonly maxAgeMs = 16 * 60_000) {}

  load(samples: MetricsSample[]): void {
    this.samples = [...samples].sort((a, b) => a.ts - b.ts);
  }

  add(sample: MetricsSample): void {
    this.samples.push(sample);
    const cutoff = sample.ts - this.maxAgeMs;
    while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  /** Valor en el instante ts: última muestra con ts <= instante (o la más antigua disponible). */
  valueAt(select: SampleSelector, ts: number): number | null {
    let found: number | undefined;
    for (const s of this.samples) {
      const v = select(s);
      if (v === undefined) continue;
      if (s.ts <= ts || found === undefined) found = v;
      if (s.ts > ts) break;
    }
    return found ?? null;
  }

  /** Promedio de las muestras con ts >= since. */
  average(select: SampleSelector, since: number): number | null {
    let sum = 0;
    let count = 0;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].ts >= since; i--) {
      const v = select(this.samples[i]);
      if (v === undefined) continue;
      sum += v;
      count++;
    }
    return count ? sum / count : null;
  }

  /** Mínimo de las muestras con ts >= since. */
  min(select: SampleSelector, since: number): number | null {
    let min: number | null = null;
    for (let i = this.samples.length - 1; i >= 0 && this.samples[i].ts >= since; i--) {
      const v = select(this.samples[i]);
      if (v !== undefined && (min === null || v < min)) min = v;
    }
    return min;
  }
}

export const zoneSelector =
  (zoneId: string): SampleSelector =>
  (s) =>
    s.zones[zoneId];
