import type {
  ALERT_RESOLUTIONS,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  CORE_EVENT_TYPES,
  EXTENDED_EVENT_TYPES,
  SCENARIOS,
  SIMULATION_MODES,
  TRENDS,
  VEHICLE_TYPES,
  ZONE_STATUSES,
} from '../constants/domain';

export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type ZoneStatus = (typeof ZONE_STATUSES)[number];
export type Trend = (typeof TRENDS)[number];

export type CoreParkingEventType = (typeof CORE_EVENT_TYPES)[number];
export type ExtendedParkingEventType = (typeof EXTENDED_EVENT_TYPES)[number];
export type ParkingEventType = CoreParkingEventType | ExtendedParkingEventType;

export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type AlertResolution = (typeof ALERT_RESOLUTIONS)[number];

export type SimulationMode = (typeof SIMULATION_MODES)[number];
export type ScenarioName = (typeof SCENARIOS)[number];

/** Perfiles de demanda del día (sección 24). */
export enum DemandProfile {
  HIGH_ENTRY = 'HIGH_ENTRY',
  STABLE = 'STABLE',
  HIGH_EXIT = 'HIGH_EXIT',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export type MovementKind = 'ENTRY' | 'EXIT';

export interface OccupancyThresholds {
  normal: number;
  warning: number;
  critical: number;
  full: number;
}
