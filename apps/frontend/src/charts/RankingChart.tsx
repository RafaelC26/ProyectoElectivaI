import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from '../components/ui/primitives';
import { fmtPct } from '../lib/format';
import { STATUS_META, VEHICLE_META } from '../lib/visual';
import { useParking } from '../stores/parking-store';
import type { RankingEntry } from '@uptc/shared';
import { AXIS_PROPS, Legend } from './chart-kit';

const EMPTY: RankingEntry[] = [];

/**
 * Gráfica 3 — Ocupación por zona, de mayor a menor.
 * Fuente: Sorted Set parking:ranking:occupancy (ZREVRANGE … WITHSCORES).
 */
export function RankingChart() {
  const ranking = useParking((s) => s.metrics?.ranking ?? EMPTY);
  const zones = useParking((s) => s.zones);
  const selectZone = useParking((s) => s.selectZone);
  const config = useParking((s) => s.config);
  const warning = config?.thresholds.occupancy.warning ?? 80;
  const critical = config?.thresholds.occupancy.critical ?? 90;

  const data = ranking.map((r) => ({
    ...r,
    label: r.zone_name,
    status: zones[r.zone_id]?.status ?? 'LOW',
  }));

  return (
    <Panel title="Ocupación por zona" subtitle="Ranking en vivo · ZREVRANGE parking:ranking:occupancy">
      <div className="mb-2">
        <Legend
          series={[
            { key: 'car', label: 'Carros', color: VEHICLE_META.CAR.color, width: 6 },
            { key: 'moto', label: 'Motocicletas', color: VEHICLE_META.MOTORCYCLE.color, width: 6 },
          ]}
        />
      </div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36 + 24)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke="var(--color-line)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            {...AXIS_PROPS}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={70}
            {...AXIS_PROPS}
            tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
          />
          <ReferenceLine x={warning} stroke="var(--color-warn)" strokeDasharray="4 4" strokeOpacity={0.7} />
          <ReferenceLine x={critical} stroke="var(--color-serious)" strokeDasharray="4 4" strokeOpacity={0.7} />
          <Tooltip
            cursor={{ fill: 'var(--color-panel-3)', opacity: 0.5 }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !item) return null;
              return (
                <div className="rounded-lg border border-line-2 bg-panel/95 px-3 py-2 text-xs shadow-xl">
                  <div className="font-medium text-ink">
                    #{item.rank} {item.zone_name}
                  </div>
                  <div className="text-ink-2">
                    {fmtPct(item.occupancy)} · {STATUS_META[item.status].label}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="occupancy"
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
            onClick={(entry) => selectZone((entry as unknown as { zone_id: string }).zone_id)}
            cursor="pointer"
          >
            {data.map((d) => (
              <Cell key={d.zone_id} fill={VEHICLE_META[d.vehicle_type].color} />
            ))}
            <LabelList
              dataKey="occupancy"
              position="right"
              content={(props) => {
                const { x, y, width, height, index } = props as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  index: number;
                };
                const item = data[index];
                if (!item) return null;
                return (
                  <text x={x + width + 8} y={y + height / 2} dy={4} fontSize={12} fill="var(--color-ink)">
                    {fmtPct(item.occupancy, 1)}
                    <tspan fill={STATUS_META[item.status].ink} fontSize={10} dx={6}>
                      {STATUS_META[item.status].label.toUpperCase()}
                    </tspan>
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
