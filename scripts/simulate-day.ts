import { loadZones, loadSimulationConfig } from '@uptc/shared/node';
import { ParkingSimulator } from '../apps/publisher/src/simulation/parking-simulator';
const interval = Number(process.argv[2] ?? 2000);
const sim = new ParkingSimulator({ zones: loadZones(), config: loadSimulationConfig(), mode: 'ACCELERATED_DEMO', intervalMs: interval, startTime: '06:30', timeZone: 'America/Bogota', seed: 2026 });
let lastHour = -1, events = 0, maxTick = 0; const peak: Record<string, number> = {};
for (let i = 0; i < 20000; i++) {
  const plan = sim.tick(); if (plan.newDay) break;
  let n = 0; for (const m of plan.movements) if (sim.apply(m)) n++; events += n; maxTick = Math.max(maxTick, n);
  for (const z of sim.zones.values()) peak[z.config.id] = Math.max(peak[z.config.id] ?? 0, z.ratio);
  const hh = Number(plan.simulatedTime.slice(0,2)); const mm = Number(plan.simulatedTime.slice(3));
  if (mm < sim.simMinutesPerTick && hh !== lastHour) { lastHour = hh;
    console.log(plan.simulatedTime, plan.profile.profile.padEnd(10), [...sim.zones.values()].map(z => `${z.config.id}:${String(Math.round(z.ratio*100)).padStart(3)}%`).join(' ')); }
}
console.log('ticks/day', sim.ticks, 'events/day', events, 'avg events/tick', (events/sim.ticks).toFixed(1), 'max/tick', maxTick);
console.log('peak', Object.fromEntries(Object.entries(peak).map(([k,v]) => [k, Math.round(v*100)])));
