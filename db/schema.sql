-- ─────────────────────────────────────────────────────────────────────────────
--  UPTC Smart Parking — histórico PERMANENTE en PostgreSQL
--
--  Redis guarda el estado actual y el histórico RECIENTE (Streams con MAXLEN).
--  PostgreSQL conserva lo que en producción debe durar: eventos de días/meses,
--  alertas e instantáneas de ocupación para reportes e informes institucionales.
--
--  El servicio "archiver" ejecuta este script al iniciar (es idempotente) y
--  alimenta las tablas leyendo parking:stream con un consumer group de Redis.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zones (
  id            text PRIMARY KEY,
  name          text        NOT NULL,
  vehicle_type  text        NOT NULL CHECK (vehicle_type IN ('CAR', 'MOTORCYCLE')),
  capacity      integer     NOT NULL CHECK (capacity > 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Cada entrada de parking:stream (eventos de sensor, derivados y del sistema).
-- stream_id (ID de Redis) es la clave: reinsertar el mismo evento no lo duplica.
CREATE TABLE IF NOT EXISTS parking_events (
  stream_id     text        PRIMARY KEY,
  event_id      text        NOT NULL,
  event_type    text        NOT NULL,
  entity_id     text        NOT NULL,
  occurred_at   timestamptz NOT NULL,
  vehicle_type  text,
  occupied      integer     CHECK (occupied >= 0),
  capacity      integer     CHECK (capacity > 0),
  occupancy     numeric(5,2) CHECK (occupancy BETWEEN 0 AND 100),
  status        text,
  source        text        NOT NULL,
  payload       jsonb       NOT NULL,
  archived_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parking_events_occupied_le_capacity CHECK (occupied IS NULL OR capacity IS NULL OR occupied <= capacity)
);
CREATE INDEX IF NOT EXISTS parking_events_entity_time_idx ON parking_events (entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS parking_events_type_time_idx   ON parking_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS parking_events_time_idx        ON parking_events (occurred_at DESC);

-- Alertas: una fila por alerta; se actualiza al resolverse (upsert por id + raised_at).
-- El id (alert_000001…) proviene de un contador de Redis que se reinicia si Redis se vacía,
-- por eso la clave incluye raised_at: dos alertas con el mismo id nunca comparten instante.
CREATE TABLE IF NOT EXISTS alerts (
  id                  text        NOT NULL,
  zone_id             text        NOT NULL,
  zone_name           text,
  type                text        NOT NULL,
  severity            text        NOT NULL,
  message             text        NOT NULL,
  value               numeric,
  threshold           numeric,
  unit                text,
  status              text        NOT NULL CHECK (status IN ('ACTIVE', 'RESOLVED')),
  raised_at           timestamptz NOT NULL,
  resolved_at         timestamptz,
  resolution          text,
  resolution_message  text,
  payload             jsonb       NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, raised_at)
);
-- Migración: versiones anteriores usaban PRIMARY KEY (id).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'alerts_pkey' AND conrelid = 'alerts'::regclass AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE alerts DROP CONSTRAINT alerts_pkey;
    ALTER TABLE alerts ADD PRIMARY KEY (id, raised_at);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS alerts_raised_idx    ON alerts (raised_at DESC);
CREATE INDEX IF NOT EXISTS alerts_zone_time_idx ON alerts (zone_id, raised_at DESC);

-- Instantáneas periódicas del estado actual (Hashes parking:zone:*).
CREATE TABLE IF NOT EXISTS zone_snapshots (
  id                  bigserial   PRIMARY KEY,
  zone_id             text        NOT NULL REFERENCES zones (id) ON DELETE CASCADE,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  occupied            integer     NOT NULL CHECK (occupied >= 0),
  capacity            integer     NOT NULL CHECK (capacity > 0),
  available           integer     NOT NULL CHECK (available >= 0),
  occupancy           numeric(5,2) NOT NULL,
  status              text        NOT NULL,
  trend               text,
  entries_per_minute  integer,
  exits_per_minute    integer,
  simulated_time      text
);
CREATE INDEX IF NOT EXISTS zone_snapshots_zone_time_idx ON zone_snapshots (zone_id, captured_at DESC);

-- Reporte diario por zona (sección 112: "reportes diarios / analítica institucional").
CREATE OR REPLACE VIEW daily_zone_summary AS
WITH ev AS (
  SELECT (occurred_at AT TIME ZONE 'America/Bogota')::date AS day,
         entity_id AS zone_id,
         count(*) FILTER (WHERE event_type = 'VEHICLE_ENTERED') AS entries,
         count(*) FILTER (WHERE event_type = 'VEHICLE_EXITED')  AS exits,
         max(occupancy) AS peak_occupancy,
         round(avg(occupancy) FILTER (WHERE event_type IN ('VEHICLE_ENTERED', 'VEHICLE_EXITED')), 2) AS avg_occupancy,
         count(*) FILTER (WHERE event_type = 'PARKING_FULL') AS times_full
    FROM parking_events
   GROUP BY 1, 2
), al AS (
  SELECT (raised_at AT TIME ZONE 'America/Bogota')::date AS day, zone_id, count(*) AS alerts
    FROM alerts
   GROUP BY 1, 2
)
SELECT ev.day, z.id AS zone_id, z.name AS zone_name, z.vehicle_type,
       ev.entries, ev.exits, ev.peak_occupancy, ev.avg_occupancy, ev.times_full,
       coalesce(al.alerts, 0) AS alerts
  FROM ev
  JOIN zones z ON z.id = ev.zone_id
  LEFT JOIN al ON al.day = ev.day AND al.zone_id = ev.zone_id;
