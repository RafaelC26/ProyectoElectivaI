import { SCHEMA_VERSION, calculateOccupancy, type SensorEvent, type Thresholds, type ZoneState } from '@uptc/shared';
import { initialZoneState } from '../src/processor/zone-state';

export const THRESHOLDS: Thresholds = {
  occupancy: { normal: 60, warning: 80, critical: 90, full: 100 },
  lowAvailability: 5,
  unusualIncreasePercent: 20,
  unusualIncreaseWindowSeconds: 6,
  trend: { threshold: 3, windowSeconds: 30 },
  alertHysteresis: 2,
  alertCooldownSeconds: 30,
};

export const ZONE_M2 = {
  id: 'MOTOS-02',
  name: 'Zona M2',
  vehicleType: 'MOTORCYCLE' as const,
  capacity: 80,
  demandFactor: 1,
};

export function zoneState(occupied: number, overrides: Partial<ZoneState> = {}): ZoneState {
  const base = initialZoneState(ZONE_M2, THRESHOLDS, '2026-09-22T14:30:00.000Z');
  const occupancy = calculateOccupancy(occupied, 80);
  const status =
    occupancy >= 100
      ? 'FULL'
      : occupancy >= 90
        ? 'CRITICAL'
        : occupancy >= 80
          ? 'WARNING'
          : occupancy >= 60
            ? 'NORMAL'
            : 'LOW';
  return {
    ...base,
    occupied,
    available: 80 - occupied,
    occupancy,
    status,
    previous_status: status,
    last_event: 'VEHICLE_ENTERED',
    ...overrides,
  };
}

export function sensorEvent(
  occupied: number,
  type: 'VEHICLE_ENTERED' | 'VEHICLE_EXITED' = 'VEHICLE_ENTERED',
  id = 1,
): SensorEvent {
  return {
    event_id: `evt_${String(id).padStart(6, '0')}`,
    event_type: type,
    entity_id: 'MOTOS-02',
    timestamp: new Date(1_790_000_000_000 + id * 1000).toISOString(),
    location: { latitude: null, longitude: null },
    data: {
      vehicle_type: 'MOTORCYCLE',
      zone_name: 'Zona M2',
      capacity: 80,
      occupied,
      available: 80 - occupied,
      occupancy: calculateOccupancy(occupied, 80),
    },
    metadata: {
      source: 'SIMULATOR',
      schema_version: SCHEMA_VERSION,
      generated_at: 1_790_000_000_000 + id * 1000,
      simulated_time: '14:30',
    },
  };
}
