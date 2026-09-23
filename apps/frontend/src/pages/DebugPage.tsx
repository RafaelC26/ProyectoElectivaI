import type { RedisKeyInfo } from '@uptc/shared';
import { RefreshCw, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, KeyValue, Panel } from '../components/ui/primitives';
import { cx, fmtDateTime, fmtInt } from '../lib/format';
import { api, type InspectResult } from '../services/api';
import { useParking } from '../stores/parking-store';

const TYPE_COLOR: Record<string, string> = {
  hash: '#3987e5',
  stream: '#199e70',
  zset: '#c98500',
  string: '#8c98a4',
};

const QUICK = [
  { label: 'Estado actual (Hash)', key: 'parking:zone:CARS-A' },
  { label: 'Histórico reciente (Stream)', key: 'parking:stream' },
  { label: 'Ranking (Sorted Set)', key: 'parking:ranking:occupancy' },
  { label: 'Métricas globales (Hash)', key: 'parking:metrics:global' },
  { label: 'Alertas (Stream)', key: 'parking:alerts:stream' },
  { label: 'Serie temporal (Stream)', key: 'parking:timeseries' },
];

function usePolling<T>(
  loader: () => Promise<T>,
  intervalMs: number,
): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    loader()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [loader]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
  return { data, error, refresh };
}

