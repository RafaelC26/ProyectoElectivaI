import type { ServiceStatus } from '@uptc/shared';
import { Activity, Cpu, Database, HardDrive, Radio, Send, Server, Timer, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { KeyValue, Panel } from '../components/ui/primitives';
import { useNow } from '../hooks/useNow';
import { fmtDuration, fmtInt, fmtRelative } from '../lib/format';
import { SERVICE_STATE_META } from '../lib/visual';
import { useParking } from '../stores/parking-store';

const ICONS: Record<string, LucideIcon> = {
  redis: Database,
  publisher: Send,
  processor: Cpu,
  backend: Server,
  websocket: Radio,
  simulator: Activity,
  archiver: Waypoints,
  postgres: HardDrive,
};

function ServiceCard({ service, now }: { service: ServiceStatus; now: number }) {
  const meta = SERVICE_STATE_META[service.state];
  const Icon = ICONS[service.name] ?? Server;
  return (
    <article className="rounded-xl border border-line bg-panel p-4" style={{ borderTop: `3px solid ${meta.color}` }}>
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-semibold text-ink">
          <Icon size={16} className="text-ink-2" aria-hidden />
          {service.label}
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider"
          style={{ color: meta.color }}
        >
          <span className="size-2 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
      </header>
      <dl className="mt-3 divide-y divide-line">
        <KeyValue label="Activo desde" value={fmtDuration(service.uptime_s)} />
        <KeyValue label="Último heartbeat" value={service.last_seen ? fmtRelative(service.last_seen, now) : '—'} />
        {Object.entries(service.details)
          .filter(([, v]) => v !== null && v !== '')
          .slice(0, 7)
          .map(([k, v]) => (
            <KeyValue key={k} label={k.replace(/_/g, ' ')} value={String(v)} mono />
          ))}
      </dl>
    </article>
  );
}

/** /system — estado de cada componente (heartbeats con TTL en Redis). */
export function SystemPage() {
  const status = useParking((s) => s.status);
  const connection = useParking((s) => s.connection);
  const latency = useParking((s) => s.latency);
  const now = useNow();

  if (!status) return <p className="text-ink-2">Esperando estado del sistema…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        Cada servicio escribe <code className="font-mono text-ink">parking:heartbeat:&lt;servicio&gt;</code> con{' '}
        <code className="font-mono text-ink">EX 10</code>. Si un proceso se detiene la clave expira y aparece{' '}
        <b className="text-crit-ink">OFFLINE</b>; si Redis se cae los servicios muestran{' '}
        <b className="text-warn">RECONNECTING</b> mientras reintentan (1 s → 2 s → 5 s).
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {status.services.map((s) => (
          <ServiceCard key={s.name} service={s} now={now} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Este navegador">
          <dl className="divide-y divide-line">
            <KeyValue
              label="WebSocket"
              value={
                <b style={{ color: connection === 'LIVE' ? 'var(--color-good-ink)' : 'var(--color-warn)' }}>
                  {connection}
                </b>
              }
            />
            <KeyValue
              label="Latencia E2E (prom. 50)"
              value={latency.avg !== null ? `${Math.round(latency.avg)} ms` : '—'}
            />
            <KeyValue label="Último evento" value={latency.last !== null ? `${latency.last} ms` : '—'} />
            <KeyValue label="Estado recibido" value={fmtRelative(status.timestamp, now)} />
          </dl>
        </Panel>
        <Panel title="Redis">
          <dl className="divide-y divide-line">
            <KeyValue label="Versión" value={status.redis.version ?? '—'} />
            <KeyValue label="Memoria usada" value={status.redis.used_memory_human ?? '—'} />
            <KeyValue label="Clientes conectados" value={fmtInt(status.redis.connected_clients)} />
            <KeyValue label="Operaciones / s" value={fmtInt(status.redis.ops_per_sec)} />
            <KeyValue label="Claves" value={fmtInt(status.redis.keys)} />
          </dl>
        </Panel>
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <Timer size={14} /> Flujo de datos
            </span>
          }
        >
          <dl className="divide-y divide-line">
            <KeyValue label="Eventos publicados" value={fmtInt(status.throughput.events_published)} />
            <KeyValue label="Eventos procesados" value={fmtInt(status.throughput.events_processed)} />
            <KeyValue label="Eventos / s" value={status.throughput.events_per_second} />
            <KeyValue label="Procesamiento prom." value={`${status.throughput.avg_processing_ms} ms`} />
            <KeyValue label="parking:stream" value={`${fmtInt(status.streams.events_length)} entradas`} mono />
            <KeyValue label="parking:timeseries" value={`${fmtInt(status.streams.timeseries_length)} muestras`} mono />
            <KeyValue
              label="Archiver: pendientes / lag"
              value={`${status.streams.archiver_pending ?? '—'} / ${status.streams.archiver_lag ?? '—'}`}
              mono
            />
            <KeyValue label="PostgreSQL: eventos archivados" value={fmtInt(status.postgres.events_archived)} />
          </dl>
        </Panel>
      </div>
    </div>
  );
}
