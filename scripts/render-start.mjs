#!/usr/bin/env node
// Arranque "todo en uno" para Render (el plan gratuito sólo permite servicios web, no workers).
// Lanza processor, archiver, backend y publisher como procesos independientes que se comunican
// únicamente a través de Redis, igual que los contenedores de Docker Compose. El backend escucha
// en $PORT (lo asigna Render) y sirve también el dashboard compilado (STATIC_DIR).
// Si un proceso termina, se detienen todos y el contenedor sale con error para que Render lo reinicie.
// Usa los archivos precompilados de build/ (docker/render.Dockerfile); si no existen, ejecuta el
// código TypeScript con tsx.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// El backend primero: Render considera el servicio arriba cuando el puerto responde.
const SERVICES = ['backend', 'processor', 'archiver', 'publisher'];
const args = (name) =>
  existsSync(`build/${name}.mjs`) ? [`build/${name}.mjs`] : ['--import', 'tsx', `apps/${name}/src/index.ts`];
const env = { ...process.env, BACKEND_PORT: process.env.PORT ?? process.env.BACKEND_PORT ?? '3000' };
const children = new Map();
let stopping = false;
let exitCode = 0;

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 10_000).unref();
  if (children.size === 0) process.exit(exitCode);
}

for (const name of SERVICES) {
  const child = spawn(process.execPath, args(name), { env, stdio: 'inherit' });
  children.set(name, child);
  child.on('exit', (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.error(`[render-start] ${name} terminó (code=${code} signal=${signal}); se detiene el servicio`);
      stopAll(1);
    }
    if (children.size === 0) process.exit(exitCode);
  });
}

process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));
