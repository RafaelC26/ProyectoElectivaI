import {
  NULL_LOCATION,
  SCHEMA_VERSION,
  SCENARIOS,
  calculateAvailable,
  calculateOccupancy,
  clampOccupied,
  type ScenarioName,
  type SensorEvent,
  type SimulationMode,
  type SystemEvent,
  type ZoneConfig,
} from '@uptc/shared';
import type { RawSensorReading } from '../simulation/zone-simulator';

export class UnknownZoneError extends Error {}

/**
 * NORMALIZACIÓN: convierte la lectura propia del sensor (camelCase, IN/OUT, epoch ms,
 * id en minúsculas) al modelo común de eventos (snake_case, VEHICLE_ENTERED/EXITED,
 * ISO‑8601, porcentajes con 2 decimales). La capacidad se toma del catálogo de zonas
 * (config/zones.json), no del sensor.
 */
export class EventNormalizer {
  private readonly catalog: Map<string, ZoneConfig>;

  constructor(zones: ZoneConfig[]) {
    this.catalog = new Map(zones.map((z) => [z.id, z]));
  }

  normalize(raw: RawSensorReading, eventId: string, generatedAt = Date.now()): SensorEvent {
    const zoneId = raw.zoneId.trim().toUpperCase();
    const zone = this.catalog.get(zoneId);
    if (!zone) throw new UnknownZoneError(`Zona desconocida en lectura de sensor: ${raw.zoneId}`);

    const occupied = clampOccupied(raw.count, zone.capacity);
    const scenario = (SCENARIOS as readonly string[]).includes(raw.scenario)
      ? (raw.scenario as ScenarioName)
      : undefined;

    return {
      event_id: eventId,
      event_type: raw.direction === 'IN' ? 'VEHICLE_ENTERED' : 'VEHICLE_EXITED',
      entity_id: zoneId,
      timestamp: new Date(raw.detectedAt).toISOString(),
      location: { ...NULL_LOCATION },
      data: {
        vehicle_type: zone.vehicleType,
        zone_name: zone.name,
        capacity: zone.capacity,
        occupied,
        available: calculateAvailable(zone.capacity, occupied),
        occupancy: calculateOccupancy(occupied, zone.capacity),
        entries_per_minute: raw.window.in,
        exits_per_minute: raw.window.out,
      },
      metadata: {
        source: 'SIMULATOR',
        schema_version: SCHEMA_VERSION,
        generated_at: generatedAt,
        simulated_time: raw.simClock,
        sensor_id: raw.sensorId.toUpperCase(),
        scenario,
        ...(raw.manual ? { manual: true } : {}),
      },
    };
  }
}

export function buildSystemEvent(
  type: SystemEvent['event_type'],
  eventId: string,
  state: { mode: SimulationMode; speed: number; scenario: ScenarioName; simulatedTime: string },
  message: string,
  zoneId: string | null = null,
): SystemEvent {
  const now = Date.now();
  return {
    event_id: eventId,
    event_type: type,
    entity_id: 'SIMULATOR',
    timestamp: new Date(now).toISOString(),
    location: { ...NULL_LOCATION },
    data: { mode: state.mode, speed: state.speed, scenario: state.scenario, zone_id: zoneId, message },
    metadata: {
      source: 'PUBLISHER',
      schema_version: SCHEMA_VERSION,
      generated_at: now,
      simulated_time: state.simulatedTime,
    },
  };
}
