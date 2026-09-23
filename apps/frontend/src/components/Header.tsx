import { LABELS, type ScenarioName } from '@uptc/shared';
import { Clock, Database, Gauge, SquareParking } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { cx, fmtTime } from '../lib/format';
import { useParking } from '../stores/parking-store';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/simulator', label: 'Simulador' },
  { to: '/system', label: 'Sistema' },
  { to: '/debug', label: 'Redis y BD' },
];

function LiveIndicator() {
  const connection = useParking((s) => s.connection);
  const live = connection === 'LIVE';
  const label = live ? 'LIVE' : connection === 'CONNECTING' ? 'CONECTANDO' : 'RECONNECTING';
  const color = live ? 'var(--color-good-ink)' : 'var(--color-warn)';
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold tracking-[0.12em]"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2">
        <span
          className={cx('absolute inline-flex size-full rounded-full opacity-60', live ? 'animate-ping' : '')}
          style={{ background: color }}
        />
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  );
}

/** Pulso breve (≈450 ms) cada vez que llega un evento: evidencia visual del tiempo real. */
function EventPulse() {
  const pulse = useParking((s) => s.pulse);
  const [key, setKey] = useState(0);
  useEffect(() => setKey(pulse), [pulse]);
  return (
    <span
      className="hidden items-center gap-1.5 text-[11px] font-semibold tracking-wider text-ink-2 md:inline-flex"
      title="Indicador de nuevo evento"
    >
      <span key={key} className={cx('size-2 rounded-full bg-in', pulse > 0 && 'animate-pulse-once')} />
      EVENT RECEIVED
    </span>
  );
}

function RedisPill() {
  const status = useParking((s) => s.status);
  const connection = useParking((s) => s.connection);
  const connected = connection === 'LIVE' && status?.redis.connected !== false;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <Database size={13} aria-hidden className={connected ? 'text-good-ink' : 'text-warn'} />
      <span>{connected ? 'Redis Connected' : 'Redis reconectando'}</span>
    </span>
  );
}

function SimClock() {
  const sim = useParking((s) => s.simulator);
  if (!sim) return null;
  const profile = LABELS.profile[sim.profile as keyof typeof LABELS.profile] ?? sim.profile;
  const scenario = LABELS.scenario[sim.global_scenario as ScenarioName];
  return (
    <span className="hidden items-center gap-1.5 text-xs text-ink-2 lg:inline-flex" title="Reloj del simulador">
      <Clock size={13} aria-hidden />
      <span>
        Hora simulada <b className="font-mono text-ink tabular">{sim.simulated_time}</b> · {profile}
        {sim.global_scenario !== 'NORMAL' && ` · ${scenario}`}
        {sim.status === 'PAUSED' && <b className="ml-1 text-warn">· PAUSA</b>}
      </span>
    </span>
  );
}

function Latency() {
  const latency = useParking((s) => s.latency);
  if (latency.avg === null) return null;
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-ink-2 xl:inline-flex"
      title="Latencia end-to-end promedio (generated_at → received_at)"
    >
      <Gauge size={13} aria-hidden />
      Latencia E2E <b className="font-mono text-ink tabular">{Math.round(latency.avg)} ms</b>
    </span>
  );
}

function LastUpdate() {
  const lastUpdate = useParking((s) => s.lastUpdate);
  return (
    <span className="text-right text-[11px] leading-tight text-ink-3">
      Última actualización
      <br />
      <b className="font-mono text-sm text-ink tabular">{fmtTime(lastUpdate)}</b>
    </span>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border border-line-2 bg-panel">
            <SquareParking size={22} className="text-car" aria-hidden />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-[0.14em] text-ink">UPTC SMART PARKING</h1>
            <p className="text-xs text-ink-2">Sistema de monitoreo en tiempo real · Seccional Sogamoso</p>
          </div>
        </div>

        <nav className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto" aria-label="Secciones">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-panel-3 text-ink' : 'text-ink-2 hover:bg-panel hover:text-ink',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <SimClock />
          <Latency />
          <EventPulse />
          <RedisPill />
          <LiveIndicator />
          <LastUpdate />
        </div>
      </div>
    </header>
  );
}
