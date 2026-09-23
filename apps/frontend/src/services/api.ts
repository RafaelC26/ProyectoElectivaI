import type {
  Alert,
  AlertChange,
  GroupMetrics,
  MetricsSample,
  ParkingEvent,
  RankingEntry,
  RedisKeyInfo,
  ScheduleEntry,
  SimulatorCommandInput,
  SimulatorState,
  SystemStatus,
  Thresholds,
  ZoneConfig,
  ZoneHistory,
  ZoneState,
} from '@uptc/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'uptc-demo-token';

export function getDemoToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setDemoToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* almacenamiento no disponible */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(body?.error?.message ?? response.statusText, response.status, body?.error?.code ?? 'HTTP_ERROR');
  }
  return (body as { data: T }).data;
}

export interface MetricsResponse {
  global: GroupMetrics | null;
  cars: GroupMetrics | null;
  motorcycles: GroupMetrics | null;
}

export interface InspectResult {
  key: string;
  type: string;
  ttl: number;
  command: string;
  value: unknown;
}

export const api = {
  config: () => request<{ zones: ZoneConfig[]; thresholds: Thresholds; schedule: ScheduleEntry[] }>('/config'),
  zones: () => request<ZoneState[]>('/zones'),
  zoneHistory: (id: string, minutes = 15, limit = 60) =>
    request<ZoneHistory>(`/zones/${id}/history?minutes=${minutes}&limit=${limit}`),
  metrics: () => request<MetricsResponse>('/metrics'),
  metricsHistory: (minutes = 15) => request<MetricsSample[]>(`/metrics/history?minutes=${minutes}`),
  ranking: () => request<RankingEntry[]>('/ranking'),
  events: (limit = 60) => request<ParkingEvent[]>(`/events?limit=${limit}`),
  activeAlerts: () => request<Alert[]>('/alerts/active'),
  alertHistory: (limit = 40) => request<Array<AlertChange & { stream_id: string }>>(`/alerts?limit=${limit}`),
  systemStatus: () => request<SystemStatus>('/system/status'),
  simulator: () => request<SimulatorState | null>('/simulator'),
  command: (command: SimulatorCommandInput) =>
    request<{ command_id: string; receivers: number }>('/simulator/commands', {
      method: 'POST',
      body: JSON.stringify(command),
      headers: getDemoToken() ? { 'x-demo-token': getDemoToken() } : {},
    }),
  debugKeys: () => request<RedisKeyInfo[]>('/debug/keys'),
  debugInspect: (key: string, count = 10) =>
    request<InspectResult>(`/debug/inspect?key=${encodeURIComponent(key)}&count=${count}`),
  debugPubSub: () => request<Array<{ channel: string; subscribers: number }>>('/debug/pubsub'),
  archiveStats: () =>
    request<{
      events: number;
      alerts: number;
      snapshots: number;
      first_event: string | null;
      last_event: string | null;
      last_archived: string | null;
      database_size: string | null;
      events_by_type: Array<{ event_type: string; total: number }>;
    }>('/archive/stats'),
  archiveDaily: (days = 7) =>
    request<
      Array<{
        day: string;
        zone_id: string;
        zone_name: string;
        vehicle_type: string;
        entries: string;
        exits: string;
        peak_occupancy: string;
        avg_occupancy: string;
        times_full: string;
        alerts: string;
      }>
    >(`/archive/daily?days=${days}`),
  archiveAlerts: (limit = 12) =>
    request<
      Array<{
        id: string;
        zone_id: string;
        type: string;
        severity: string;
        status: string;
        raised_at: string;
        resolved_at: string | null;
        resolution: string | null;
        duration_s: string;
      }>
    >(`/archive/alerts?limit=${limit}`),
};
