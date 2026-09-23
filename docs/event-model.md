# Modelo de eventos

Todos los eventos se transmiten en JSON y se validan con Zod (`packages/shared/src/schemas`).
El mismo esquema lo usan el Publisher (antes de publicar), el Subscriber (antes de procesar), el
backend y el dashboard (tipos TypeScript inferidos del esquema).

## 1. Esquema común

```json
{
  "event_id": "evt_000123",
  "event_type": "VEHICLE_ENTERED",
  "entity_id": "MOTOS-02",
  "timestamp": "2026-09-22T19:30:00.214Z",
  "location": { "latitude": null, "longitude": null },
  "data": {
    "vehicle_type": "MOTORCYCLE",
    "zone_name": "Zona M2",
    "capacity": 80,
    "occupied": 73,
    "available": 7,
    "occupancy": 91.25,
    "entries_per_minute": 3,
    "exits_per_minute": 1
  },
  "metadata": {
    "source": "SIMULATOR",
    "schema_version": "1.0",
    "generated_at": 1790118679708,
    "simulated_time": "14:30",
    "sensor_id": "SNS-MOTOS-02-IN",
    "scenario": "NORMAL",
    "stream_id": "1790118679710-0"
  }
}
```

| Campo | Regla |
|---|---|
| `event_id` | `evt_` + 6 o más dígitos; contador atómico `INCR parking:seq:event` |
| `timestamp` | ISO‑8601 (instante de detección) |
| `location` | Siempre `null`: no se inventan coordenadas de la universidad |
| `data.occupied` | entero, `0 ≤ occupied ≤ capacity` |
| `data.available` | `capacity − occupied` (se valida la igualdad) |
| `data.occupancy` | `occupied / capacity × 100`, 2 decimales (se valida con tolerancia 0,01) |
| `metadata.generated_at` | epoch ms en el Publisher: base de la latencia end‑to‑end |
| `metadata.stream_id` | ID de la entrada en `parking:stream` (lo añade el Publisher tras `XADD`) |
| `metadata.processed_at` | epoch ms al terminar el Processor |
| `metadata.manual` | `true` si se forzó desde el panel de simulación |
| `metadata.caused_by` | En eventos derivados: el `event_id` del evento de sensor que los provocó |
| `metadata.replayed` | `true` si se procesó durante la recuperación desde el Stream |

## 2. Tipos de evento

| Tipo | Origen | Canal | Cuándo |
|---|---|---|---|
| `VEHICLE_ENTERED` | Sensor (Publisher) | `parking-events` | Un vehículo entra (`occupied + 1`) |
| `VEHICLE_EXITED` | Sensor (Publisher) | `parking-events` | Un vehículo sale (`occupied − 1`) |
| `ZONE_STATUS_CHANGED` | Processor | `parking-updates` | Cambia la categoría LOW/NORMAL/WARNING/CRITICAL/FULL |
| `PARKING_FULL` | Processor | `parking-updates` | `occupied === capacity` |
| `PARKING_AVAILABLE` | Processor | `parking-updates` | Una zona llena vuelve a tener espacio (80/80 → 79/80) |
| `OCCUPANCY_WARNING` | Processor | `parking-updates` | Se levanta la alerta de advertencia (≥ 80 %) |
| `OCCUPANCY_CRITICAL` | Processor | `parking-updates` | Se levanta la alerta crítica (≥ 90 %) |
| `ZONE_RECOVERED` | Processor | `parking-updates` | La alerta de ocupación se resuelve (vuelve bajo el umbral − histéresis) |
| `SIMULATION_STARTED` | Publisher | `system-events` | Inicio, reanudación o reinicio de la simulación |
| `SIMULATION_STOPPED` | Publisher | `system-events` | Pausa o apagado del Publisher |
| `SCENARIO_CHANGED` | Publisher | `system-events` | Cambio de escenario (manual o automático al terminar una ráfaga/recuperación) |

`OCCUPANCY_WARNING`/`OCCUPANCY_CRITICAL` se derivan de la **máquina de alertas** (con histéresis) y no
del estado crudo: así una zona que oscila entre 79 % y 80 % no llena el registro de advertencias.
`ZONE_STATUS_CHANGED` sí sigue exactamente los umbrales.

## 3. Estados de una zona (`config/thresholds.json`)

| Estado | Rango |
|---|---|
| `LOW` | 0 % – 59,99 % |
| `NORMAL` | 60 % – 79,99 % |
| `WARNING` | 80 % – 89,99 % |
| `CRITICAL` | 90 % – 99,99 % |
| `FULL` | 100 % |

## 4. Captura y normalización

El sensor virtual entrega una lectura en su propio formato:

```json
{ "sensorId": "sns-motos-02-in", "zoneId": "motos-02", "direction": "IN", "count": 73,
  "capacity": 80, "detectedAt": 1790118679708, "simClock": "14:30",
  "window": { "in": 3, "out": 1 }, "scenario": "NORMAL", "manual": false }
```

