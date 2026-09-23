import { z } from 'zod';
import { VEHICLE_TYPES } from '../constants/domain';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'formato HH:mm');

export const ZoneConfigSchema = z.object({
  id: z.string().regex(/^[A-Z0-9-]+$/, 'id en mayúsculas, números y guiones'),
  name: z.string().min(1),
  vehicleType: z.enum(VEHICLE_TYPES),
  capacity: z.number().int().positive(),
  demandFactor: z.number().positive().max(3).default(1),
});

export const ZonesConfigSchema = z.object({ zones: z.array(ZoneConfigSchema).min(1) }).superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  cfg.zones.forEach((zone, i) => {
    if (seen.has(zone.id)) {
      ctx.addIssue({ code: 'custom', path: ['zones', i, 'id'], message: `id duplicado: ${zone.id}` });
    }
    seen.add(zone.id);
  });
});

export const ThresholdsSchema = z.object({
  occupancy: z
    .object({
      normal: z.number().min(0).max(100),
      warning: z.number().min(0).max(100),
      critical: z.number().min(0).max(100),
      full: z.number().min(0).max(100),
    })
    .refine((o) => o.normal < o.warning && o.warning < o.critical && o.critical <= o.full, {
      message: 'Se requiere normal < warning < critical <= full',
    }),
  lowAvailability: z.number().int().nonnegative(),
  unusualIncreasePercent: z.number().positive(),
  unusualIncreaseWindowSeconds: z.number().int().positive(),
  trend: z.object({
    threshold: z.number().positive(),
    windowSeconds: z.number().int().positive(),
  }),
  alertHysteresis: z.number().nonnegative(),
  alertCooldownSeconds: z.number().int().nonnegative(),
});

export const DemandProfileNameSchema = z.enum(['HIGH_ENTRY', 'STABLE', 'HIGH_EXIT', 'MEDIUM', 'LOW']);

export const ScheduleEntrySchema = z
  .object({
    from: clock,
    to: clock,
    profile: DemandProfileNameSchema,
    entryWeight: z.number().min(0).max(1),
    exitWeight: z.number().min(0).max(1),
    intensity: z.number().nonnegative(),
  })
  .refine((s) => Math.abs(s.entryWeight + s.exitWeight - 1) < 1e-6, {
    message: 'entryWeight + exitWeight debe ser 1',
  });

export const SimulationConfigSchema = z.object({
  accelerated: z.object({
    timeScale: z.number().positive(),
    dayStart: clock,
    dayEnd: clock,
  }),
  initialOccupancy: z.object({ min: z.number().min(0).max(1), max: z.number().min(0).max(1) }),
  normalCeiling: z.number().min(0.1).max(1),
  schedule: z.array(ScheduleEntrySchema).min(1),
  scenarios: z.object({
    HIGH_DEMAND: z.object({ intensityMultiplier: z.number().positive(), entryBoost: z.number(), ceiling: z.number() }),
    MASS_ENTRY: z.object({ fractionOfCapacity: z.number().positive(), ticks: z.number().int().positive() }),
    MASS_EXIT: z.object({ fractionOfCapacity: z.number().positive(), ticks: z.number().int().positive() }),
    NEAR_FULL: z.object({ targetMin: z.number(), targetMax: z.number(), stepFraction: z.number().positive() }),
    FULL: z.object({ stepFraction: z.number().positive() }),
    RECOVERY: z.object({ stepFraction: z.number().positive(), target: z.number().min(0).max(1) }),
  }),
});

export type ZoneConfig = z.infer<typeof ZoneConfigSchema>;
export type ZonesConfig = z.infer<typeof ZonesConfigSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;
export type SimulationConfig = z.infer<typeof SimulationConfigSchema>;
