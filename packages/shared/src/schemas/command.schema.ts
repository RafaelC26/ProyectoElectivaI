import { z } from 'zod';
import { ScenarioSchema, SimulationModeSchema } from './event.schema';

const zoneTarget = z.string().min(1).max(40);
const forceCount = z.number().int().min(1).max(50).default(1);

/** Órdenes que el panel /simulator envía al Publisher a través del canal simulator-commands. */
export const SimulatorCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SET_SCENARIO'), scenario: ScenarioSchema, zone_id: zoneTarget }),
  z.object({ action: z.literal('SET_SPEED'), speed: z.union([z.literal(1), z.literal(2), z.literal(5)]) }),
  z.object({ action: z.literal('SET_MODE'), mode: SimulationModeSchema }),
  z.object({ action: z.literal('PAUSE') }),
  z.object({ action: z.literal('RESUME') }),
  z.object({ action: z.literal('RESET') }),
  z.object({ action: z.literal('FORCE_ENTRY'), zone_id: zoneTarget, count: forceCount }),
  z.object({ action: z.literal('FORCE_EXIT'), zone_id: zoneTarget, count: forceCount }),
]);

export const SimulatorCommandEnvelopeSchema = z.object({
  command_id: z.string().min(1),
  issued_at: z.number().int().positive(),
  command: SimulatorCommandSchema,
});

export type SimulatorCommand = z.infer<typeof SimulatorCommandSchema>;
export type SimulatorCommandInput = z.input<typeof SimulatorCommandSchema>;
export type SimulatorCommandEnvelope = z.infer<typeof SimulatorCommandEnvelopeSchema>;