`EventNormalizer` la convierte al modelo común: identifica la zona en el catálogo (la capacidad sale
de `config/zones.json`, no del sensor), traduce `IN/OUT` a `VEHICLE_ENTERED/VEHICLE_EXITED`, pasa el
epoch a ISO‑8601, calcula `available` y `occupancy` y construye `metadata`. Después
`validateSensorEvent` aplica el esquema; un evento inválido se registra (`events_rejected`) y **no se
publica**.

## 5. Estado procesado de una zona

El Processor mantiene en `parking:zone:<id>` todas las variables de la sección 10 más las derivadas:

| Campo | Descripción |
|---|---|
| `occupancy`, `available`, `status` | Métricas 1 y 2 |
| `previous_occupancy`, `occupancy_delta` | Métrica 10: variación respecto al evento anterior |
| `entries_per_minute`, `exits_per_minute` | Métricas 6 y 7 (ventana deslizante de 60 s) |
| `entries_5m`, `exits_5m`, `entries_15m`, `exits_15m` | Ventanas de 5 y 15 min |
| `trend`, `trend_delta` | Métrica 11: `RISING/FALLING/STABLE` comparando con la ocupación de hace 30 s (umbral 3 pp) |
| `avg_occupancy_5m`, `variation_5m` | Promedio y variación en los últimos 5 min |
| `total_entries`, `total_exits` | Acumulados |
| `last_event`, `last_event_id`, `timestamp`, `last_update`, `simulated_time` | Trazabilidad |

## 6. Alertas

```json
{
  "id": "alert_000082",
  "zone_id": "MOTOS-02",
  "zone_name": "Zona M2",
  "type": "HIGH_OCCUPANCY",
  "severity": "CRITICAL",
  "message": "La Zona M2 alcanzó 91.25% de ocupación.",
  "value": 91.25,
  "threshold": 90,
  "unit": "%",
  "status": "ACTIVE",
  "timestamp": "2026-09-22T19:30:00.214Z"
}
```

Al resolverse se agregan `status: "RESOLVED"`, `resolved_at`, `resolution`
(`RECOVERED | ESCALATED | DEESCALATED | CONDITION_CLEARED`) y `resolution_message`.

| Tipo | Condición | Severidad | Resolución |
|---|---|---|---|
| `OCCUPANCY_WARNING` | ocupación ≥ 80 % | WARNING | escala a crítica o baja de 78 % |
| `HIGH_OCCUPANCY` | ocupación ≥ 90 % | CRITICAL | escala a llena o baja de 88 % |
| `PARKING_FULL` | `occupied === capacity` | CRITICAL | baja de 98 % |
| `LOW_AVAILABILITY` | `available ≤ 5` | WARNING | `available > 7`, o se reemplaza por `PARKING_FULL` |
| `UNUSUAL_OCCUPANCY_INCREASE` | +20 pp en 6 s | WARNING | incremento < 10 pp |
| `CAR_PARKING_FULL` / `MOTORCYCLE_PARKING_FULL` | todas las zonas del tipo en FULL | CRITICAL | alguna zona libera espacio |

Canal `parking-alerts`: `{ "action": "RAISED" | "RESOLVED", "alert": { … } }`.

## 7. Mensajes procesados (`parking-updates`)

```ts
type ProcessedMessage =
  | { type: 'ZONE_UPDATE'; event; zone; derived_events; metrics; alerts; processed_at }
  | { type: 'METRICS_SAMPLE'; sample; metrics }      // cada 2 s
  | { type: 'RESYNC'; reason; recovered_events; zones; metrics };
```

## 8. Órdenes del simulador (`simulator-commands`)

```json
{ "command_id": "37a7ad3f-…", "issued_at": 1790118679708,
  "command": { "action": "SET_SCENARIO", "scenario": "FULL", "zone_id": "CARS-C" } }
```

Acciones: `SET_SCENARIO` (zona o `ALL`), `SET_SPEED` (1/2/5), `SET_MODE`, `PAUSE`, `RESUME`, `RESET`,
`FORCE_ENTRY`, `FORCE_EXIT` (`count` 1–50).

## 9. Socket.IO

| Evento | Payload |
|---|---|
| `parking:event` | `{ event, emitted_at }` — sensor, derivados y sistema |
| `parking:update` | `{ zone, event_id, generated_at, processed_at, emitted_at }` |
| `parking:metrics` | `{ kind: 'snapshot' \| 'sample', metrics, sample?, emitted_at }` |
| `parking:alert` | `{ action: 'RAISED', alert, emitted_at }` |
| `parking:recovery` | `{ action: 'RESOLVED', alert, emitted_at }` |
| `parking:resync` | `{ reason, recovered_events, emitted_at }` |
| `system:status` | estado de servicios, Redis, Streams, PostgreSQL (cada 2 s) |
| `simulator:state` | estado del simulador (cuando cambia) |

Latencia: `received_at` (navegador) − `metadata.generated_at` (Publisher).
