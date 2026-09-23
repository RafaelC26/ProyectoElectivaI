import type { VehicleType, ZoneConfig } from '@uptc/shared';
import { LogIn, LogOut } from 'lucide-react';
import { memo } from 'react';
import { useNow } from '../hooks/useNow';
import { cx, fmtPct, fmtRelative } from '../lib/format';
import { STATUS_META, VEHICLE_META } from '../lib/visual';
import { useParking } from '../stores/parking-store';
import { Meter, Panel, StatusBadge, TrendIndicator } from './ui/primitives';

/** Cuadrícula de espacios: cada celda es un puesto; las ocupadas se rellenan. */
const StallGrid = memo(function StallGrid({
  capacity,
  occupied,
  vehicleType,
}: {
  capacity: number;
  occupied: number;
  vehicleType: VehicleType;
}) {
  const columns = 20;
  const color = VEHICLE_META[vehicleType].color;
  return (
    <div
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`${occupied} de ${capacity} espacios ocupados`}
    >
      {Array.from({ length: capacity }, (_, i) => (
        <span
          key={i}
          className="aspect-square rounded-[2px] transition-colors duration-300"
          style={
            i < occupied
              ? { background: color }
              : { background: 'var(--color-panel-2)', boxShadow: 'inset 0 0 0 1px var(--color-line-2)' }
          }
        />
      ))}
    </div>
  );
});

function ZoneTile({ zoneId }: { zoneId: string }) {
  const zone = useParking((s) => s.zones[zoneId]);
  const updatedAt = useParking((s) => s.zoneUpdatedAt[zoneId]);
  const selectZone = useParking((s) => s.selectZone);
  const now = useNow();
  if (!zone) return <div className="h-64 animate-pulse rounded-lg border border-line bg-panel-2" />;

  const status = STATUS_META[zone.status];
  const vehicle = VEHICLE_META[zone.vehicle_type];
  const VehicleIcon = vehicle.icon;

  return (
    <button
      type="button"
      onClick={() => selectZone(zone.zone_id)}
      className="group relative flex min-w-0 flex-col gap-3 rounded-lg border bg-panel-2 p-3.5 text-left transition-colors hover:bg-panel-3 focus-visible:outline-2 focus-visible:outline-car"
      style={{
        borderColor: `color-mix(in srgb, ${status.color} ${zone.status === 'LOW' || zone.status === 'NORMAL' ? 25 : 60}%, var(--color-line))`,
      }}
      aria-label={`${zone.zone_name}: ${fmtPct(zone.occupancy)} de ocupación, estado ${status.label}. Ver detalle`}
    >
      {/* Destello de ~500 ms en cada actualización recibida por WebSocket */}
      {updatedAt && (
        <span
          key={updatedAt}
          className="pointer-events-none absolute inset-0 rounded-lg animate-flash"
          style={{ ['--flash-color' as string]: vehicle.color }}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <VehicleIcon size={15} style={{ color: vehicle.color }} aria-hidden />
            <span className="truncate text-sm font-semibold uppercase tracking-wide text-ink">{zone.zone_name}</span>
          </div>
          <span className="text-[11px] text-ink-2">{vehicle.label}</span>
        </div>
        <StatusBadge status={zone.status} />
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="text-[30px] font-semibold leading-none text-ink tabular">{fmtPct(zone.occupancy)}</span>
        <span className="pb-0.5 text-sm text-ink-2 tabular">
          <b className="text-ink">{zone.occupied}</b> / {zone.capacity}
        </span>
      </div>

      <Meter value={zone.occupancy} color={status.color} label={`Ocupación ${zone.zone_name}`} />

      <StallGrid capacity={zone.capacity} occupied={zone.occupied} vehicleType={zone.vehicle_type} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="text-ink tabular">
          <b>{zone.available}</b> <span className="text-ink-2">espacios disponibles</span>
        </span>
        <TrendIndicator trend={zone.trend} compact delta={zone.trend_delta} />
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-2 tabular" title="Entradas y salidas en el último minuto">
          <span className="inline-flex items-center gap-0.5">
            <LogIn size={12} className="text-in" aria-hidden />
            {zone.entries_per_minute}/min
          </span>
          <span className="inline-flex items-center gap-0.5">
            <LogOut size={12} className="text-out" aria-hidden />
            {zone.exits_per_minute}/min
          </span>
        </span>
        <span className="tabular">{fmtRelative(zone.last_update, now)}</span>
      </div>
    </button>
  );
}

function Lot({ title, zones, vehicleType }: { title: string; zones: ZoneConfig[]; vehicleType: VehicleType }) {
  const Icon = VEHICLE_META[vehicleType].icon;
  return (
    <div className="rounded-lg border border-dashed border-line-2 p-3">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
        <Icon size={14} style={{ color: VEHICLE_META[vehicleType].color }} aria-hidden />
        {title}
      </div>
      <div className={cx('grid gap-3', zones.length >= 3 ? 'sm:grid-cols-2 xl:grid-cols-3' : 'sm:grid-cols-2')}>
        {zones.map((z) => (
          <ZoneTile key={z.id} zoneId={z.id} />
        ))}
      </div>
    </div>
  );
}

export function ParkingMap() {
  const config = useParking((s) => s.config);
  const zones = config?.zones ?? [];
  return (
    <Panel
      title="Plano conceptual del estacionamiento"
      subtitle="Distribución ilustrativa: nombres y capacidades de demostración (config/zones.json), no la ubicación física real. Clic en una zona para ver su detalle."
    >
      <div className="grid gap-4">
        <Lot title="Parqueadero de carros" vehicleType="CAR" zones={zones.filter((z) => z.vehicleType === 'CAR')} />
        <Lot
          title="Parqueadero de motocicletas"
          vehicleType="MOTORCYCLE"
          zones={zones.filter((z) => z.vehicleType === 'MOTORCYCLE')}
        />
      </div>
    </Panel>
  );
}
