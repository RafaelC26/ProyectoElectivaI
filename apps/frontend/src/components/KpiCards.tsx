import type { GroupMetrics } from '@uptc/shared';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bike,
  Car,
  ParkingCircle,
  Siren,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { fmtDelta, fmtInt, fmtPct } from '../lib/format';
import { useParking } from '../stores/parking-store';
import { Meter } from './ui/primitives';

function Kpi({
  label,
  icon,
  value,
  suffix,
  children,
  accent,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  suffix?: ReactNode;
  children?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between text-ink-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold leading-none text-ink tabular">{value}</span>
        {suffix && <span className="text-sm text-ink-2 tabular">{suffix}</span>}
      </div>
      {children}
    </div>
  );
}

function Variation({ metrics }: { metrics: GroupMetrics }) {
  const v = metrics.variation_5m;
  const Icon = v > 0.05 ? ArrowUpRight : v < -0.05 ? ArrowDownRight : ArrowRight;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2 tabular">
      <Icon size={13} className="text-ink" aria-hidden />
      {fmtDelta(v)} últimos 5 min
    </span>
  );
}

function GroupKpi({
  label,
  metrics,
  color,
  icon,
}: {
  label: string;
  metrics: GroupMetrics;
  color: string;
  icon: ReactNode;
}) {
  return (
    <Kpi label={label} icon={icon} accent={color} value={`${metrics.occupied} / ${metrics.capacity}`}>
      <Meter value={metrics.occupancy} color={color} label={`Ocupación ${label}`} />
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-ink tabular">{fmtPct(metrics.occupancy, 1)}</span>
        <Variation metrics={metrics} />
      </div>
    </Kpi>
  );
}

export function KpiCards() {
  const metrics = useParking((s) => s.metrics);
  const zones = useParking((s) => s.zones);
  if (!metrics) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[118px] animate-pulse rounded-xl border border-line bg-panel" />
        ))}
      </div>
    );
  }
  const { global, cars, motorcycles } = metrics;
  const top = metrics.ranking[0];
  const criticalNames = Object.values(zones)
    .filter((z) => z.status === 'CRITICAL' || z.status === 'FULL')
    .map((z) => z.zone_name.replace('Zona ', ''));

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Ocupación global" icon={<ParkingCircle size={16} />} value={fmtPct(global.occupancy, 1)}>
        <Meter value={global.occupancy} color="var(--color-ink-2)" label="Ocupación global" />
        <div className="flex items-center justify-between text-xs text-ink-2">
          <span className="tabular">
            {global.occupied} / {global.capacity}
          </span>
          <Variation metrics={global} />
        </div>
      </Kpi>

      <GroupKpi label="Ocupación carros" metrics={cars} color="var(--color-car)" icon={<Car size={16} />} />
      <GroupKpi label="Ocupación motos" metrics={motorcycles} color="var(--color-moto)" icon={<Bike size={16} />} />

      <Kpi label="Disponibles" icon={<ParkingCircle size={16} />} value={fmtInt(global.available)} suffix="espacios">
        <div className="mt-auto flex gap-4 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1 tabular">
            <Car size={13} className="text-car" aria-hidden /> Carros: <b className="text-ink">{cars.available}</b>
          </span>
          <span className="inline-flex items-center gap-1 tabular">
            <Bike size={13} className="text-moto" aria-hidden /> Motos:{' '}
            <b className="text-ink">{motorcycles.available}</b>
          </span>
        </div>
      </Kpi>

      <Kpi
        label="Zonas críticas"
        icon={<Siren size={16} />}
        accent={global.critical_zones ? 'var(--color-crit-ink)' : undefined}
        value={global.critical_zones}
        suffix={`de ${global.zones}`}
      >
        <p className="mt-auto truncate text-xs text-ink-2">
          {criticalNames.length ? criticalNames.join(' · ') : 'Ninguna zona ≥ 90 %'}
          {top && (
            <>
              <br />
              Más ocupada: <b className="text-ink">{top.zone_name}</b> ({fmtPct(top.occupancy, 1)})
            </>
          )}
        </p>
      </Kpi>

      <Kpi label="Flujo último minuto" icon={<ArrowLeftRight size={16} />} value={global.entries_1m} suffix="entradas">
        <div className="mt-auto space-y-0.5 text-xs text-ink-2 tabular">
          <div>
            <span className="text-ink">{global.exits_1m}</span> salidas / min
          </div>
          <div>
            Últimos 5 min: {global.entries_5m} entradas · {global.exits_5m} salidas
          </div>
        </div>
      </Kpi>
    </div>
  );
}
