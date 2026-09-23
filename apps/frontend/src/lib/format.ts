const timeFmt = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const dateTimeFmt = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const intFmt = new Intl.NumberFormat('es-CO');

export function fmtTime(value: number | string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return timeFmt.format(new Date(value));
}

export function fmtDateTime(value: number | string | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(new Date(value));
}

export function fmtInt(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : intFmt.format(value);
}

/** 91.25 → "91.25%" (zonas) · decimals=1 → "82.4%" (agregados). */
export function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const fixed = value.toFixed(decimals);
  return `${decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed}%`;
}

/** Variación en puntos porcentuales con signo: +2.1 pp / −0.4 pp */
export function fmtDelta(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return `${sign}${Math.abs(value).toFixed(decimals)} pp`;
}

export function fmtRelative(from: number | string | null | undefined, now: number): string {
  if (!from) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  if (seconds < 2) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ${seconds % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
