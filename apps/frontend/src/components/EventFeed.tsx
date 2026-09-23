import type { ParkingEvent } from '@uptc/shared';
import { memo, useMemo, useState } from 'react';
import { cx, fmtTime } from '../lib/format';
import { STATUS_META, eventVisual } from '../lib/visual';
import { useParking, type FeedItem } from '../stores/parking-store';
import { Panel, Segmented } from './ui/primitives';

type Filter = 'all' | 'vehicle' | 'state' | 'system';

function describe(event: ParkingEvent): { zone: string; detail: string } {
  if (event.entity_id === 'SIMULATOR') {
    const data = event.data as { message: string };
    return { zone: 'Simulador', detail: data.message };
  }
  const data = event.data as {
    zone_name: string;
    occupied: number;
    capacity: number;
    occupancy: number;
    status?: keyof typeof STATUS_META;
    previous_status?: keyof typeof STATUS_META;
  };
  let detail = `${data.occupied}/${data.capacity} · ${data.occupancy}%`;
  if (event.event_type === 'ZONE_STATUS_CHANGED' && data.previous_status && data.status) {
    detail = `${STATUS_META[data.previous_status].label} → ${STATUS_META[data.status].label} · ${data.occupancy}%`;
  }
  return { zone: data.zone_name, detail };
}

const Row = memo(function Row({ item }: { item: FeedItem }) {
  const { event } = item;
  const vehicle = 'vehicle_type' in event.data ? event.data.vehicle_type : undefined;
  const visual = eventVisual(event.event_type, vehicle);
  const Icon = visual.icon;
  const { zone, detail } = describe(event);
  const manual = event.metadata.manual;
  return (
    <li
      className={cx(
        'grid grid-cols-[64px_18px_minmax(0,1fr)] items-center gap-x-2 border-b border-line/60 px-1 py-1.5 font-mono text-[11.5px]',
        item.live && 'animate-row-in',
      )}
    >
      <span className="text-ink-3 tabular">{fmtTime(event.timestamp)}</span>
      <Icon size={14} style={{ color: visual.color }} aria-hidden />
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-semibold text-ink">{event.event_type}</span>
        <span className="shrink-0 font-sans text-ink-2">{zone}</span>
        <span className="truncate text-ink-3">{detail}</span>
        {manual && <span className="shrink-0 rounded bg-panel-3 px-1 font-sans text-[10px] text-ink-2">manual</span>}
      </span>
    </li>
  );
});

/** ACTIVIDAD EN TIEMPO REAL — eventos de sensor, derivados y del sistema a medida que llegan. */
export function EventFeed({ className }: { className?: string }) {
  const feed = useParking((s) => s.feed);
  const [filter, setFilter] = useState<Filter>('all');
  const items = useMemo(
    () =>
      filter === 'all'
        ? feed
        : feed.filter((f) => {
            const vehicle = 'vehicle_type' in f.event.data ? f.event.data.vehicle_type : undefined;
            return eventVisual(f.event.event_type, vehicle).category === filter;
          }),
    [feed, filter],
  );

  return (
    <Panel
      title="Actividad en tiempo real"
      subtitle="parking:event vía Socket.IO"
      className={cx('flex flex-col', className)}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2 p-3"
      actions={
        <Segmented
          label="Filtro de eventos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'vehicle', label: 'Vehículos' },
            { value: 'state', label: 'Estados' },
            { value: 'system', label: 'Sistema' },
          ]}
        />
      }
    >
      <ol
        className="min-h-0 flex-1 overflow-y-auto"
        aria-live="off"
        aria-label="Eventos recientes, el más nuevo primero"
      >
        {items.length ? (
          items.map((item) => <Row key={item.key} item={item} />)
        ) : (
          <li className="py-6 text-center text-sm text-ink-3">Esperando eventos…</li>
        )}
      </ol>
    </Panel>
  );
}
