import type { SystemEvent, ZoneEvent } from '../schemas/event.schema';
import type {
  AlertResolution,
  AlertSeverity,
  AlertStatus,
  AlertType,
  ScenarioName,
  SimulationMode,
  Trend,
  VehicleType,
  ZoneStatus,
} from './domain';

/** Estado ACTUAL de una zona — Hash parking:zone:<id>. */
export interface ZoneState {
  zone_id: string;
  zone_name: string;
  vehicle_type: VehicleType;
  capacity: number;
  occupied: number;
  available: number;
  occupancy: number;
  previous_occupancy: number;
  /** Métrica 10: ocupación actual − ocupación anterior (por evento). */
  occupancy_delta: number;
  /** Métricas 6 y 7: entradas / salidas en el último minuto (ventana deslizante). */
  entries_per_minute: number;
  exits_per_minute: number;
  entries_5m: number;
  exits_5m: number;
  entries_15m: number;
  exits_15m: number;
  total_entries: number;
  total_exits: number;
  status: ZoneStatus;
  previous_status: ZoneStatus;
  trend: Trend;
  /** Variación de ocupación en la ventana de tendencia (puntos porcentuales). */
  trend_delta: number;
  avg_occupancy_5m: number;
  variation_5m: number;
  last_event: string;
  last_event_id: string;
  /** Momento del evento de sensor (ISO). */
  timestamp: string;
  /** Momento en que el Processor actualizó el estado (ISO). */
  last_update: string;
  simulated_time: string;
}

export type MetricsScope = 'GLOBAL' | 'CAR' | 'MOTORCYCLE';

/** Métricas agregadas — Hashes parking:metrics:{global,cars,motorcycles}. */
export interface GroupMetrics {
  scope: MetricsScope;
  zones: number;
  capacity: number;
  occupied: number;
  available: number;
  occupancy: number;
  entries_1m: number;
  exits_1m: number;
  entries_5m: number;
  exits_5m: number;
  entries_15m: number;
  exits_15m: number;
  avg_occupancy_1m: number;
  avg_occupancy_5m: number;
  avg_occupancy_15m: number;
  /** Ocupación actual − ocupación hace 5 minutos. */
  variation_5m: number;
  trend: Trend;
  critical_zones: number;
  full_zones: number;
  most_occupied_zone: string | null;
  most_occupied_value: number;
  updated_at: string;
}

export interface RankingEntry {
  zone_id: string;
  zone_name: string;
  vehicle_type: VehicleType;
  occupancy: number;
  rank: number;
}

export interface MetricsSnapshot {
  global: GroupMetrics;
  cars: GroupMetrics;
  motorcycles: GroupMetrics;
  ranking: RankingEntry[];
}

/** Muestra periódica — Stream parking:timeseries (alimenta las gráficas). */
export interface MetricsSample {
  id: string;
  ts: number;
  simulated_time: string;
  global: number;
  cars: number;
  motorcycles: number;
  zones: Record<string, number>;
  entries_1m: number;
  exits_1m: number;
  entries_1m_cars: number;
  exits_1m_cars: number;
  entries_1m_motorcycles: number;
  exits_1m_motorcycles: number;
  events_per_second: number;
}

export interface Alert {
  id: string;
  zone_id: string;
  zone_name: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  unit: '%' | 'espacios' | 'pp';
  status: AlertStatus;
  timestamp: string;
  resolved_at?: string;
  resolution?: AlertResolution;
  resolution_message?: string;
}

export interface AlertChange {
  action: 'RAISED' | 'RESOLVED';
  alert: Alert;
}

export type SimulatorStatus = 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface ZoneScenarioState {
  scenario: ScenarioName;
  remaining_ticks: number | null;
}

/** Estado del simulador — Hash parking:simulator:state. */
export interface SimulatorState {
  status: SimulatorStatus;
  mode: SimulationMode;
  speed: number;
  interval_ms: number;
  effective_interval_ms: number;
  simulated_time: string;
  simulated_day: number;
  profile: string;
  global_scenario: ScenarioName;
  zone_scenarios: Record<string, ZoneScenarioState>;
  ticks: number;
  events_published: number;
  started_at: string;
  updated_at: string;
}

export type ServiceState = 'ONLINE' | 'OFFLINE' | 'RECONNECTING' | 'PAUSED' | 'DEGRADED';

export interface ServiceStatus {
  name: string;
  label: string;
  state: ServiceState;
  last_seen: string | null;
  uptime_s: number | null;
  details: Record<string, string | number | boolean | null>;
}

export interface SystemStatus {
  timestamp: string;
  services: ServiceStatus[];
  redis: {
    connected: boolean;
    version: string | null;
    uptime_s: number | null;
    used_memory_human: string | null;
    connected_clients: number | null;
    ops_per_sec: number | null;
    keys: number | null;
  };
  streams: {
    events_length: number;
    timeseries_length: number;
    alerts_length: number;
    archiver_pending: number | null;
    archiver_lag: number | null;
    archiver_last_delivered: string | null;
  };
  postgres: {
    configured: boolean;
    connected: boolean;
    events_archived: number | null;
    alerts_archived: number | null;
    snapshots: number | null;
  };
  throughput: {
    events_published: number;
    events_processed: number;
    events_per_second: number;
    avg_processing_ms: number;
  };
}

/** Heartbeat — String JSON con TTL en parking:heartbeat:<service>. */
export interface Heartbeat {
  service: string;
  instance: string;
  pid: number;
  started_at: string;
  ts: number;
  redis: 'ready' | 'reconnecting';
  details: Record<string, string | number | boolean | null>;
}

/** Mensajes del canal parking-updates (Processor → Backend). */
export type ProcessedMessage =
  | {
      type: 'ZONE_UPDATE';
      event: ZoneEvent;
      zone: ZoneState;
      derived_events: ZoneEvent[];
      metrics: MetricsSnapshot;
      alerts: AlertChange[];
      processed_at: number;
    }
  | { type: 'METRICS_SAMPLE'; sample: MetricsSample; metrics: MetricsSnapshot }
  | {
      type: 'RESYNC';
      reason: string;
      recovered_events: number;
      zones: ZoneState[];
      metrics: MetricsSnapshot;
    };

/* ── Payloads Socket.IO (el backend añade emitted_at para medir latencia) ───────── */

export interface SocketEventPayload {
  event: ZoneEvent | SystemEvent;
  emitted_at: number;
}

export interface SocketZoneUpdatePayload {
  zone: ZoneState;
  event_id: string;
  generated_at: number;
  processed_at: number;
  emitted_at: number;
}

export interface SocketMetricsPayload {
  kind: 'snapshot' | 'sample';
  metrics: MetricsSnapshot;
  sample?: MetricsSample;
  emitted_at: number;
}

export interface SocketAlertPayload extends AlertChange {
  emitted_at: number;
}

export interface SocketResyncPayload {
  reason: string;
  recovered_events: number;
  emitted_at: number;
}

/** Respuesta de /api/zones/:id/history — estado vs histórico. */
export interface ZoneHistory {
  zone_id: string;
  events: ZoneEvent[];
  occupancy: Array<{ ts: number; occupancy: number }>;
}

export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
  size: number;
}
