import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, Segmented } from '../components/ui/primitives';
import { fmtTime } from '../lib/format';
import { useParking } from '../stores/parking-store';
import {
  AXIS_PROPS,
  ChartEmpty,
  ChartTooltip,
  GRID_PROPS,
  Legend,
  endLabel,
  spreadLabels,
  type SeriesDef,
} from './chart-kit';

const HEIGHT = 240;
type Scope = 'ALL' | 'CAR' | 'MOTORCYCLE';

const SERIES: SeriesDef[] = [
  { key: 'entries', label: 'Entradas', color: '#047857' },
  { key: 'exits', label: 'Salidas', color: '#c2410c' },
];

/**
 * Gráfica 2 — Entradas vs salidas (vehículos por minuto, ventana deslizante de 60 s).
 * Las ventanas se calculan en Redis con Sorted Sets (ZCOUNT sobre parking:window:*).
 */
export function FlowChart() {
  const samples = useParking((s) => s.samples);
  const [scope, setScope] = useState<Scope>('ALL');
  const [minutes, setMinutes] = useState<5 | 15>(5);

  const data = useMemo(() => {
    const cutoff = Date.now() - minutes * 60_000;
    return samples
      .filter((s) => s.ts >= cutoff)
      .map((s) => ({
        ts: s.ts,
        entries: scope === 'ALL' ? s.entries_1m : scope === 'CAR' ? s.entries_1m_cars : s.entries_1m_motorcycles,
        exits: scope === 'ALL' ? s.exits_1m : scope === 'CAR' ? s.exits_1m_cars : s.exits_1m_motorcycles,
      }));
  }, [samples, scope, minutes]);
  const last = data[data.length - 1];
  const peak = data.reduce((m, d) => Math.max(m, d.entries, d.exits), 0);
  const yMax = Math.max(5, Math.ceil((peak * 1.15) / 5) * 5);
  const offsets = spreadLabels(
    SERIES.map((s) => ({ key: s.key, value: last?.[s.key as 'entries' | 'exits'] })),
    (HEIGHT - 8 - 30) / yMax,
  );

  return (
    <Panel
      title="Entradas vs salidas"
      subtitle="Vehículos por minuto (ventana móvil de 60 s)"
      actions={
        <>
          <Segmented
            label="Tipo de vehículo"
            value={scope}
            options={[
              { value: 'ALL', label: 'Todos' },
              { value: 'CAR', label: 'Carros' },
              { value: 'MOTORCYCLE', label: 'Motos' },
            ]}
            onChange={setScope}
          />
          <Segmented
            label="Rango"
            value={minutes}
            options={[
              { value: 5, label: '5 min' },
              { value: 15, label: '15 min' },
            ]}
            onChange={setMinutes}
          />
        </>
      }
    >
      <div className="mb-2">
        <Legend series={SERIES} />
      </div>
      {data.length < 2 ? (
        <ChartEmpty height={HEIGHT}>Recolectando muestras…</ChartEmpty>
      ) : (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={data} margin={{ top: 8, right: 104, bottom: 0, left: -8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => fmtTime(v)}
              minTickGap={48}
              {...AXIS_PROPS}
            />
            <YAxis domain={[0, yMax]} allowDecimals={false} width={44} {...AXIS_PROPS} tickFormatter={(v) => `${v}`} />
            <Tooltip
              cursor={{ stroke: 'var(--color-ink-3)', strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  payload={payload as never}
                  label={label as number}
                  series={SERIES}
                  unit=" veh/min"
                />
              )}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-panel)', strokeWidth: 2 }}
                isAnimationActive={false}
                type="monotone"
                label={endLabel(
                  `${s.label} ${last?.[s.key as 'entries' | 'exits'] ?? ''}`,
                  s.color,
                  data.length - 1,
                  offsets[s.key] ?? 0,
                )}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <table className="sr-only">
        <caption>Flujo del último minuto</caption>
        <tbody>
          <tr>
            <th>Entradas por minuto</th>
            <td>{last?.entries ?? '—'}</td>
          </tr>
          <tr>
            <th>Salidas por minuto</th>
            <td>{last?.exits ?? '—'}</td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}
