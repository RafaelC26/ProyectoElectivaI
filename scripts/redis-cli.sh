#!/usr/bin/env bash
# Atajo para ejecutar redis-cli dentro del contenedor:  ./scripts/redis-cli.sh HGETALL parking:zone:CARS-A
exec docker compose exec -T redis redis-cli "$@"
