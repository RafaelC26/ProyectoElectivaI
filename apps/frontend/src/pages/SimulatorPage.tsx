import { LABELS, SCENARIOS, type ScenarioName, type SimulatorCommandInput } from '@uptc/shared';
import { KeyRound, LogIn, LogOut, Pause, Play, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, KeyValue, Panel, Segmented, StatusBadge, TrendIndicator } from '../components/ui/primitives';
import { cx, fmtPct, fmtTime } from '../lib/format';
import { VEHICLE_META } from '../lib/visual';
import { ApiError, api, getDemoToken, setDemoToken } from '../services/api';
import { useParking } from '../stores/parking-store';

const SCENARIO_HELP: Record<ScenarioName, string> = {
  NORMAL: 'Sigue el perfil de demanda del día; los valores evolucionan suavemente, sin niveles críticos.',
  HIGH_DEMAND: 'Más llegadas y mayor probabilidad de entrada: tendencia ascendente hasta cerca de saturar.',
  MASS_ENTRY: 'Ráfaga de entradas consecutivas (≈30 % de la capacidad en 3 ciclos): crecimiento inusual.',
  MASS_EXIT: 'Ráfaga de salidas consecutivas (≈35 % en 3 ciclos): prueba de recuperación.',
  NEAR_FULL: 'Lleva la zona gradualmente al 90–99 % y la mantiene en esa banda.',
  FULL: 'Lleva la zona exactamente a occupied = capacity → PARKING_FULL.',
  RECOVERY: 'Salidas progresivas (100 % → 95 % → 88 % → 79 % …) hasta ~70 %: ZONE_RECOVERED.',
};

