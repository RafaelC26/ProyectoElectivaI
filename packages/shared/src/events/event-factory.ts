import { SCHEMA_VERSION } from '../constants/domain';
import type { ParkingEvent } from '../schemas/event.schema';

export const NULL_LOCATION = { latitude: null, longitude: null } as const;

export function formatEventId(sequence: number): string {
  return `evt_${String(sequence).padStart(6, '0')}`;
}

export function formatAlertId(sequence: number): string {
  return `alert_${String(sequence).padStart(6, '0')}`;
}

export function baseMetadata(source: 'SIMULATOR' | 'PUBLISHER' | 'PROCESSOR', generatedAt = Date.now()) {
  return { source, schema_version: SCHEMA_VERSION, generated_at: generatedAt };
}

/**
 * Codificación de un evento como entrada de Redis Stream.
 * Se guardan campos planos (legibles con XRANGE / RedisInsight) + el JSON completo en "payload".
 */
export function eventToStreamFields(event: ParkingEvent): string[] {
  const fields = [
    'event_id',
    event.event_id,
    'event_type',
    event.event_type,
    'entity_id',
    event.entity_id,
    'timestamp',
    event.timestamp,
    'source',
    event.metadata.source,
  ];
  if ('occupied' in event.data) {
    fields.push('occupied', String(event.data.occupied), 'capacity', String(event.data.capacity));
    fields.push('occupancy', String(event.data.occupancy));
  }
  fields.push('payload', JSON.stringify(event));
  return fields;
}

/** Convierte la lista plana [k1, v1, k2, v2…] que devuelve Redis en un objeto. */
export function fieldsToObject(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) out[fields[i]] = fields[i + 1];
  return out;
}

export interface StreamEvent {
  stream_id: string;
  event: ParkingEvent;
}

export function parseStreamEntry(entry: [string, string[]]): StreamEvent | null {
  const [id, raw] = entry;
  const fields = fieldsToObject(raw);
  if (!fields.payload) return null;
  try {
    const event = JSON.parse(fields.payload) as ParkingEvent;
    event.metadata = { ...event.metadata, stream_id: id };
    return { stream_id: id, event };
  } catch {
    return null;
  }
}

/** Compara IDs de Stream "ms-seq" (true si a > b). */
export function streamIdGreaterThan(a: string, b: string): boolean {
  const [am, as] = a.split('-').map(Number);
  const [bm, bs] = b.split('-').map(Number);
  return am > bm || (am === bm && as > bs);
}

/** Epoch ms codificado en un ID de Stream. */
export function streamIdToMs(id: string): number {
  return Number(id.split('-')[0]);
}
