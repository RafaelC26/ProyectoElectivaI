export const VEHICLE_TYPES = ['CAR', 'MOTORCYCLE'] as const;

/** Estados de ocupación de una zona (umbrales configurables en config/thresholds.json). */
export const ZONE_STATUSES = ['LOW', 'NORMAL', 'WARNING', 'CRITICAL', 'FULL'] as const;

export const TRENDS = ['RISING', 'FALLING', 'STABLE'] as const;

/** Tipos de evento mínimos exigidos. */
export const CORE_EVENT_TYPES = [
  'VEHICLE_ENTERED',
  'VEHICLE_EXITED',
  'PARKING_FULL',
  'PARKING_AVAILABLE',
  'ZONE_STATUS_CHANGED',
] as const;

/** Tipos de evento adicionales. */
export const EXTENDED_EVENT_TYPES = [
  'OCCUPANCY_WARNING',
  'OCCUPANCY_CRITICAL',
  'ZONE_RECOVERED',
  'SIMULATION_STARTED',
  'SIMULATION_STOPPED',
  'SCENARIO_CHANGED',
] as const;

/** Eventos que genera el sensor (simulador) — llegan por el canal parking-events. */
export const SENSOR_EVENT_TYPES = ['VEHICLE_ENTERED', 'VEHICLE_EXITED'] as const;

/** Eventos que deriva el Processor al comparar estado anterior vs estado actual. */
export const DERIVED_ZONE_EVENT_TYPES = [
  'PARKING_FULL',
  'PARKING_AVAILABLE',
  'ZONE_STATUS_CHANGED',
  'OCCUPANCY_WARNING',
  'OCCUPANCY_CRITICAL',
  'ZONE_RECOVERED',
] as const;

/** Eventos internos del sistema — canal system-events. */
export const SYSTEM_EVENT_TYPES = ['SIMULATION_STARTED', 'SIMULATION_STOPPED', 'SCENARIO_CHANGED'] as const;

export const ZONE_EVENT_TYPES = [...SENSOR_EVENT_TYPES, ...DERIVED_ZONE_EVENT_TYPES] as const;

export const EVENT_SOURCES = ['SIMULATOR', 'PUBLISHER', 'PROCESSOR'] as const;

export const SCHEMA_VERSION = '1.0' as const;

export const ALERT_TYPES = [
  'OCCUPANCY_WARNING',
  'HIGH_OCCUPANCY',
  'PARKING_FULL',
  'LOW_AVAILABILITY',
  'UNUSUAL_OCCUPANCY_INCREASE',
  'CAR_PARKING_FULL',
  'MOTORCYCLE_PARKING_FULL',
] as const;

export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const ALERT_STATUSES = ['ACTIVE', 'RESOLVED'] as const;
export const ALERT_RESOLUTIONS = ['RECOVERED', 'ESCALATED', 'DEESCALATED', 'CONDITION_CLEARED'] as const;

export const SIMULATION_MODES = ['REAL_TIME_PROFILE', 'ACCELERATED_DEMO'] as const;

export const SCENARIOS = ['NORMAL', 'HIGH_DEMAND', 'MASS_ENTRY', 'MASS_EXIT', 'NEAR_FULL', 'FULL', 'RECOVERY'] as const;

export const SIMULATION_SPEEDS = [1, 2, 5] as const;

/** Etiquetas en español para la interfaz. */
export const LABELS = {
  vehicleType: { CAR: 'Carros', MOTORCYCLE: 'Motocicletas' },
  status: { LOW: 'Baja', NORMAL: 'Normal', WARNING: 'Advertencia', CRITICAL: 'Crítica', FULL: 'Llena' },
  trend: { RISING: 'Ascendente', FALLING: 'Descendente', STABLE: 'Estable' },
  scenario: {
    NORMAL: 'Normal',
    HIGH_DEMAND: 'Alta demanda',
    MASS_ENTRY: 'Entrada masiva',
    MASS_EXIT: 'Salida masiva',
    NEAR_FULL: 'Cerca de lleno',
    FULL: 'Llenar zona',
    RECOVERY: 'Recuperación',
  },
  profile: {
    HIGH_ENTRY: 'Alta entrada',
    STABLE: 'Estable',
    HIGH_EXIT: 'Alta salida',
    MEDIUM: 'Demanda media',
    LOW: 'Baja demanda',
  },
  alertType: {
    OCCUPANCY_WARNING: 'Ocupación en advertencia',
    HIGH_OCCUPANCY: 'Ocupación crítica',
    PARKING_FULL: 'Zona llena',
    LOW_AVAILABILITY: 'Disponibilidad baja',
    UNUSUAL_OCCUPANCY_INCREASE: 'Crecimiento inusual',
    CAR_PARKING_FULL: 'Parqueadero de carros lleno',
    MOTORCYCLE_PARKING_FULL: 'Parqueadero de motos lleno',
  },
} as const;
