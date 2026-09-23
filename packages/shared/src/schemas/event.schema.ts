import { z } from 'zod';
import {
  EVENT_SOURCES,
  SCENARIOS,
  SCHEMA_VERSION,
  SENSOR_EVENT_TYPES,
  SIMULATION_MODES,
  SYSTEM_EVENT_TYPES,
  VEHICLE_TYPES,
  ZONE_EVENT_TYPES,
  ZONE_STATUSES,
} from '../constants/domain';
import { calculateOccupancy } from '../domain/occupancy';

export const VehicleTypeSchema = z.enum(VEHICLE_TYPES);
export const ZoneStatusSchema = z.enum(ZONE_STATUSES);
export const ScenarioSchema = z.enum(SCENARIOS);
export const SimulationModeSchema = z.enum(SIMULATION_MODES);

/** No se inventan coordenadas: latitude/longitude permanecen en null sin datos reales. */
export const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});

export const EventMetadataSchema = z.object({
  source: z.enum(EVENT_SOURCES),
  schema_version: z.literal(SCHEMA_VERSION),
  /** Epoch ms en que el Publisher generó el evento (base de la latencia end-to-end). */
  generated_at: z.number().int().positive(),
  simulated_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  sensor_id: z.string().optional(),
  scenario: ScenarioSchema.optional(),
  /** ID de la entrada en parking:stream (lo añade el Publisher tras el XADD). */
  stream_id: z
    .string()
    .regex(/^\d+-\d+$/)
    .optional(),
  /** Epoch ms en que el Processor terminó de procesar el evento. */
  processed_at: z.number().int().positive().optional(),
  /** Para eventos derivados: event_id del evento de sensor que los provocó. */
  caused_by: z.string().optional(),
  /** true si el evento se procesó durante la recuperación desde el Stream. */
  replayed: z.boolean().optional(),
  /** true si el evento fue forzado manualmente desde el panel de simulación. */
  manual: z.boolean().optional(),
});

export const ZoneEventDataSchema = z
  .object({
    vehicle_type: VehicleTypeSchema,
    zone_name: z.string().min(1),
    capacity: z.number().int().positive(),
    occupied: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    occupancy: z.number().min(0).max(100),
    entries_per_minute: z.number().nonnegative().optional(),
    exits_per_minute: z.number().nonnegative().optional(),
    status: ZoneStatusSchema.optional(),
    previous_status: ZoneStatusSchema.optional(),
    previous_occupancy: z.number().min(0).max(100).optional(),
  })
  .superRefine((d, ctx) => {
    // Reglas fundamentales de consistencia (sección 11).
    if (d.occupied > d.capacity) {
      ctx.addIssue({ code: 'custom', path: ['occupied'], message: 'occupied no puede superar capacity' });
    }
    if (d.available !== d.capacity - d.occupied) {
      ctx.addIssue({ code: 'custom', path: ['available'], message: 'available debe ser capacity - occupied' });
    }
    if (Math.abs(calculateOccupancy(d.occupied, d.capacity) - d.occupancy) > 0.01) {
      ctx.addIssue({ code: 'custom', path: ['occupancy'], message: 'occupancy debe ser occupied / capacity × 100' });
    }
  });

export const SystemEventDataSchema = z.object({
  mode: SimulationModeSchema,
  speed: z.number().positive(),
  scenario: ScenarioSchema,
  zone_id: z.string().nullable(),
  message: z.string(),
});

const EventIdSchema = z.string().regex(/^evt_\d{6,}$/, 'event_id debe tener el formato evt_000001');

/** Eventos asociados a una zona (sensor + derivados). */
export const ZoneEventSchema = z.object({
  event_id: EventIdSchema,
  event_type: z.enum(ZONE_EVENT_TYPES),
  entity_id: z.string().min(1),
  timestamp: z.iso.datetime(),
  location: LocationSchema,
  data: ZoneEventDataSchema,
  metadata: EventMetadataSchema,
});

/** Eventos generados por los sensores virtuales (canal parking-events). */
export const SensorEventSchema = ZoneEventSchema.extend({
  event_type: z.enum(SENSOR_EVENT_TYPES),
});

/** Eventos internos del simulador (canal system-events). */
export const SystemEventSchema = z.object({
  event_id: EventIdSchema,
  event_type: z.enum(SYSTEM_EVENT_TYPES),
  entity_id: z.literal('SIMULATOR'),
  timestamp: z.iso.datetime(),
  location: LocationSchema,
  data: SystemEventDataSchema,
  metadata: EventMetadataSchema,
});

export const ParkingEventSchema = z.union([ZoneEventSchema, SystemEventSchema]);

export type ZoneEvent = z.infer<typeof ZoneEventSchema>;
export type SensorEvent = z.infer<typeof SensorEventSchema>;
export type SystemEvent = z.infer<typeof SystemEventSchema>;
export type ParkingEvent = z.infer<typeof ParkingEventSchema>;
export type EventMetadata = z.infer<typeof EventMetadataSchema>;
export type ZoneEventData = z.infer<typeof ZoneEventDataSchema>;

/** Formatea los errores de Zod en una sola línea legible para los logs. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
