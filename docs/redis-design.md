# Diseño Redis

Redis no se usa como una tabla temporal con `SET`/`GET`: resuelve **comunicación de eventos, estado
actual, histórico reciente, métricas, rankings e información temporal**. Las claves siguen la
convención `parking:<categoría>:<identificador>` y todas se definen en
`packages/shared/src/constants/redis-keys.ts`.

## 1. Mapa de estructuras

| Estructura | Clave / canal | Escribe | Lee | TTL / límite |
|---|---|---|---|---|
| Pub/Sub | `parking-events` | Publisher | Processor | — |
| Pub/Sub | `parking-updates` | Processor | Backend | — |
| Pub/Sub | `parking-alerts` | Processor | Backend | — |
| Pub/Sub | `system-events` | Publisher | Backend | — |
| Pub/Sub | `simulator-commands` | Backend | Publisher | — |
| Stream | `parking:stream` | Publisher (eventos de sensor y sistema), Processor (derivados) | Processor (recuperación), Backend, Archiver | `MAXLEN ~ 10000` |
| Stream | `parking:timeseries` | Processor (muestra cada 2 s) | Processor, Backend (gráficas) | `MAXLEN ~ 5000` (≈ 2,7 h) |
| Stream | `parking:alerts:stream` | Processor | Backend, Archiver | `MAXLEN ~ 2000` |
| Consumer group | `archiver` sobre `parking:stream` y `parking:alerts:stream` | — | Archiver | PEL + `XACK` |
| Hash | `parking:zone:<id>` | Processor | Backend, Publisher (restaurar), Archiver (instantáneas) | — |
| Hash | `parking:metrics:global` · `:cars` · `:motorcycles` | Processor | Backend | — |
| Hash | `parking:alerts:active` (campo `<zona>:<tipo>`) | Processor | Backend | se borra el campo al resolver |
| Hash | `parking:alert:state:<zona>` | Processor | Processor | — |
| Hash | `parking:stats:entries` · `:exits` · `:system` | Processor, Publisher | Backend | — |
| Hash | `parking:simulator:state` | Publisher | Backend, Publisher | — |
| Sorted Set | `parking:ranking:occupancy` | Processor | Processor, Backend | 1 miembro por zona |
| Sorted Set | `parking:window:entries:<id>` · `parking:window:exits:<id>` | Processor | Processor | recorte a 15 min + `EXPIRE 960` |
| String + TTL | `parking:heartbeat:<servicio>` | cada servicio | Backend | `EX 10`, renovado cada ~3 s |
| String + TTL | `parking:alert:cooldown:<zona>:<clave>` | Processor | Processor | `EX 30` |
| String + TTL | `parking:temporary:metric:{events_per_second,avg_processing_ms}` | Processor | Backend | `EX 10` |
| String | `parking:seq:event` · `parking:seq:alert` | Publisher/Processor | — | contadores `INCR` |
| String | `parking:processor:checkpoint` | Processor | Processor | último `stream_id` procesado |

## 2. Pub/Sub — comunicación inmediata

```text
PUBLISH parking-events '{"event_id":"evt_000123","event_type":"VEHICLE_ENTERED","entity_id":"MOTOS-02",…}'
SUBSCRIBE parking-events
```

- El Publisher registra cuántos suscriptores recibieron cada mensaje (`receivers`). Si el Processor
  está caído aparece `receivers=0` y un aviso: **Pub/Sub no conserva mensajes**.
- Los canales son **globales a la instancia de Redis** (no dependen del número de base de datos);
  por eso las pruebas de integración usan un Redis aparte.
- `PUBSUB NUMSUB parking-events` (panel `/debug`) muestra quién escucha cada canal.

## 3. Streams — histórico reciente

```text
XADD parking:stream MAXLEN ~ 10000 * event_id evt_000123 event_type VEHICLE_ENTERED entity_id MOTOS-02 \
     timestamp 2026-09-22T14:30:00Z source SIMULATOR occupied 73 capacity 80 occupancy 91.25 payload {…}
XRANGE parking:stream - +
XREVRANGE parking:stream + - COUNT 10
```

Cada entrada guarda campos planos (legibles en RedisInsight) y el JSON completo en `payload`.
El ID del Stream (`<epoch ms>-<seq>`) viaja luego en el mensaje Pub/Sub como `metadata.stream_id`.

### Pub/Sub vs Streams

| | Pub/Sub | Streams |
|---|---|---|
| Objetivo | Comunicación inmediata | Registro que permanece |
| Suscriptor desconectado | Pierde los mensajes | Los lee al volver (`XRANGE` / `XREADGROUP`) |
| Lectura histórica | No | Sí, por rango de IDs o de tiempo |
| Varios consumidores con reparto | No | Consumer groups con confirmación (`XACK`) |
| En este proyecto | Aviso en vivo al Processor y al Backend | Histórico, recuperación del Processor, gráficas, archivo en PostgreSQL |

### Recuperación del Processor

1. Tras procesar cada evento guarda `SET parking:processor:checkpoint <stream_id>`.
2. Al iniciar (o reconectar) ejecuta `XRANGE parking:stream (<checkpoint> + COUNT 250` en bloques y
   procesa los eventos de sensor que faltan.
3. Los mensajes que además llegan por Pub/Sub se descartan si su `stream_id` ya fue procesado
   (idempotencia por ID).
4. Publica `RESYNC` y los dashboards recargan su estado.

