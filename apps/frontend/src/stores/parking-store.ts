import type {
  Alert,
  AlertChange,
  MetricsSample,
  MetricsSnapshot,
  ParkingEvent,
  SimulatorState,
  SystemStatus,
  ScheduleEntry,
  Thresholds,
  ZoneConfig,
  ZoneState,
} from '@uptc/shared';
import { create } from 'zustand';
import { SEVERITY_META } from '../lib/visual';

export type ConnectionState = 'CONNECTING' | 'LIVE' | 'RECONNECTING';

export interface FeedItem {
  key: string;
  event: ParkingEvent;
  receivedAt: number;
  /** received_at − generated_at (sólo eventos de sensor recibidos en vivo). */
  latency: number | null;
  live: boolean;
}

export interface RealtimeBatch {
  events: FeedItem[];
  zones: Record<string, ZoneState>;
  metrics: MetricsSnapshot | null;
  samples: MetricsSample[];
  alertChanges: AlertChange[];
}

export interface Snapshot {
  zones: ZoneState[];
  metrics: MetricsSnapshot | null;
  samples: MetricsSample[];
  events: ParkingEvent[];
  activeAlerts: Alert[];
  alertLog: AlertChange[];
  simulator: SimulatorState | null;
  status: SystemStatus | null;
}

const MAX_FEED = 80;
const MAX_ALERT_LOG = 60;
const SAMPLE_RETENTION_MS = 16 * 60_000;

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank || (a.timestamp < b.timestamp ? 1 : -1),
  );
}

interface ParkingStore {
  config: { zones: ZoneConfig[]; thresholds: Thresholds; schedule: ScheduleEntry[] } | null;
  zones: Record<string, ZoneState>;
  zoneUpdatedAt: Record<string, number>;
  metrics: MetricsSnapshot | null;
  samples: MetricsSample[];
  feed: FeedItem[];
  activeAlerts: Alert[];
  alertLog: AlertChange[];
  connection: ConnectionState;
  status: SystemStatus | null;
  simulator: SimulatorState | null;
  lastUpdate: number | null;
  pulse: number;
  latency: { last: number | null; avg: number | null; history: number[] };
  selectedZone: string | null;
  selectedAlert: Alert | null;

  setConfig: (config: { zones: ZoneConfig[]; thresholds: Thresholds; schedule: ScheduleEntry[] }) => void;
  hydrate: (snapshot: Snapshot) => void;
  applyBatch: (batch: RealtimeBatch) => void;
  setConnection: (connection: ConnectionState) => void;
  setStatus: (status: SystemStatus) => void;
  setSimulator: (state: SimulatorState) => void;
  selectZone: (zoneId: string | null) => void;
  selectAlert: (alert: Alert | null) => void;
}

export const useParking = create<ParkingStore>((set) => ({
  config: null,
  zones: {},
  zoneUpdatedAt: {},
  metrics: null,
  samples: [],
  feed: [],
  activeAlerts: [],
  alertLog: [],
  connection: 'CONNECTING',
  status: null,
  simulator: null,
  lastUpdate: null,
  pulse: 0,
  latency: { last: null, avg: null, history: [] },
  selectedZone: null,
  selectedAlert: null,

  setConfig: (config) => set({ config }),

  hydrate: (snapshot) =>
    set((state) => ({
      zones: Object.fromEntries(snapshot.zones.map((z) => [z.zone_id, z])),
      metrics: snapshot.metrics ?? state.metrics,
      samples: snapshot.samples,
      feed: snapshot.events.map((event) => ({
        key: event.metadata.stream_id ?? event.event_id,
        event,
        receivedAt: Date.now(),
        latency: null,
        live: false,
      })),
      activeAlerts: sortAlerts(snapshot.activeAlerts),
      alertLog: snapshot.alertLog,
      simulator: snapshot.simulator ?? state.simulator,
      status: snapshot.status ?? state.status,
      lastUpdate: Date.now(),
    })),

  applyBatch: (batch) =>
    set((state) => {
      const now = Date.now();
      const next: Partial<ParkingStore> = { lastUpdate: now };

      const zoneIds = Object.keys(batch.zones);
      if (zoneIds.length) {
        next.zones = { ...state.zones, ...batch.zones };
        next.zoneUpdatedAt = { ...state.zoneUpdatedAt };
        for (const id of zoneIds) next.zoneUpdatedAt[id] = now;
      }
      if (batch.metrics) next.metrics = batch.metrics;
      if (batch.samples.length) {
        const cutoff = now - SAMPLE_RETENTION_MS;
        const known = new Set(state.samples.map((s) => s.id));
        next.samples = [...state.samples, ...batch.samples.filter((s) => !known.has(s.id))].filter(
          (s) => s.ts >= cutoff,
        );
      }
      if (batch.events.length) {
        const known = new Set(state.feed.map((f) => f.key));
        const fresh = batch.events.filter((f) => !known.has(f.key)).reverse();
        next.feed = [...fresh, ...state.feed].slice(0, MAX_FEED);
        next.pulse = state.pulse + 1;
        const measured = batch.events.map((f) => f.latency).filter((l): l is number => l !== null);
        if (measured.length) {
          const history = [...state.latency.history, ...measured].slice(-50);
          next.latency = {
            last: measured[measured.length - 1],
            avg: history.reduce((a, b) => a + b, 0) / history.length,
            history,
          };
        }
      }
      if (batch.alertChanges.length) {
        let active = [...state.activeAlerts];
        for (const change of batch.alertChanges) {
          active = active.filter(
            (a) => a.id !== change.alert.id && !(a.zone_id === change.alert.zone_id && a.type === change.alert.type),
          );
          if (change.action === 'RAISED') active.push(change.alert);
        }
        next.activeAlerts = sortAlerts(active);
        next.alertLog = [...[...batch.alertChanges].reverse(), ...state.alertLog].slice(0, MAX_ALERT_LOG);
        const selected = state.selectedAlert;
        if (selected) {
          const update = batch.alertChanges.find((c) => c.alert.id === selected.id);
          if (update) next.selectedAlert = update.alert;
        }
      }
      return next;
    }),

  setConnection: (connection) => set({ connection }),
  setStatus: (status) => set({ status }),
  setSimulator: (simulator) => set({ simulator }),
  selectZone: (selectedZone) => set({ selectedZone }),
  selectAlert: (selectedAlert) => set({ selectedAlert }),
}));
