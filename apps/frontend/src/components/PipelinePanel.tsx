import type { ServiceState } from '@uptc/shared';
import { fmtInt } from '../lib/format';
import { SERVICE_STATE_META } from '../lib/visual';
import { useParking } from '../stores/parking-store';
import { Panel } from './ui/primitives';

interface Stage {
  name: string;
  role: string;
  state: ServiceState | 'LIVE' | 'UNKNOWN';
  lines: string[];
}

/** Recorrido en vivo de un evento por la arquitectura, con los contadores reales de cada etapa. */
export function PipelinePanel() {
  const status = useParking((s) => s.status);
  const latency = useParking((s) => s.latency);
  const connection = useParking((s) => s.connection);

  const svc = (name: string) => status?.services.find((s) => s.name === name);
  const pub = svc('publisher');
  const proc = svc('processor');
  const sim = svc('simulator');
  const arch = svc('archiver');

  const stages: Stage[] = [
    {
      name: 'Simulador',
      role: 'sensores virtuales',
      state: sim?.state ?? 'UNKNOWN',
      lines: [`hora ${sim?.details.simulated_time ?? '—'}`, String(sim?.details.profile ?? '—')],
    },
    {
      name: 'Publisher',
      role: 'normaliza · valida · publica',
      state: pub?.state ?? 'UNKNOWN',
      lines: [
        `${fmtInt(status?.throughput.events_published)} publicados`,
        `${pub?.details.events_rejected ?? 0} rechazados`,
      ],
    },
    {
      name: 'Redis',
      role: 'Pub/Sub · Streams · Hashes · ZSet · TTL',
      state: status?.redis.connected ? 'ONLINE' : 'RECONNECTING',
      lines: [`${fmtInt(status?.redis.ops_per_sec)} ops/s`, `stream ${fmtInt(status?.streams.events_length)}`],
    },
    {
      name: 'Processor',
      role: 'estado · métricas · alertas',
      state: proc?.state ?? 'UNKNOWN',
      lines: [
        `${fmtInt(status?.throughput.events_processed)} procesados`,
        `${status?.throughput.avg_processing_ms ?? '—'} ms/evento`,
      ],
    },
    {
      name: 'Backend',
      role: 'REST + Socket.IO',
      state: svc('backend')?.state ?? 'UNKNOWN',
      lines: [
        `${svc('websocket')?.details.clients ?? 0} clientes WS`,
        `${status?.throughput.events_per_second ?? 0} ev/s`,
      ],
    },
    {
      name: 'Dashboard',
      role: 'actualización sin recargar',
      state: connection === 'LIVE' ? 'LIVE' : 'RECONNECTING',
      lines: [`E2E ${latency.avg !== null ? Math.round(latency.avg) : '—'} ms`, `último ${latency.last ?? '—'} ms`],
    },
  ];

  return (
    <Panel title="Recorrido de un evento" subtitle="Arquitectura orientada a eventos — contadores en vivo">
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {stages.map((stage, i) => {
          const meta =
            stage.state === 'LIVE'
              ? SERVICE_STATE_META.ONLINE
              : stage.state === 'UNKNOWN'
                ? { label: '—', color: 'var(--color-ink-3)' }
                : SERVICE_STATE_META[stage.state];
          return (
            <li key={stage.name} className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">
                  <span className="mr-1.5 font-mono text-xs text-ink-3">{i + 1}</span>
                  {stage.name}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider"
                  style={{ color: meta.color }}
                >
                  <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                  {stage.state === 'LIVE' ? 'LIVE' : meta.label}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-3">{stage.role}</p>
              {stage.lines.map((line) => (
                <p key={line} className="font-mono text-[11px] text-ink-2 tabular">
                  {line}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
      {arch && (
        <p className="mt-3 text-xs text-ink-3">
          Persistencia: archiver (consumer group) → PostgreSQL · {fmtInt(Number(arch.details.events_archived ?? 0))}{' '}
          eventos archivados · lag {status?.streams.archiver_lag ?? '—'}
        </p>
      )}
    </Panel>
  );
}