### Consumer group del archiver

```text
XGROUP CREATE parking:stream archiver 0 MKSTREAM
XREADGROUP GROUP archiver archiver-1 COUNT 200 BLOCK 5000 STREAMS parking:stream parking:alerts:stream > >
XACK parking:stream archiver <id> …
XINFO GROUPS parking:stream          # pending y lag (se muestran en /system)
```

Las entradas entregadas pero no confirmadas (PEL) se reintentan al reiniciar (`… STREAMS … 0 0`).

### Serie temporal

```text
XADD parking:timeseries MAXLEN ~ 5000 * ts 1790118679708 simulated_time 07:44 global 62.14 cars 61.67 \
     motorcycles 62.5 entries_1m 44 exits_1m 17 … zone:CARS-A 78.33 zone:CARS-B 71.43 …
XRANGE parking:timeseries <epoch ms hace 15 min> +
```

Los IDs de Stream son marcas de tiempo, así que un rango temporal es simplemente un rango de IDs.

## 4. Hashes — estado actual

```text
HSET parking:zone:MOTOS-02 zone_id MOTOS-02 zone_name "Zona M2" vehicle_type MOTORCYCLE \
     capacity 80 occupied 73 available 7 occupancy 91.25 status CRITICAL previous_status WARNING \
     trend RISING trend_delta 6.25 entries_per_minute 18 exits_per_minute 4 total_entries 412 \
     total_exits 339 last_event VEHICLE_ENTERED last_event_id evt_000123 last_update 2026-09-22T14:30:00Z
HGETALL parking:zone:MOTOS-02
```

Una zona tiene muchos atributos relacionados que se leen y actualizan juntos: el Hash permite
`HGETALL` para el estado completo y `HSET` parcial (el muestreador sólo actualiza ventanas y
tendencia). Las métricas agregadas (`parking:metrics:*`) siguen el mismo patrón.

## 5. Sorted Sets — ranking y ventanas

```text
ZADD parking:ranking:occupancy 91.25 MOTOS-02
ZREVRANGE parking:ranking:occupancy 0 0 WITHSCORES        # zona más ocupada
ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES       # ranking completo
```

Ventanas deslizantes (métricas 6 y 7, ventanas de 1, 5 y 15 min):

```text
ZADD   parking:window:entries:MOTOS-02 1790118679708 evt_000123
ZREMRANGEBYSCORE parking:window:entries:MOTOS-02 -inf (<now − 15 min>
ZCOUNT parking:window:entries:MOTOS-02 (<now − 60 s> +inf
EXPIRE parking:window:entries:MOTOS-02 960
```

El score es el instante del evento, así que contar eventos en una ventana es un `ZCOUNT` por rango
de scores.

## 6. TTL — información temporal

| Clave | TTL | Qué demuestra |
|---|---|---|
| `parking:heartbeat:<servicio>` | 10 s | Un servicio está ONLINE mientras la clave exista; si muere, expira sola |
| `parking:alert:cooldown:<zona>:OCCUPANCY` | 30 s | Evita alertas repetidas tras una recuperación |
| `parking:temporary:metric:*` | 10 s | Métricas instantáneas que caducan si el Processor deja de actualizarlas |
| `parking:window:*` | 960 s | Las ventanas de zonas inactivas desaparecen |

```text
TTL parking:heartbeat:processor
EXPIRE parking:alert:cooldown:MOTOS-02:OCCUPANCY 30
```

En el panel `/debug` los TTL se ven disminuir cada 2 s.

## 7. Control del crecimiento

- Streams con `MAXLEN ~` (recorte aproximado, eficiente): 10 000 eventos, 5 000 muestras, 2 000 alertas.
- Ventanas: `ZREMRANGEBYSCORE` a 15 min + `EXPIRE`.
- Alertas resueltas: se eliminan de `parking:alerts:active` (`HDEL`); su historial queda en el Stream limitado.
- Datos temporales con TTL.
- `maxmemory 256mb` con `maxmemory-policy volatile-lru`: ante presión de memoria sólo se desalojan
  claves con TTL, nunca el estado actual.
- El histórico de largo plazo se traslada a PostgreSQL (con su propia retención configurable).

Ocupación observada: ≈ 9 MB de memoria con el Stream en su límite de 10 000 eventos y 45 claves (muy lejos del límite de 256 MB).

## 8. Persistencia (`docker/redis.conf`)

```text
save 300 100
save 60 10000
appendonly no
```

Instantáneas RDB en el volumen `redis-data`: tras `docker compose restart redis` el estado actual,
los Streams y el ranking se recuperan. En producción podría activarse AOF (`appendonly yes`,
`appendfsync everysec`) para perder como máximo ~1 s de datos. Aun sin persistencia, el sistema se
reconstruye: los sensores informan conteos absolutos, de modo que el primer evento de cada zona
recalibra su estado.

## 9. Operaciones por evento

Por cada `VEHICLE_ENTERED` / `VEHICLE_EXITED` el Processor hace ≈ 6 viajes a Redis agrupando
comandos en *pipelines*: lectura del estado, ventana (ZADD + 6 ZCOUNT + ZREMRANGEBYSCORE + EXPIRE),
alertas (HGET + HMGET + 3 EXISTS), escritura (HSET + ZADD + XADD + HINCRBY + SET), métricas
(6 HGETALL + ZREVRANGE) y publicación. Tiempo medio medido: 4–6 ms por evento.
