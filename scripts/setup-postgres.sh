#!/usr/bin/env bash
# Crea el usuario y la base de datos del proyecto en un PostgreSQL local.
#   npm run db:setup          (usa el superusuario por defecto de psql)
#   PGUSER=postgres npm run db:setup
set -euo pipefail

DB_USER="${DB_USER:-proyecto_electiva_1}"
DB_PASSWORD="${DB_PASSWORD:-Admin}"
DB_NAME="${DB_NAME:-uptc_smart_parking}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "→ Rol ${DB_USER}"
psql -d postgres -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SQL

echo "→ Base de datos ${DB_NAME}"
if ! psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  createdb -O "${DB_USER}" "${DB_NAME}"
fi

echo "→ Esquema (db/schema.sql)"
PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q -f "${HERE}/../db/schema.sql"

echo "✓ Listo: postgres://${DB_USER}:***@localhost:5432/${DB_NAME}"
