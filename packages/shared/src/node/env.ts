import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

/** Raíz del monorepo: carpeta que contiene /config (o CONFIG_DIR/.. si se define). */
export function findProjectRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'config', 'zones.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Carga .env.local y .env de la raíz si existen. Las variables ya presentes en el entorno
 * (p. ej. las que inyecta Docker Compose) tienen prioridad; .env.local tiene prioridad sobre .env.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const root = findProjectRoot();
  for (const file of ['.env.local', '.env']) {
    const path = join(root, file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

export function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envOptional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Variable de entorno ${name} inválida: "${raw}"`);
  return value;
}