function KeyBrowser({ onInspect, selected }: { onInspect: (key: string) => void; selected: string | null }) {
  const { data, error } = usePolling(api.debugKeys, 2000);
  const [filter, setFilter] = useState('');
  const keys = (data ?? []).filter((k) => k.key.includes(filter));
  return (
    <Panel
      title="Claves parking:*"
      subtitle="SCAN + TYPE + TTL cada 2 s — observe cómo el TTL disminuye"
      bodyClassName="p-0"
      actions={
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar…"
          aria-label="Filtrar claves"
          className="w-36 rounded-lg border border-line bg-bg px-2 py-1 text-xs"
        />
      }
    >
      {error && <p className="px-4 py-3 text-sm text-crit-ink">{error}</p>}
      <div className="max-h-[520px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-2 font-medium">Clave</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 text-right font-medium">Tamaño</th>
              <th className="px-4 py-2 text-right font-medium">TTL</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {keys.map((k: RedisKeyInfo) => (
              <tr
                key={k.key}
                onClick={() => onInspect(k.key)}
                className={cx(
                  'cursor-pointer border-t border-line hover:bg-panel-2',
                  selected === k.key && 'bg-panel-3',
                )}
              >
                <td className="px-4 py-1.5 text-ink">{k.key}</td>
                <td className="px-2 py-1.5" style={{ color: TYPE_COLOR[k.type] ?? 'var(--color-ink-2)' }}>
                  {k.type}
                </td>
                <td className="px-2 py-1.5 text-right text-ink-2 tabular">{fmtInt(k.size)}</td>
                <td className={cx('px-4 py-1.5 text-right tabular', k.ttl >= 0 ? 'text-warn' : 'text-ink-3')}>
                  {k.ttl >= 0 ? `${k.ttl} s` : '∞'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Inspector({ keyName }: { keyName: string | null }) {
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!keyName) return;
    api
      .debugInspect(keyName, 8)
      .then((r) => {
        setResult(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [keyName]);
  useEffect(load, [load]);

  return (
    <Panel
      title="Inspector"
      subtitle="Comandos de sólo lectura sobre Redis"
      actions={
        <Button variant="ghost" onClick={load} disabled={!keyName}>
          <RefreshCw size={14} /> Actualizar
        </Button>
      }
    >
      {!keyName && <p className="text-sm text-ink-3">Seleccione una clave o un atajo.</p>}
      {error && <p className="text-sm text-crit-ink">{error}</p>}
      {result && (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-bg px-3 py-2 font-mono text-xs text-ink">
            <Terminal size={14} className="text-in" aria-hidden />
            <span>&gt; {result.command}</span>
            <span className="ml-auto text-ink-3">
              {result.type} · TTL {result.ttl >= 0 ? `${result.ttl} s` : '∞'}
            </span>
          </div>
          <pre className="max-h-[440px] overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {JSON.stringify(result.value, null, 2)}
          </pre>
        </>
      )}
    </Panel>
  );
}

function PostgresPanel() {
  const stats = usePolling(api.archiveStats, 5000);
  const daily = usePolling(
    useCallback(() => api.archiveDaily(7), []),
    10000,
  );
  const alerts = usePolling(
    useCallback(() => api.archiveAlerts(8), []),
    5000,
  );
  const unavailable = stats.error;
  return (
    <Panel
      title="PostgreSQL — histórico permanente"
      subtitle="Tablas alimentadas por el archiver (XREADGROUP → INSERT → XACK)"
    >
      {unavailable ? (
        <p className="text-sm text-warn">No disponible: {unavailable}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <dl className="divide-y divide-line">
            <KeyValue label="parking_events" value={fmtInt(stats.data?.events)} />
            <KeyValue label="alerts" value={fmtInt(stats.data?.alerts)} />
            <KeyValue label="zone_snapshots" value={fmtInt(stats.data?.snapshots)} />
            <KeyValue label="Primer evento" value={fmtDateTime(stats.data?.first_event)} />
            <KeyValue label="Último archivado" value={fmtDateTime(stats.data?.last_archived)} />
            <KeyValue label="Tamaño de la BD" value={stats.data?.database_size ?? '—'} />
          </dl>
          <div className="min-w-0 space-y-4">
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                Vista daily_zone_summary
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-ink-3">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Día</th>
                      <th className="py-1.5 pr-3 font-medium">Zona</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Entradas</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Salidas</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Pico</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Promedio</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Veces llena</th>
                      <th className="py-1.5 text-right font-medium">Alertas</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {(daily.data ?? []).map((r) => (
                      <tr key={`${r.day}-${r.zone_id}`} className="border-t border-line">
                        <td className="py-1.5 pr-3 font-mono text-ink-2">{String(r.day).slice(0, 10)}</td>
                        <td className="py-1.5 pr-3 text-ink">{r.zone_name}</td>
                        <td className="py-1.5 pr-3 text-right">{r.entries}</td>
                        <td className="py-1.5 pr-3 text-right">{r.exits}</td>
                        <td className="py-1.5 pr-3 text-right">{r.peak_occupancy}%</td>
                        <td className="py-1.5 pr-3 text-right">{r.avg_occupancy}%</td>
                        <td className="py-1.5 pr-3 text-right">{r.times_full}</td>
                        <td className="py-1.5 text-right">{r.alerts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                Últimas alertas archivadas
              </h4>
              <ul className="space-y-1 font-mono text-[11px]">
                {(alerts.data ?? []).map((a) => (
                  <li key={a.id} className="grid grid-cols-[96px_80px_1fr_auto] gap-2 text-ink-2">
                    <span className="text-ink">{a.id}</span>
                    <span>{a.zone_id}</span>
                    <span className="truncate">{a.type}</span>
                    <span className={a.status === 'ACTIVE' ? 'text-warn' : 'text-good-ink'}>
                      {a.status === 'ACTIVE' ? 'ACTIVA' : `${a.resolution} · ${a.duration_s}s`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** /debug — panel de Redis y PostgreSQL para la sustentación. */
export function DebugPage() {
  const status = useParking((s) => s.status);
  const config = useParking((s) => s.config);
  const pubsub = usePolling(api.debugPubSub, 3000);
  const [selected, setSelected] = useState<string | null>('parking:zone:CARS-A');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Redis">
          <dl className="divide-y divide-line">
            <KeyValue
              label="Estado"
              value={
                <b style={{ color: status?.redis.connected ? 'var(--color-good-ink)' : 'var(--color-warn)' }}>
                  {status?.redis.connected ? 'Connected' : 'Reconnecting'}
                </b>
              }
            />
            <KeyValue label="Canal" value="parking-events" mono />
            <KeyValue label="Stream" value="parking:stream" mono />
            <KeyValue label="Eventos históricos" value={fmtInt(status?.streams.events_length)} />
            <KeyValue label="Zonas" value={config?.zones.length ?? '—'} />
            <KeyValue label="Eventos procesados" value={fmtInt(status?.throughput.events_processed)} />
            <KeyValue label="Eventos / s" value={status?.throughput.events_per_second ?? '—'} />
          </dl>
          <h4 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
            Pub/Sub · PUBSUB NUMSUB
          </h4>
          <ul className="space-y-1 font-mono text-xs">
            {(pubsub.data ?? []).map((c) => (
              <li key={c.channel} className="flex justify-between">
                <span className="text-ink">{c.channel}</span>
                <span className={c.subscribers ? 'text-good-ink' : 'text-crit-ink'}>{c.subscribers} suscriptores</span>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <Button key={q.key} active={selected === q.key} onClick={() => setSelected(q.key)}>
                {q.label}
              </Button>
            ))}
          </div>
          <Inspector keyName={selected} />
        </div>
      </div>
      <KeyBrowser onInspect={setSelected} selected={selected} />
      <PostgresPanel />
    </div>
  );
}
