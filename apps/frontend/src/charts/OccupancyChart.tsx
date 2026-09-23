import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, Segmented } from '../components/ui/primitives';
import { fmtPct, fmtTime } from '../lib/format';
import { GROUP_COLORS, zoneColor } from '../lib/visual';
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

const HEIGHT = 280;
/** Alto aproximado del área de trazado (alto − márgenes − eje X) para convertir % a píxeles. */
const PLOT_PX = HEIGHT - 8 - 30;

/**
 * Gráfica 1 — Evolución de ocupación (eje X tiempo, eje Y % de ocupación).
 * Fuente: Stream parking:timeseries (carga inicial por REST + muestras en vivo por WebSocket).
 */
export function OccupancyChart() {
  const samples = useParking((s) => s.samples);
  const config = useParking((s) => s.config);
  const [filter, setFilter] = useState<string>('ALL');
  const [minutes, setMinutes] = useState<5 | 15>(5);

  const zones = config?.zones ?? [];
  const warning = config?.thresholds.occupancy.warning ?? 80;
  const critical = config?.thresholds.occupancy.critical ?? 90;

  const series: SeriesDef[] = useMemo(() => {
    if (filter === 'ALL') {
      return [
        { key: 'global', label: 'Global', color: GROUP_COLORS.global, width: 2.5 },
        { key: 'cars', label: 'Carros', color: GROUP_COLORS.cars },
        { key: 'motorcycles', label: 'Motocicletas', color: GROUP_COLORS.motorcycles },
      ];
    }
    const subset =
      filter === 'CAR' || filter === 'MOTORCYCLE'
        ? zones.filter((z) => z.vehicleType === filter)
        : zones.filter((z) => z.id === filter);
    return subset.map((z, i) => ({ key: z.id, label: z.name, color: zoneColor(z.id, i) }));
  }, [filter, zones]);

  const data = useMemo(() => {
    const cutoff = Date.now() - minutes * 60_000;
    return samples
      .filter((s) => s.ts >= cutoff)
      .map((s) => ({
        ts: s.ts,
        sim: s.simulated_time,
        global: s.global,
        cars: s.cars,
        motorcycles: s.motorcycles,
        ...s.zones,
      }));
  }, [samples, minutes]);

  const last = data[data.length - 1] as unknown as Record<string, number> | undefined;
  const offsets = spreadLabels(
    series.map((s) => ({ key: s.key, value: last?.[s.key] })),
    PLOT_PX / 100,
  );

  const options = [
    { value: 'ALL', label: 'Todas' },
    { value: 'CAR', label: 'Carros' },
    { value: 'MOTORCYCLE', label: 'Motocicletas' },
  ];

  return (
    <Panel
      title="Evolución de ocupación"
      subtitle="Porcentaje de ocupación en el tiempo · muestras cada 2 s desde parking:timeseries"
      actions={
        <>
          <Segmented
            label="Filtro de series"
            value={filter === 'ALL' || filter === 'CAR' || filter === 'MOTORCYCLE' ? filter : ''}
            options={options}
            onChange={setFilter}
          />
          <select
            aria-label="Zona específica"
            value={zones.some((z) => z.id === filter) ? filter : ''}
            onChange={(e) => setFilter(e.target.value || 'ALL')}
            className="rounded-lg border border-line bg-bg px-2 py-1 text-xs text-ink"
          >
            <option value="">Zona específica…</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
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
        <Legend series={series} />
      </div>
      {data.length < 2 ? (
        <ChartEmpty height={HEIGHT}>Recolectando muestras…</ChartEmpty>
      ) : (
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={data} margin={{ top: 8, right: 132, bottom: 0, left: -8 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => fmtTime(v)}
              minTickGap={48}
              {...AXIS_PROPS}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v) => `${v}%`}
              width={48}
              {...AXIS_PROPS}
            />
            <ReferenceLine
              y={warning}
              stroke="var(--color-warn)"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={{
                value: `${warning}% advertencia`,
                position: 'insideTopLeft',
                fill: 'var(--color-ink-2)',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={critical}
              stroke="var(--color-serious)"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              label={{
                value: `${critical}% crítico`,
                position: 'insideTopLeft',
                fill: 'var(--color-ink-2)',
                fontSize: 10,
              }}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-ink-3)', strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  payload={payload as never}
                  label={label as number}
                  series={series}
                  unit="%"
                />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.width ?? 2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-panel)', strokeWidth: 2 }}
                isAnimationActive={false}
                label={endLabel(
                  `${s.label} ${fmtPct(last?.[s.key], 1)}`,
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
        <caption>Ocupación actual por serie</caption>
        <tbody>
          {series.map((s) => (
            <tr key={s.key}>
              <th>{s.label}</th>
              <td>{fmtPct(last?.[s.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
