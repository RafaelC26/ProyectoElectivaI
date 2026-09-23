import type {
  AlertSeverity,
  AlertType,
  ParkingEventType,
  ServiceState,
  Trend,
  VehicleType,
  ZoneStatus,
} from '@uptc/shared';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Ban,
  Bike,
  Car,
  CircleCheck,
  Info,
  OctagonAlert,
  Pause,
  Play,
  RefreshCw,
  Siren,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

/** Color, etiqueta e icono por estado de zona: el color nunca va solo. */
export const STATUS_META: Record<ZoneStatus, { label: string; color: string; ink: string; icon: LucideIcon }> = {
  LOW: { label: 'Baja', color: 'var(--color-good)', ink: 'var(--color-good-ink)', icon: CircleCheck },
  NORMAL: { label: 'Normal', color: 'var(--color-good)', ink: 'var(--color-good-ink)', icon: CircleCheck },
  WARNING: { label: 'Advertencia', color: 'var(--color-warn)', ink: 'var(--color-warn-ink)', icon: TriangleAlert },
  CRITICAL: { label: 'Crítica', color: 'var(--color-serious)', ink: 'var(--color-serious-ink)', icon: Siren },
  FULL: { label: 'Llena', color: 'var(--color-crit)', ink: 'var(--color-crit-ink)', icon: Ban },
};

export const SEVERITY_META: Record<AlertSeverity, { label: string; color: string; icon: LucideIcon; rank: number }> = {
  CRITICAL: { label: 'CRITICAL', color: 'var(--color-crit-ink)', icon: OctagonAlert, rank: 2 },
  WARNING: { label: 'WARNING', color: 'var(--color-warn-ink)', icon: TriangleAlert, rank: 1 },
  INFO: { label: 'INFO', color: 'var(--color-ink-2)', icon: Info, rank: 0 },
};

export const TREND_META: Record<Trend, { label: string; icon: LucideIcon; arrow: string }> = {
  RISING: { label: 'Tendencia ascendente', icon: ArrowUpRight, arrow: '↑' },
  FALLING: { label: 'Tendencia descendente', icon: ArrowDownRight, arrow: '↓' },
  STABLE: { label: 'Estable', icon: ArrowRight, arrow: '→' },
};

export const VEHICLE_META: Record<VehicleType, { label: string; short: string; color: string; icon: LucideIcon }> = {
  CAR: { label: 'Carros', short: 'Carro', color: 'var(--color-car)', icon: Car },
  MOTORCYCLE: { label: 'Motocicletas', short: 'Moto', color: 'var(--color-moto)', icon: Bike },
};

export const SERVICE_STATE_META: Record<ServiceState, { label: string; color: string }> = {
  ONLINE: { label: 'ONLINE', color: 'var(--color-good-ink)' },
  OFFLINE: { label: 'OFFLINE', color: 'var(--color-crit-ink)' },
  RECONNECTING: { label: 'RECONNECTING', color: 'var(--color-warn-ink)' },
  PAUSED: { label: 'PAUSADO', color: 'var(--color-warn-ink)' },
  DEGRADED: { label: 'DEGRADADO', color: 'var(--color-serious-ink)' },
};

/** Color fijo por zona (sigue a la entidad, nunca a su posición). Validado CVD sobre blanco. */
export const ZONE_COLORS: Record<string, string> = {
  'CARS-A': '#2563eb',
  'CARS-B': '#059669',
  'CARS-C': '#b7791f',
  'MOTOS-01': '#a21caf',
  'MOTOS-02': '#dc4c14',
  'MOTOS-03': '#0d9488',
};
const FALLBACK_COLORS = ['#2563eb', '#059669', '#b7791f', '#a21caf', '#dc4c14', '#0d9488'];

export function zoneColor(zoneId: string, index = 0): string {
  return ZONE_COLORS[zoneId] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export const GROUP_COLORS = { global: '#0b1220', cars: '#2563eb', motorcycles: '#a21caf' } as const;

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  OCCUPANCY_WARNING: 'Ocupación en advertencia',
  HIGH_OCCUPANCY: 'Ocupación crítica',
  PARKING_FULL: 'Zona completamente ocupada',
  LOW_AVAILABILITY: 'Disponibilidad limitada',
  UNUSUAL_OCCUPANCY_INCREASE: 'Crecimiento inusual',
  CAR_PARKING_FULL: 'Parqueadero de carros lleno',
  MOTORCYCLE_PARKING_FULL: 'Parqueadero de motos lleno',
};

/** Apariencia de cada tipo de evento en el flujo de actividad. */
export function eventVisual(
  type: ParkingEventType,
  vehicle?: VehicleType,
): { icon: LucideIcon; color: string; category: 'vehicle' | 'state' | 'system' } {
  switch (type) {
    case 'VEHICLE_ENTERED':
    case 'VEHICLE_EXITED':
      return {
        icon: vehicle === 'MOTORCYCLE' ? Bike : Car,
        color: type === 'VEHICLE_ENTERED' ? 'var(--color-in)' : 'var(--color-out)',
        category: 'vehicle',
      };
    case 'PARKING_FULL':
      return { icon: Ban, color: 'var(--color-crit-ink)', category: 'state' };
    case 'OCCUPANCY_CRITICAL':
      return { icon: Siren, color: 'var(--color-serious-ink)', category: 'state' };
    case 'OCCUPANCY_WARNING':
      return { icon: TriangleAlert, color: 'var(--color-warn-ink)', category: 'state' };
    case 'PARKING_AVAILABLE':
    case 'ZONE_RECOVERED':
      return { icon: CircleCheck, color: 'var(--color-good-ink)', category: 'state' };
    case 'ZONE_STATUS_CHANGED':
      return { icon: TrendingUp, color: 'var(--color-ink-2)', category: 'state' };
    case 'SIMULATION_STARTED':
      return { icon: Play, color: 'var(--color-ink-2)', category: 'system' };
    case 'SIMULATION_STOPPED':
      return { icon: Pause, color: 'var(--color-ink-2)', category: 'system' };
    default:
      return { icon: RefreshCw, color: 'var(--color-ink-2)', category: 'system' };
  }
}
