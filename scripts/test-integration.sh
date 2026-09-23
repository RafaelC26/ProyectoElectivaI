#!/usr/bin/env bash
# Pruebas de integración contra un Redis DESECHABLE (puerto 6380).
# Importante: los canales Pub/Sub de Redis son globales (no dependen del número de base de
# datos), por eso las pruebas nunca usan el Redis del sistema en ejecución.
set -euo pipefail
NAME=uptc-redis-test
PORT="${REDIS_TEST_PORT:-6380}"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run --rm -d --name "$NAME" -p "$PORT:6379" redis:7-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" redis-cli ping >/dev/null 2>&1 && break; sleep 0.3; done
REDIS_TEST_PORT="$PORT" npx vitest run --project integration