function minuteOf(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

/** Panel de control del simulador (sección 42): las órdenes viajan por Redis Pub/Sub al Publisher. */
export function SimulatorPage() {
  const sim = useParking((s) => s.simulator);
  const config = useParking((s) => s.config);
  const zones = useParking((s) => s.zones);
  const feed = useParking((s) => s.feed);
  const [target, setTarget] = useState<string>('CARS-A');
  const [count, setCount] = useState(1);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState(getDemoToken());

  const systemEvents = useMemo(() => feed.filter((f) => f.event.entity_id === 'SIMULATOR').slice(0, 12), [feed]);

  const send = async (command: SimulatorCommandInput, label: string) => {
    try {
      const result = await api.command(command);
      setFeedback({ ok: true, text: `${label} → PUBLISH simulator-commands (receptores: ${result.receivers})` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setNeedsToken(true);
      setFeedback({ ok: false, text: (error as Error).message });
    }
  };

  const running = sim?.status === 'RUNNING';
  const zoneList = config?.zones ?? [];
  const targetName = target === 'ALL' ? 'todas las zonas' : (zoneList.find((z) => z.id === target)?.name ?? target);
  const simMinute = sim ? minuteOf(sim.simulated_time) : -1;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel
          title="Simulation control"
          subtitle="Sensores virtuales · occupied(t+1) = occupied(t) + entradas − salidas"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3 py-1 text-sm font-semibold"
              style={{ color: running ? 'var(--color-good-ink)' : 'var(--color-warn)' }}
            >
              <span className="size-2 rounded-full" style={{ background: 'currentColor' }} />
              {sim ? (running ? 'Running' : 'Paused') : 'Sin conexión con el Publisher'}
            </span>
            {running ? (
              <Button onClick={() => send({ action: 'PAUSE' }, 'Pausa')}>
                <Pause size={14} /> Pausar
              </Button>
            ) : (
              <Button variant="primary" onClick={() => send({ action: 'RESUME' }, 'Reanudar')}>
                <Play size={14} /> Reanudar
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => send({ action: 'RESET' }, 'Reinicio')}
              title="Vuelve al día 1 y a la ocupación inicial"
            >
              <RotateCcw size={14} /> Reiniciar día
            </Button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs text-ink-2">Velocidad</p>
              <Segmented
                label="Velocidad"
                value={sim?.speed ?? 1}
                onChange={(speed) => send({ action: 'SET_SPEED', speed: speed as 1 | 2 | 5 }, `Velocidad x${speed}`)}
                options={[
                  { value: 1, label: 'x1' },
                  { value: 2, label: 'x2' },
                  { value: 5, label: 'x5' },
                ]}
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-ink-2">Modo de tiempo</p>
              <Segmented
                label="Modo"
                value={sim?.mode ?? 'ACCELERATED_DEMO'}
                onChange={(mode) => send({ action: 'SET_MODE', mode }, `Modo ${mode}`)}
                options={[
                  { value: 'ACCELERATED_DEMO', label: 'Acelerado (1 min = 1 h)' },
                  { value: 'REAL_TIME_PROFILE', label: 'Hora real' },
                ]}
              />
            </div>
          </div>

          {sim && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 border-t border-line pt-2">
              <KeyValue
                label="Hora simulada"
                value={
                  <span className="font-mono">
                    {sim.simulated_time} · día {sim.simulated_day}
                  </span>
                }
              />
              <KeyValue
                label="Perfil de demanda"
                value={LABELS.profile[sim.profile as keyof typeof LABELS.profile] ?? sim.profile}
              />
              <KeyValue label="Intervalo efectivo" value={`${sim.effective_interval_ms} ms`} />
              <KeyValue label="Ciclos" value={sim.ticks} />
              <KeyValue label="Escenario global" value={LABELS.scenario[sim.global_scenario]} />
              <KeyValue label="Eventos publicados" value={sim.events_published} />
            </dl>
          )}
        </Panel>

        <Panel title="Escenarios" subtitle={`Zona objetivo: ${targetName}`}>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-2">
            Zona
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-ink"
            >
              {zoneList.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({VEHICLE_META[z.vehicleType].short})
                </option>
              ))}
              <option value="ALL">Todas las zonas</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario}
                type="button"
                onClick={() =>
                  send(
                    { action: 'SET_SCENARIO', scenario, zone_id: target },
                    `${LABELS.scenario[scenario]} en ${targetName}`,
                  )
                }
                className={cx(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-panel-3',
                  scenario === 'FULL' ? 'border-crit/50' : 'border-line-2',
                  (target === 'ALL'
                    ? sim?.global_scenario === scenario
                    : sim?.zone_scenarios[target]?.scenario === scenario) && 'bg-panel-3 ring-1 ring-car',
                )}
              >
                <span className="block text-sm font-semibold text-ink">{LABELS.scenario[scenario]}</span>
                <span className="block font-mono text-[10px] text-ink-3">{scenario}</span>
                <span className="mt-1 block text-xs text-ink-2">{SCENARIO_HELP[scenario]}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="text-sm text-ink-2">Evento manual:</span>
            <Segmented
              label="Cantidad"
              value={count}
              onChange={setCount}
              options={[1, 5, 10].map((n) => ({ value: n, label: `×${n}` }))}
            />
            <Button
              disabled={target === 'ALL'}
              onClick={() => send({ action: 'FORCE_ENTRY', zone_id: target, count }, `VEHICLE_ENTERED ×${count}`)}
            >
              <LogIn size={14} /> Forzar VEHICLE_ENTERED
            </Button>
            <Button
              disabled={target === 'ALL'}
              onClick={() => send({ action: 'FORCE_EXIT', zone_id: target, count }, `VEHICLE_EXITED ×${count}`)}
            >
              <LogOut size={14} /> Forzar VEHICLE_EXITED
            </Button>
          </div>

          {feedback && (
            <p
              className={cx(
                'mt-3 rounded-md px-3 py-2 font-mono text-xs',
                feedback.ok ? 'bg-good/10 text-good-ink' : 'bg-crit/10 text-crit-ink',
              )}
              role="status"
            >
              {feedback.text}
            </p>
          )}
          {needsToken && (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setDemoToken(token);
                setNeedsToken(false);
                setFeedback({ ok: true, text: 'Token guardado; repita la orden.' });
              }}
            >
              <KeyRound size={14} className="text-ink-2" aria-hidden />
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="DEMO_CONTROL_TOKEN"
                className="flex-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
                aria-label="Token de demostración"
              />
              <Button type="submit">Guardar</Button>
            </form>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Zonas en vivo" subtitle="Estado actual (Hashes) — se actualiza sin recargar">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="pb-2 font-medium">Zona</th>
                  <th className="pb-2 font-medium">Ocupación</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2 font-medium">Tendencia</th>
                  <th className="pb-2 font-medium">Escenario</th>
                </tr>
              </thead>
              <tbody>
                {zoneList.map((z) => {
                  const state = zones[z.id];
                  const override = sim?.zone_scenarios[z.id];
                  return (
                    <tr key={z.id} className="border-t border-line">
                      <td className="py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {(() => {
                            const Icon = VEHICLE_META[z.vehicleType].icon;
                            return <Icon size={14} style={{ color: VEHICLE_META[z.vehicleType].color }} aria-hidden />;
                          })()}
                          {z.name}
                        </span>
                      </td>
                      <td className="py-2 tabular">
                        {state ? (
                          <>
                            <b>{fmtPct(state.occupancy, 1)}</b>{' '}
                            <span className="text-ink-3">
                              {state.occupied}/{state.capacity}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2">{state && <StatusBadge status={state.status} />}</td>
                      <td className="py-2">
                        {state && <TrendIndicator trend={state.trend} compact delta={state.trend_delta} />}
                      </td>
                      <td className="py-2 text-xs text-ink-2">
                        {override ? (
                          <>
                            {LABELS.scenario[override.scenario]}
                            {override.remaining_ticks !== null && ` (${override.remaining_ticks} ciclos)`}
                          </>
                        ) : (
                          <span className="text-ink-3">global</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Perfil de demanda diario"
          subtitle="config/simulation.json · parámetros de simulación, no datos reales"
        >
          <ol className="space-y-1">
            {(config?.schedule ?? []).map((s) => {
              const from = minuteOf(s.from);
              const to = minuteOf(s.to);
              const active = from <= to ? simMinute >= from && simMinute < to : simMinute >= from || simMinute < to;
              return (
                <li
                  key={s.from}
                  className={cx(
                    'grid grid-cols-[96px_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm',
                    active && 'bg-panel-3 ring-1 ring-line-2',
                  )}
                >
                  <span className="font-mono text-xs text-ink-2">
                    {s.from}–{s.to}
                  </span>
                  <span className="text-ink">{LABELS.profile[s.profile]}</span>
                  <span className="font-mono text-[11px] text-ink-3">
                    in {s.entryWeight.toFixed(2)} · out {s.exitWeight.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel title="Eventos del sistema" subtitle="system-events">
          <ol className="space-y-1 font-mono text-xs">
            {systemEvents.length ? (
              systemEvents.map((f) => (
                <li key={f.key} className="grid grid-cols-[64px_1fr] gap-2">
                  <span className="text-ink-3">{fmtTime(f.event.timestamp)}</span>
                  <span>
                    <b className="text-ink">{f.event.event_type}</b>{' '}
                    <span className="text-ink-2">{(f.event.data as { message?: string }).message}</span>
                  </span>
                </li>
              ))
            ) : (
              <li className="font-sans text-sm text-ink-3">Sin eventos del sistema recientes.</li>
            )}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
