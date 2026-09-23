import type { ParkingEvent, SimulatorCommandInput } from '@uptc/shared';
import { Ban, LogIn, LogOut, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_PROPS } from '../charts/chart-kit';
import { useNow } from '../hooks/useNow';
import { fmtDelta, fmtPct, fmtRelative, fmtTime } from '../lib/format';
import { ALERT_TYPE_LABEL, SEVERITY_META, STATUS_META, VEHICLE_META, eventVisual, zoneColor } from '../lib/visual';
import { api } from '../services/api';
import { useParking } from '../stores/parking-store';
import { Button, KeyValue, Meter, StatusBadge, TrendIndicator } from './ui/primitives';

function Section({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">{title}</h4>
        <code className="truncate font-mono text-[10px] text-ink-3">{source}</code>
      </div>
      {children}
    </section>
  );
}

export function ZoneDrawer() {
  const zoneId = useParking((s) => s.selectedZone);
  const selectZone = useParking((s) => s.selectZone);
  const zone = useParking((s) => (zoneId ? s.zones[zoneId] : undefined));
  const samples = useParking((s) => s.samples);
  const feed = useParking((s) => s.feed);
  const activeAlerts = useParking((s) => s.activeAlerts);
  const selectAlert = useParking((s) => s.selectAlert);
  const thresholds = useParking((s) => s.config?.thresholds);
  const now = useNow();
  const [history, setHistory] = useState<ParkingEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!zoneId) return;
    setHistory([]);
    let cancelled = false;
    api
      .zoneHistory(zoneId, 15, 30)
      .then((h) => !cancelled && setHistory(h.events))
      .catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selectZone(null);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [zoneId, selectZone]);

  const series = useMemo(
    () =>
      zoneId
        ? samples.filter((s) => s.zones[zoneId] !== undefined).map((s) => ({ ts: s.ts, occupancy: s.zones[zoneId] }))
        : [],
    [samples, zoneId],
  );

  const events = useMemo(() => {
    if (!zoneId) return [];
    const live = feed.filter((f) => f.event.entity_id === zoneId).map((f) => f.event);
    const seen = new Set(live.map((e) => e.event_id));
    return [...live, ...history.filter((e) => !seen.has(e.event_id))].slice(0, 25);
  }, [feed, history, zoneId]);

  if (!zoneId || !zone) return null;
  const vehicle = VEHICLE_META[zone.vehicle_type];
  const status = STATUS_META[zone.status];
  const color = zoneColor(zone.zone_id);
  const zoneAlerts = activeAlerts.filter((a) => a.zone_id === zone.zone_id);

  const run = async (command: SimulatorCommandInput, label: string) => {
    try {
      await api.command(command);
      setMessage(`${label}: orden enviada al Publisher`);
    } catch (error) {
      setMessage((error as Error).message);
    }
    setTimeout(() => setMessage(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`Detalle de ${zone.zone_name}`}>
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={() => selectZone(null)}
        aria-label="Cerrar detalle"
      />
      <aside className="absolute inset-y-0 right-0 flex w-[min(480px,100vw)] flex-col overflow-y-auto border-l border-line-2 bg-panel shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-panel px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <vehicle.icon size={14} style={{ color: vehicle.color }} aria-hidden />
              {vehicle.label} · <span className="font-mono">{zone.zone_id}</span>
            </div>
            <h3 className="mt-1 flex items-center gap-2 text-xl font-semibold">
              {zone.zone_name} <StatusBadge status={zone.status} size="md" />
            </h3>
          </div>
          <button
            type="button"
            onClick={() => selectZone(null)}
            className="rounded-md p-1 text-ink-2 hover:bg-panel-3 hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </header>

        <Section title="Estado actual" source={`HGETALL parking:zone:${zone.zone_id}`}>
          <div className="mb-3 flex items-end justify-between">
            <span className="text-4xl font-semibold tabular">{fmtPct(zone.occupancy)}</span>
            <span className="text-sm text-ink-2 tabular">
              <b className="text-ink">{zone.occupied}</b> / {zone.capacity} ·{' '}
              <b className="text-ink">{zone.available}</b> disponibles
            </span>
          </div>
          <Meter value={zone.occupancy} color={status.color} height={8} label="Ocupación" />
          <dl className="mt-3 grid grid-cols-2 gap-x-6 divide-line">
            <KeyValue
              label="Tendencia"
              value={<TrendIndicator trend={zone.trend} compact delta={zone.trend_delta} />}
            />
            <KeyValue label="Δ último evento" value={fmtDelta(zone.occupancy_delta, 2)} />
            <KeyValue label="Promedio 5 min" value={fmtPct(zone.avg_occupancy_5m)} />
            <KeyValue label="Variación 5 min" value={fmtDelta(zone.variation_5m)} />
            <KeyValue
              label="Entradas 1 / 5 / 15 min"
              value={`${zone.entries_per_minute} / ${zone.entries_5m} / ${zone.entries_15m}`}
            />
            <KeyValue
              label="Salidas 1 / 5 / 15 min"
              value={`${zone.exits_per_minute} / ${zone.exits_5m} / ${zone.exits_15m}`}
            />
            <KeyValue label="Total entradas" value={zone.total_entries} />
            <KeyValue label="Total salidas" value={zone.total_exits} />
            <KeyValue label="Último evento" value={<span className="font-mono text-xs">{zone.last_event}</span>} />
            <KeyValue
              label="Actualizado"
              value={`${fmtRelative(zone.last_update, now)} · ${zone.simulated_time || '—'}`}
            />
          </dl>
        </Section>

        <Section title="Ocupación temporal (15 min)" source="XRANGE parking:timeseries">
          {series.length > 1 ? (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="zoneFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => fmtTime(v)}
                  minTickGap={60}
                  {...AXIS_PROPS}
                />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} {...AXIS_PROPS} />
                {thresholds && (
                  <ReferenceLine
                    y={thresholds.occupancy.warning}
                    stroke="var(--color-warn)"
                    strokeDasharray="3 3"
                    strokeOpacity={0.6}
                  />
                )}
                {thresholds && (
                  <ReferenceLine
                    y={thresholds.occupancy.critical}
                    stroke="var(--color-serious)"
                    strokeDasharray="3 3"
                    strokeOpacity={0.6}
                  />
                )}
                <Tooltip
                  cursor={{ stroke: 'var(--color-ink-3)' }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="rounded-md border border-line-2 bg-panel px-2 py-1 text-xs text-ink">
                        {fmtTime(Number(payload[0].payload.ts))} · <b>{fmtPct(Number(payload[0].value))}</b>
                      </div>
                    ) : null
                  }
                />
                <Area
                  dataKey="occupancy"
                  stroke={color}
                  strokeWidth={2}
                  fill="url(#zoneFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-ink-3">Recolectando muestras…</p>
          )}
        </Section>

        <Section title="Alertas activas" source="HVALS parking:alerts:active">
          {zoneAlerts.length ? (
            <ul className="space-y-1.5">
              {zoneAlerts.map((a) => {
                const meta = SEVERITY_META[a.severity];
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => selectAlert(a)}
                      className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left text-sm hover:bg-panel-3"
                    >
                      <meta.icon size={14} style={{ color: meta.color }} aria-hidden />
                      <span className="flex-1">{ALERT_TYPE_LABEL[a.type]}</span>
                      <span className="text-xs text-ink-3">{fmtRelative(a.timestamp, now)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Sin alertas activas en esta zona.</p>
          )}
        </Section>

        <Section title="Últimos eventos" source="XREVRANGE parking:stream (filtrado)">
          <ol className="space-y-0.5 font-mono text-[11.5px]">
            {events.map((e) => {
              const visual = eventVisual(e.event_type, zone.vehicle_type);
              const data = e.data as { occupied?: number; capacity?: number };
              return (
                <li key={e.event_id} className="grid grid-cols-[62px_16px_1fr_auto] items-center gap-2 py-0.5">
                  <span className="text-ink-3 tabular">{fmtTime(e.timestamp)}</span>
                  <visual.icon size={13} style={{ color: visual.color }} aria-hidden />
                  <span className="truncate text-ink">{e.event_type}</span>
                  <span className="text-ink-2 tabular">
                    {data.occupied}/{data.capacity}
                  </span>
                </li>
              );
            })}
            {!events.length && <li className="font-sans text-sm text-ink-3">Sin eventos recientes.</li>}
          </ol>
        </Section>

        <section className="px-5 py-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">
            Acciones de demostración
          </h4>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run({ action: 'FORCE_ENTRY', zone_id: zone.zone_id, count: 1 }, 'Entrada forzada')}>
              <LogIn size={14} /> Forzar entrada
            </Button>
            <Button onClick={() => run({ action: 'FORCE_EXIT', zone_id: zone.zone_id, count: 1 }, 'Salida forzada')}>
              <LogOut size={14} /> Forzar salida
            </Button>
            <Button
              variant="danger"
              onClick={() => run({ action: 'SET_SCENARIO', scenario: 'FULL', zone_id: zone.zone_id }, 'Llenar zona')}
            >
              <Ban size={14} /> Llenar zona
            </Button>
            <Button
              onClick={() =>
                run({ action: 'SET_SCENARIO', scenario: 'RECOVERY', zone_id: zone.zone_id }, 'Recuperación')
              }
            >
              <RotateCcw size={14} /> Recuperación
            </Button>
          </div>
          {message && (
            <p className="mt-2 text-xs text-ink-2" role="status">
              {message}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
