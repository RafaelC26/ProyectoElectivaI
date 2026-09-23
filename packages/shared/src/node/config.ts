import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import {
  SimulationConfigSchema,
  ThresholdsSchema,
  ZonesConfigSchema,
  type SimulationConfig,
  type Thresholds,
  type ZoneConfig,
} from '../schemas/config.schema';
import { formatZodError } from '../schemas/event.schema';
import { envNumber, envOptional, findProjectRoot } from './env';

export function configDir(): string {
  return envOptional('CONFIG_DIR') ?? join(findProjectRoot(), 'config');
}

function readJson<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  const path = join(configDir(), file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer ${path}: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Configuración inválida en ${file}: ${formatZodError(parsed.error)}`);
  return parsed.data;
}

/** config/zones.json — nombres y capacidades modificables sin tocar el código. */
export function loadZones(): ZoneConfig[] {
  return readJson('zones.json', ZonesConfigSchema).zones;
}

/** config/thresholds.json con sobrescrituras desde variables de entorno. */
export function loadThresholds(): Thresholds {
  const base = readJson('thresholds.json', ThresholdsSchema);
  const merged = {
    ...base,
    occupancy: {
      ...base.occupancy,
      warning: envNumber('WARNING_OCCUPANCY', base.occupancy.warning),
      critical: envNumber('CRITICAL_OCCUPANCY', base.occupancy.critical),
    },
    lowAvailability: envNumber('LOW_AVAILABILITY', base.lowAvailability),
    alertCooldownSeconds: envNumber('ALERT_COOLDOWN_SECONDS', base.alertCooldownSeconds),
  };
  const parsed = ThresholdsSchema.safeParse(merged);
  if (!parsed.success) throw new Error(`Umbrales inválidos tras aplicar .env: ${formatZodError(parsed.error)}`);
  return parsed.data;
}

export function loadSimulationConfig(): SimulationConfig {
  return readJson('simulation.json', SimulationConfigSchema);
}
