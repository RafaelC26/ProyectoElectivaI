import type { ReactNode } from 'react';
import { fmtTime } from '../lib/format';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  width?: number;
  dash?: string;
}

export const AXIS_PROPS = {
  stroke: 'var(--color-line-2)',
  tick: { fill: 'var(--color-ink-3)', fontSize: 11 },
  tickLine: false,
} as const;

export const GRID_PROPS = { stroke: 'var(--color-line)', strokeDasharray: '0', vertical: false } as const;

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

/** Tooltip común: hora + valor de cada serie; el texto usa tokens de texto, el color sólo la muestra. */
export function ChartTooltip({
  active,
  payload,
  label,
  series,
  unit,
  labelFormatter = (v) => fmtTime(Number(v)),
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number | string;
  series: SeriesDef[];
  unit: string;
  labelFormatter?: (value: number | string) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p]));
  return (
    <div className="min-w-[160px] rounded-lg border border-line-2 bg-panel/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 font-mono text-ink-2">{label !== undefined ? labelFormatter(label) : ''}</div>
      {series.map((s) => {
        const entry = byKey.get(s.key);
        if (!entry || entry.value === undefined || entry.value === null) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-medium text-ink tabular">
              {typeof entry.value === 'number'
                ? entry.value.toLocaleString('es-CO', { maximumFractionDigits: 2 })
                : entry.value}
              {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Leyenda">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <svg width="14" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="14"
              y2="3"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              strokeLinecap="round"
            />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Etiqueta directa al final de cada línea (sólo en el último punto). dyPx separa etiquetas cercanas. */
export function endLabel(text: string, color: string, lastIndex: number, dyPx = 0) {
  return function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    if (props.index !== lastIndex || props.x === undefined || props.y === undefined) return null;
    const x = Number(props.x);
    const y = Number(props.y);
    return (
      <g>
        <circle cx={x} cy={y} r={3.5} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
        {dyPx !== 0 && <line x1={x + 4} y1={y} x2={x + 7} y2={y + dyPx} stroke={color} strokeWidth={1} />}
        <text x={x + 9} y={y + dyPx} dy={4} fontSize={11} fill="var(--color-ink)" fontWeight={500}>
          {text}
        </text>
      </g>
    );
  };
}

/**
 * Evita que las etiquetas directas se superpongan: ordena los últimos valores y separa las
 * etiquetas al menos `minGapPx` píxeles. Devuelve el desplazamiento vertical (px) de cada serie.
 */
export function spreadLabels(
  values: Array<{ key: string; value: number | undefined }>,
  pxPerUnit: number,
  minGapPx = 13,
): Record<string, number> {
  const items = values
    .filter((v): v is { key: string; value: number } => typeof v.value === 'number')
    .map((v) => ({ key: v.key, y: -v.value * pxPerUnit }))
    .sort((a, b) => a.y - b.y);
  const placed: Array<{ key: string; y: number; target: number }> = [];
  for (const item of items) {
    const prev = placed[placed.length - 1];
    const y = prev && item.y - prev.y < minGapPx ? prev.y + minGapPx : item.y;
    placed.push({ key: item.key, y, target: item.y });
  }
  // Centra el bloque desplazado alrededor de las posiciones originales.
  const shift = placed.reduce((acc, p) => acc + (p.y - p.target), 0) / Math.max(1, placed.length);
  return Object.fromEntries(placed.map((p) => [p.key, p.y - p.target - shift]));
}

export function ChartEmpty({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      className="grid place-items-center rounded-lg border border-dashed border-line text-sm text-ink-3"
      style={{ height }}
    >
      {children}
    </div>
  );
}
