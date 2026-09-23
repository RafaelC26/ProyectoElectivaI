import {
  NULL_LOCATION,
  SCHEMA_VERSION,
  type AlertChange,
  type DERIVED_ZONE_EVENT_TYPES,
  type SensorEvent,
  type ZoneEvent,
  type ZoneState,
} from '@uptc/shared';

export type DerivedEventType = (typeof DERIVED_ZONE_EVENT_TYPES)[number];

/**
 * Eventos derivados al comparar el estado ANTERIOR con el ACTUAL:
 *   cambio de categoría  → ZONE_STATUS_CHANGED
 *   occupied === capacity → PARKING_FULL
 *   deja de estar llena   → PARKING_AVAILABLE
 */
export function deriveStatusEvents(previous: ZoneState | null, current: ZoneState): DerivedEventType[] {
  if (!previous || previous.status === current.status) return [];
  const types: DerivedEventType[] = ['ZONE_STATUS_CHANGED'];
  if (current.status === 'FULL') types.push('PARKING_FULL');
  if (previous.status === 'FULL') types.push('PARKING_AVAILABLE');
  return types;
}

/**
 * Eventos derivados de la máquina de alertas (que aplica histéresis y cooldown, de modo que
 * una zona que oscila alrededor del 80 % no genera advertencias repetidas):
 *   alerta OCCUPANCY_WARNING levantada → OCCUPANCY_WARNING
 *   alerta HIGH_OCCUPANCY levantada    → OCCUPANCY_CRITICAL
 *   alerta de ocupación resuelta por recuperación → ZONE_RECOVERED
 */
export function deriveAlertEvents(changes: AlertChange[], recovered: boolean): DerivedEventType[] {
  const types: DerivedEventType[] = [];
  for (const change of changes) {
    if (change.action !== 'RAISED') continue;
    if (change.alert.type === 'OCCUPANCY_WARNING') types.push('OCCUPANCY_WARNING');
    if (change.alert.type === 'HIGH_OCCUPANCY') types.push('OCCUPANCY_CRITICAL');
  }
  if (recovered) types.push('ZONE_RECOVERED');
  return types;
}

export function buildDerivedEvent(
  type: DerivedEventType,
  eventId: string,
  state: ZoneState,
  cause: SensorEvent,
  processedAt: number,
): ZoneEvent {
  return {
    event_id: eventId,
    event_type: type,
    entity_id: state.zone_id,
    timestamp: new Date(processedAt).toISOString(),
    location: { ...NULL_LOCATION },
    data: {
      vehicle_type: state.vehicle_type,
      zone_name: state.zone_name,
      capacity: state.capacity,
      occupied: state.occupied,
      available: state.available,
      occupancy: state.occupancy,
      status: state.status,
      previous_status: state.previous_status,
      previous_occupancy: state.previous_occupancy,
    },
    metadata: {
      source: 'PROCESSOR',
      schema_version: SCHEMA_VERSION,
      generated_at: processedAt,
      simulated_time: cause.metadata.simulated_time,
      caused_by: cause.event_id,
      ...(cause.metadata.replayed ? { replayed: true } : {}),
    },
  };
}
