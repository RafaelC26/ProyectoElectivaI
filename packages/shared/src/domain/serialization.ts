import type { Alert, GroupMetrics, MetricsSample, ZoneState } from '../types/models';

/** Redis Hash ⇄ objetos tipados. Los Hashes guardan strings; aquí se recuperan los números. */

const ZONE_NUMERIC: (keyof ZoneState)[] = [
  'capacity',
  'occupied',
  'available',
  'occupancy',
  'previous_occupancy',
  'occupancy_delta',
  'entries_per_minute',
  'exits_per_minute',
  'entries_5m',
  'exits_5m',
  'entries_15m',
  'exits_15m',
  'total_entries',
  'total_exits',
  'trend_delta',
  'avg_occupancy_5m',
  'variation_5m',
];

export function toHash(obj: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

export function hashToZoneState(hash: Record<string, string> | null | undefined): ZoneState | null {
  if (!hash || !hash.zone_id) return null;
  const state = { ...hash } as unknown as Record<string, unknown>;
  for (const key of ZONE_NUMERIC) state[key] = Number(hash[key] ?? 0) || 0;
  return state as unknown as ZoneState;
}

const METRIC_STRINGS = new Set(['scope', 'trend', 'most_occupied_zone', 'updated_at']);

export function hashToGroupMetrics(hash: Record<string, string> | null | undefined): GroupMetrics | null {
  if (!hash || !hash.scope) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hash)) out[k] = METRIC_STRINGS.has(k) ? v : Number(v) || 0;
  out.most_occupied_zone = hash.most_occupied_zone || null;
  return out as unknown as GroupMetrics;
}

/** Stream parking:timeseries: campos planos; "zone:<id>" guarda la ocupación de cada zona. */
export function sampleToFields(sample: Omit<MetricsSample, 'id'>): string[] {
  const fields: string[] = [
    'ts',
    String(sample.ts),
    'simulated_time',
    sample.simulated_time,
    'global',
    String(sample.global),
    'cars',
    String(sample.cars),
    'motorcycles',
    String(sample.motorcycles),
    'entries_1m',
    String(sample.entries_1m),
    'exits_1m',
    String(sample.exits_1m),
    'entries_1m_cars',
    String(sample.entries_1m_cars),
    'exits_1m_cars',
    String(sample.exits_1m_cars),
    'entries_1m_motorcycles',
    String(sample.entries_1m_motorcycles),
    'exits_1m_motorcycles',
    String(sample.exits_1m_motorcycles),
    'events_per_second',
    String(sample.events_per_second),
  ];
  for (const [zoneId, occupancy] of Object.entries(sample.zones)) fields.push(`zone:${zoneId}`, String(occupancy));
  return fields;
}

export function fieldsToSample(id: string, raw: string[]): MetricsSample {
  const zones: Record<string, number> = {};
  const values: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) {
    if (raw[i].startsWith('zone:')) zones[raw[i].slice(5)] = Number(raw[i + 1]);
    else values[raw[i]] = raw[i + 1];
  }
  const n = (k: string) => Number(values[k] ?? 0) || 0;
  return {
    id,
    ts: n('ts') || Number(id.split('-')[0]),
    simulated_time: values.simulated_time ?? '',
    global: n('global'),
    cars: n('cars'),
    motorcycles: n('motorcycles'),
    zones,
    entries_1m: n('entries_1m'),
    exits_1m: n('exits_1m'),
    entries_1m_cars: n('entries_1m_cars'),
    exits_1m_cars: n('exits_1m_cars'),
    entries_1m_motorcycles: n('entries_1m_motorcycles'),
    exits_1m_motorcycles: n('exits_1m_motorcycles'),
    events_per_second: n('events_per_second'),
  };
}

export function parseAlert(raw: string | null | undefined): Alert | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Alert;
  } catch {
    return null;
  }
}
