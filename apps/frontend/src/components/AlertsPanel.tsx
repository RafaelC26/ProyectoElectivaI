import type { Alert } from '@uptc/shared';
import { ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNow } from '../hooks/useNow';
import { cx, fmtDateTime, fmtRelative } from '../lib/format';
import { ALERT_TYPE_LABEL, SEVERITY_META } from '../lib/visual';
import { useParking } from '../stores/parking-store';
import { KeyValue, Panel, Segmented } from './ui/primitives';

function formatValue(alert: Alert): string {
  if (alert.unit === '%') return `${alert.value}% de ocupación`;
  if (alert.unit === 'pp') return `+${alert.value} pp en la ventana`;
  return `${alert.value} espacios restantes`;
}

function AlertItem({ alert, now, resolved = false }: { alert: Alert; now: number; resolved?: boolean }) {
  const selectAlert = useParking((s) => s.selectAlert);
  const meta = SEVERITY_META[alert.severity];
  const Icon = resolved ? ShieldCheck : meta.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => selectAlert(alert)}
        className={cx(
          'flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-panel-3',
          resolved ? 'border-line opacity-70' : 'border-line-2 bg-panel-2',
        )}
        style={resolved ? undefined : { borderLeft: `3px solid ${meta.color}` }}
      >
        <Icon
          size={16}
          className="mt-0.5 shrink-0"
          style={{ color: resolved ? 'var(--color-good-ink)' : meta.color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span
              className="text-[10px] font-bold tracking-[0.12em]"
              style={{ color: resolved ? 'var(--color-good-ink)' : meta.color }}
            >
              {resolved ? `RESUELTA · ${alert.resolution}` : meta.label}
            </span>
            <span className="text-[11px] text-ink-3 tabular">
              {fmtRelative(resolved ? alert.resolved_at : alert.timestamp, now)}
            </span>
          </span>
          <span className="mt-0.5 block text-sm font-medium text-ink">
            {alert.zone_name} · {ALERT_TYPE_LABEL[alert.type]}
          </span>
          <span className="block text-xs text-ink-2">{resolved ? alert.resolution_message : formatValue(alert)}</span>
        </span>
      </button>
    </li>
  );
}

/** ALERTAS ACTIVAS (Hash parking:alerts:active) + resueltas recientes (Stream parking:alerts:stream). */
export function AlertsPanel({ className }: { className?: string }) {
  const active = useParking((s) => s.activeAlerts);
  const log = useParking((s) => s.alertLog);
  const [view, setView] = useState<'active' | 'resolved'>('active');
  const now = useNow();
  const resolved = log.filter((c) => c.action === 'RESOLVED').slice(0, 20);

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          Alertas
          <span
            className={cx(
              'rounded-md px-1.5 py-0.5 text-[11px] tabular',
              active.length ? 'bg-crit/20 text-crit-ink' : 'bg-panel-3 text-ink-2',
            )}
          >
            {active.length} activas
          </span>
        </span>
      }
      className={cx('flex flex-col', className)}
      bodyClassName="flex min-h-0 flex-1 flex-col p-3"
      actions={
        <Segmented
          label="Vista de alertas"
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: 'Activas' },
            { value: 'resolved', label: 'Resueltas' },
          ]}
        />
      }
    >
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {view === 'active' &&
          (active.length ? (
            active.map((a) => <AlertItem key={a.id} alert={a} now={now} />)
          ) : (
            <li className="flex flex-col items-center gap-2 py-8 text-center text-sm text-ink-3">
              <ShieldCheck size={22} className="text-good-ink" aria-hidden />
              Sin alertas activas
            </li>
          ))}
        {view === 'resolved' &&
          (resolved.length ? (
            resolved.map((c) => <AlertItem key={`${c.alert.id}-r`} alert={c.alert} now={now} resolved />)
          ) : (
            <li className="py-8 text-center text-sm text-ink-3">Aún no hay alertas resueltas</li>
          ))}
      </ul>
    </Panel>
  );
}

/** Modal de detalle de alerta (sección 104). */
export function AlertModal() {
  const alert = useParking((s) => s.selectedAlert);
  const selectAlert = useParking((s) => s.selectAlert);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (alert && !dialog.open) dialog.showModal();
    if (!alert && dialog.open) dialog.close();
  }, [alert]);

  const meta = alert ? SEVERITY_META[alert.severity] : null;
  return (
    <dialog
      ref={ref}
      onClose={() => selectAlert(null)}
      onClick={(e) => e.target === ref.current && selectAlert(null)}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-xl border border-line-2 bg-panel p-0 text-ink backdrop:bg-black/60"
    >
      {alert && meta && (
        <div>
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <div className="text-[11px] font-bold tracking-[0.12em]" style={{ color: meta.color }}>
                {meta.label} · {alert.status === 'ACTIVE' ? 'ACTIVA' : 'RESUELTA'}
              </div>
              <h3 className="mt-1 text-base font-semibold">{ALERT_TYPE_LABEL[alert.type]}</h3>
            </div>
            <button
              type="button"
              onClick={() => selectAlert(null)}
              className="rounded-md p-1 text-ink-2 hover:bg-panel-3 hover:text-ink"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </header>
          <div className="px-5 py-4">
            <p className="mb-3 text-sm text-ink">{alert.message}</p>
            <dl className="divide-y divide-line">
              <KeyValue label="ID" value={alert.id} mono />
              <KeyValue label="Zona" value={`${alert.zone_name} (${alert.zone_id})`} />
              <KeyValue label="Tipo" value={alert.type} mono />
              <KeyValue label="Severidad" value={alert.severity} />
              <KeyValue label="Valor" value={`${alert.value} ${alert.unit}`} />
              <KeyValue label="Umbral" value={`${alert.threshold} ${alert.unit}`} />
              <KeyValue label="Fecha" value={fmtDateTime(alert.timestamp)} />
              <KeyValue label="Estado" value={alert.status} />
              {alert.resolved_at && (
                <KeyValue label="Resuelta" value={`${fmtDateTime(alert.resolved_at)} · ${alert.resolution}`} />
              )}
              {alert.resolution_message && <KeyValue label="Detalle" value={alert.resolution_message} />}
            </dl>
          </div>
        </div>
      )}
    </dialog>
  );
}
