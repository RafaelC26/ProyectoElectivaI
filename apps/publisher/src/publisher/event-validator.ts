import { SensorEventSchema, SystemEventSchema, formatZodError, type SensorEvent, type SystemEvent } from '@uptc/shared';

export class EventValidationError extends Error {
  constructor(
    message: string,
    readonly eventId: string,
  ) {
    super(message);
  }
}

/**
 * VALIDACIÓN con Zod: estructura, tipos, formato de IDs y reglas de consistencia
 * (0 <= occupied <= capacity, available = capacity − occupied, occupancy correcta).
 * Un evento inválido NO se publica.
 */
export function validateSensorEvent(candidate: unknown): SensorEvent {
  const result = SensorEventSchema.safeParse(candidate);
  if (!result.success) {
    const id = (candidate as { event_id?: string })?.event_id ?? 'unknown';
    throw new EventValidationError(formatZodError(result.error), id);
  }
  return result.data;
}

export function validateSystemEvent(candidate: unknown): SystemEvent {
  const result = SystemEventSchema.safeParse(candidate);
  if (!result.success) {
    const id = (candidate as { event_id?: string })?.event_id ?? 'unknown';
    throw new EventValidationError(formatZodError(result.error), id);
  }
  return result.data;
}
