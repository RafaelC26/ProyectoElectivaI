# PostgreSQL — histórico permanente

Redis contesta *"¿cómo está ahora?"* y *"¿cómo evolucionó en los últimos minutos?"*. Una solución
real también necesita *"¿qué pasó ayer, la semana pasada, en el semestre?"*: reportes diarios,
estadísticas mensuales, auditoría de incidentes y analítica institucional (sección 112). Para eso el
proyecto incorpora PostgreSQL como almacenamiento permanente, **sin quitarle a Redis su papel central**
en el tiempo real.

## 1. Credenciales

| Parámetro | Valor |
|---|---|
| Usuario (rol) | `proyecto_electiva_1` |
| Contraseña | `Admin` |
| Base de datos | `uptc_smart_parking` |
| Desde el equipo | `postgres://proyecto_electiva_1:Admin@localhost:5432/uptc_smart_parking` |
| Desde Docker | `postgres://proyecto_electiva_1:Admin@host.docker.internal:5432/uptc_smart_parking` |

> El nombre del rol usa guiones bajos (no "Proyecto Electiva 1") porque los espacios obligan a citar
> el identificador en SQL y a codificarlo en las URL de conexión. La contraseña es de desarrollo:
> cambiarla antes de desplegar en una VPS.

Creación (idempotente):

```bash
npm run db:setup
```

## 2. Flujo de datos

```mermaid
flowchart LR
    P[Publisher] -->|XADD| S[(parking:stream)]
    PR[Processor] -->|XADD derivados| S
    PR -->|XADD| A[(parking:alerts:stream)]
    S -->|XREADGROUP archiver| AR[Archiver]
    A -->|XREADGROUP archiver| AR
    AR -->|INSERT … ON CONFLICT| DB[(PostgreSQL)]
    AR -->|XACK| S
    Z[(parking:zone:*)] -->|cada 60 s| AR
    B[Backend /api/archive] --> DB
```

- **Consumer group** `archiver`: cada entrada se entrega una vez al consumidor y se confirma
  (`XACK`) sólo después de escribirla en PostgreSQL. Si el archiver se cae entre la lectura y la
  confirmación, la entrada queda pendiente (PEL) y se reintenta al volver.
- **Idempotencia:** `parking_events.stream_id` es la clave primaria; `alerts` usa `(id, raised_at)`.
  Reintentar un lote nunca duplica filas ("al menos una vez" seguro).
- **Tolerancia:** si PostgreSQL no responde, el archiver deja de consumir y los eventos esperan en el
  Stream (el *lag* se ve en `/system`). El resto del sistema no se afecta.

## 3. Esquema (`db/schema.sql`)

```text
zones            id PK · name · vehicle_type (CAR|MOTORCYCLE) · capacity > 0 · updated_at
parking_events   stream_id PK · event_id · event_type · entity_id · occurred_at · vehicle_type ·
                 occupied ≥ 0 · capacity > 0 · occupancy 0–100 · status · source · payload jsonb ·
                 archived_at · CHECK (occupied <= capacity)
alerts           (id, raised_at) PK · zone_id · zone_name · type · severity · message · value ·
                 threshold · unit · status (ACTIVE|RESOLVED) · resolved_at · resolution ·
                 resolution_message · payload jsonb · updated_at
zone_snapshots   id PK · zone_id FK → zones · captured_at · occupied · capacity · available ·
                 occupancy · status · trend · entries_per_minute · exits_per_minute · simulated_time
daily_zone_summary (vista) day · zone · entries · exits · peak_occupancy · avg_occupancy · times_full · alerts
```

Índices: `(entity_id, occurred_at DESC)`, `(event_type, occurred_at DESC)`, `(occurred_at DESC)`,
`alerts (raised_at DESC)`, `alerts (zone_id, raised_at DESC)`, `zone_snapshots (zone_id, captured_at DESC)`.

Las restricciones `CHECK` repiten en la base de datos las reglas de consistencia de la sección 11.

## 4. Consultas de ejemplo

```sql
-- Reporte del día por zona
SELECT * FROM daily_zone_summary WHERE day = current_date ORDER BY zone_id;

-- Hora pico de cada zona según las instantáneas
SELECT zone_id, date_trunc('hour', captured_at) AS hora, round(avg(occupancy), 1) AS ocupacion
  FROM zone_snapshots GROUP BY 1, 2 ORDER BY 1, 2;

-- Duración promedio de las alertas críticas
SELECT type, round(avg(extract(epoch FROM resolved_at - raised_at)), 1) AS segundos
  FROM alerts WHERE status = 'RESOLVED' GROUP BY type;

-- ¿Cuántas veces se llenó cada zona esta semana?
SELECT entity_id, count(*) FROM parking_events
 WHERE event_type = 'PARKING_FULL' AND occurred_at > now() - interval '7 days' GROUP BY 1;
```

Estas consultas se exponen en `/api/archive/*` y en la sección PostgreSQL del panel `/debug`.

## 5. Retención

`ARCHIVE_RETENTION_DAYS` (30 por defecto): cada hora el archiver elimina eventos e instantáneas más
antiguos y alertas resueltas antiguas. En una implementación institucional se reemplazaría por
particionado mensual de `parking_events` y tablas de agregados precalculados.

## 6. PostgreSQL en contenedor (VPS o equipos sin PostgreSQL)

```bash
docker compose --profile local-db up --build
```

Y en `.env`: `DATABASE_URL=postgres://proyecto_electiva_1:Admin@postgres:5432/uptc_smart_parking`.
El archiver crea el esquema al iniciar.

## 7. PostgreSQL del servidor desde Docker (Linux)

`docker-compose.yml` declara `extra_hosts: host.docker.internal:host-gateway`, por lo que la misma URL
funciona en Linux. Además:

1. `listen_addresses = '*'` (o la IP del puente de Docker) en `postgresql.conf`.
2. En `pg_hba.conf`: `host uptc_smart_parking proyecto_electiva_1 172.16.0.0/12 scram-sha-256`.
3. No abrir el puerto 5432 a Internet (firewall).
