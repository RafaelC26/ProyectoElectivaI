# Presentación y demostración en vivo

La demostración es **práctica**: las diapositivas sólo acompañan. Duración sugerida: 12–15 minutos.

## 1. Preparación (antes de entrar)

```bash
cp .env.example .env
```

Cambiar en `.env`: `SIMULATION_INTERVAL_MS=2000` (más actividad visible).

```bash
docker compose --profile insight up --build -d
```

Tener abiertas:

1. Dashboard — <http://localhost:5173>
2. Panel de simulación — <http://localhost:5173/simulator>
3. Redis y BD — <http://localhost:5173/debug> (o RedisInsight en <http://localhost:5540>)
4. Terminal A: `docker compose logs -f publisher`
5. Terminal B: `docker compose logs -f processor`
6. Terminal C libre para comandos

Para empezar el día simulado desde 06:30: `/simulator` → **Reiniciar día** unos 30 s antes de iniciar.

## 2. Diapositivas (esquema)

| # | Diapositiva | Idea clave |
|---|---|---|
| 1 | Problema | Saber cuántos espacios hay y qué zona se satura, en el momento en que ocurre |
| 2 | Arquitectura | Simulador → Publisher → Redis → Processor → Backend → WebSocket → Dashboard (+ Archiver → PostgreSQL) |
| 3 | Redis | 5 mecanismos, cada uno con una responsabilidad (tabla de `docs/redis-design.md`) |
| 4 | Pub/Sub vs Streams | Inmediatez vs durabilidad; por qué se usan juntos |
| 5 | Estado vs histórico | `HGETALL parking:zone:MOTOS-02` vs `XRANGE parking:stream` |
| 6 | Simulador | `occupied(t+1) = occupied(t) + entradas − salidas`; perfiles; escenarios |
| 7 | Procesamiento y métricas | 11 métricas, ventanas 1/5/15 min, ranking, tendencia |
| 8 | Alertas | Máquina de estados, histéresis, cooldown con TTL, recuperación |
| 9 | Dashboard | KPIs, plano, gráficas, actividad, alertas |
| 10 | Demostración | (en vivo) |
| 11 | Resultados | 13 ms de latencia E2E, 4–6 ms por evento, 72 pruebas |
| 12 | Conclusiones y limitaciones | Redis como núcleo; PostgreSQL como memoria de largo plazo |

## 3. Guion de la demostración

| Paso | Qué hacer | Qué mostrar / decir |
|---|---|---|
| 1. Problema (30 s) | — | "Monitoreamos la ocupación de parqueaderos de carros y motos." |
| 2. Arquitectura | Dashboard → panel **Recorrido de un evento** | Las 6 etapas con contadores en vivo |
| 3. Redis | `/system` o RedisInsight | Redis ONLINE, versión, memoria, claves |
| 4. Publisher | Terminal A | `Simulator started` y líneas `VEHICLE_ENTERED CARS-A published … receivers=1` |
| 5. Pub/Sub | Terminal C: `./scripts/redis-cli.sh SUBSCRIBE parking-events` | Los JSON llegan en vivo (Ctrl+C para salir) |
| 6. Stream | `/debug` → **Histórico reciente (Stream)** | `XREVRANGE parking:stream + - COUNT 8` |
| 7. Hash | `/debug` → **Estado actual (Hash)** | `HGETALL parking:zone:CARS-A` |
| 8. Dashboard | Dashboard | **● LIVE**, "Redis Connected", hora simulada |
| 9. Generar entrada | `/simulator` → Zona A → **Forzar VEHICLE_ENTERED** (o desde el detalle de la zona) | La tarjeta suma +1, destella, cambia el KPI y aparece la fila en Actividad. **Sin F5.** |
| 10. Gráfica | Dashboard → *Evolución de ocupación* → *Zona específica: Zona A* | El nuevo valor entra en la serie |
| 11. WARNING / CRITICAL | `/simulator` → Zona C → **Cerca de lleno** | `OCCUPANCY_WARNING`, luego `OCCUPANCY_CRITICAL`; alerta en el panel |
| 12. FULL | **Llenar zona** | `PARKING_FULL`, tarjeta en rojo con 0 disponibles; alerta CRITICAL |
| 13. Recuperación | **Recuperación** | Salidas progresivas → `ZONE_RECOVERED`; la alerta pasa a *Resueltas* |
| 14. Estado actual | Terminal C: `./scripts/redis-cli.sh HGETALL parking:zone:CARS-C` | Valores actuales |
| 15. Histórico | Terminal C: `./scripts/redis-cli.sh XREVRANGE parking:stream + - COUNT 5` | Eventos anteriores, incluidos los derivados |
| 16. Diferencia | — | **Hash = estado actual · Stream = histórico reciente** |

### Demostraciones adicionales

**Subscriber desconectado (sección 132):**

```bash
docker compose stop processor
```

El Publisher muestra `receivers=0` y *"Pub/Sub does not retain messages; it remains in parking:stream"*.
El dashboard deja de cambiar. Esperar 15 s y:

```bash
docker compose start processor
```

Terminal B: *"Recovered N events missed while offline from parking:stream"*; el dashboard se
resincroniza solo.

**Reconexión de Redis (sección 133):**

```bash
docker compose stop redis
```

El encabezado muestra "Redis reconectando"; los logs muestran reintentos a 1 s, 2 s y 5 s; `/system`
marca RECONNECTING. Luego:

```bash
docker compose start redis
```

Todo vuelve a ONLINE y el estado se conserva (RDB).

**TTL en vivo:** `/debug` → tabla de claves: los `parking:heartbeat:*` y `parking:alert:cooldown:*`
disminuyen su TTL cada 2 s. `docker compose stop archiver` → a los 10 s su heartbeat expira y
`/system` lo marca OFFLINE; el lag del consumer group crece; al iniciarlo se pone al día.

**Ranking:**

```bash
./scripts/redis-cli.sh ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES
```

**PostgreSQL:** `/debug` → reporte `daily_zone_summary` y últimas alertas archivadas, o:

```bash
psql -h localhost -U proyecto_electiva_1 -d uptc_smart_parking -c "SELECT * FROM daily_zone_summary"
```

## 4. Preguntas de sustentación

**¿Por qué utilizar Redis?**
Porque necesitamos procesar información dinámica con baja latencia. Redis almacena los datos en
memoria y además ofrece Pub/Sub, Streams, Hashes y Sorted Sets, que encajan directamente con una
arquitectura orientada a eventos. En el sistema procesar un evento toma 4–6 ms y el recorrido completo
hasta el navegador ≈ 13 ms.

**¿Qué información se mantiene en memoria?**
Estado actual de las zonas (Hashes), métricas agregadas, alertas activas, histórico reciente
(Streams), ranking de ocupación (Sorted Set), ventanas de entradas/salidas e información temporal con
TTL (heartbeats, cooldowns).

**¿Qué representa el estado actual?**
La medición más reciente conocida de una zona: capacidad, ocupados, disponibles, porcentaje, estado,
tendencia y última actualización (`HGETALL parking:zone:<id>`).

**¿Qué representa el histórico?**
La secuencia reciente de entradas, salidas, cambios de estado y alertas que permite analizar cómo
evolucionó el estacionamiento y construir las gráficas (`parking:stream`, `parking:timeseries`).

**¿Por qué utilizar Hashes?**
Porque una zona tiene muchos atributos relacionados; el Hash permite leerlos juntos con un comando y
modificar sólo los que cambian.

**¿Por qué utilizar Streams?**
Para conservar un histórico reciente y poder consultarlo después de publicado: recuperar eventos
perdidos, dibujar gráficas y archivar en PostgreSQL con consumer groups.

**¿Cuál es la función del Publisher?**
Obtener las lecturas del simulador, normalizarlas, validarlas con Zod y publicarlas en Redis
(`XADD` + `PUBLISH`).

**¿Cuál es la función del Subscriber?**
Escuchar los eventos de `parking-events` y entregarlos, en orden, al Processor; al reconectarse,
recuperar desde el Stream lo que se perdió.

**¿Qué información viaja por Pub/Sub?**
Entradas y salidas (JSON del modelo común), estados procesados y métricas, alertas, eventos de la
simulación y órdenes del panel.

**¿Qué sucede si el Subscriber se desconecta?**
Los mensajes Pub/Sub publicados durante la desconexión no llegan a ese Subscriber. Por eso cada
evento también se guarda en `parking:stream`: al volver, el Subscriber lee desde su último
checkpoint y recupera lo perdido (se demuestra en vivo).

**¿Qué sucede si Redis se reinicia?**
Depende de la persistencia. Usamos instantáneas RDB en un volumen, así que el estado se recupera.
Además los sensores envían conteos absolutos: aunque Redis empezara vacío, el primer evento de cada
zona recalibra su estado. En producción se podría activar AOF.

**¿Cómo controlan el crecimiento de los datos?**
Streams con `MAXLEN ~`, ventanas recortadas a 15 min con `EXPIRE`, TTL para la información temporal,
eliminación de alertas resueltas del Hash de activas, límite de memoria con `volatile-lru` y
retención en PostgreSQL.

**¿Cómo generan los eventos?**
Con un simulador que conserva el estado anterior de cada zona y genera entradas o salidas según
perfiles de demanda por hora (Poisson + pesos de entrada/salida), respetando la capacidad. No son
números aleatorios independientes.

**¿Qué métricas calculan?**
Ocupación por zona, global, de carros y de motos; espacios disponibles; entradas y salidas por minuto
(y en 5 y 15 min); variación; tendencia; zona más ocupada; zonas críticas; promedios por ventana.

**¿Cómo generan alertas?**
El Processor compara las métricas con umbrales configurables mediante una máquina de estados: ≥ 80 %
advertencia, ≥ 90 % crítica, 100 % `PARKING_FULL`, ≤ 5 espacios disponibilidad baja, +20 pp en 6 s
crecimiento inusual. Aplica histéresis y cooldown para no repetir alertas y genera `ZONE_RECOVERED`.

**¿Qué parte funciona en tiempo real?**
Todo el recorrido: el Publisher publica en Redis, el Subscriber recibe el evento, el Processor
actualiza el estado y el backend lo transmite por WebSocket al dashboard, que cambia sin recargar.

**¿Qué ventajas tiene una base en memoria?**
Baja latencia, alta velocidad de lectura y escritura, estructuras optimizadas y mecanismos de
eventos integrados.

**¿Qué limitaciones tiene Redis?**
Dependencia de la memoria RAM, histórico permanente limitado, persistencia distinta a la de una base
relacional y Pub/Sub no conserva mensajes.

**¿Qué pasa si aumentan los sensores?**
Se distribuye la generación entre varios Publishers y el procesamiento entre varios consumidores
(consumer groups particionados por zona).

**¿Cómo soportar múltiples Publishers?**
Cada Publisher representa una zona, un parqueadero o un grupo de sensores; todos publican en los
mismos canales y Stream; los IDs salen de un contador atómico de Redis.

**¿Qué componentes pueden escalar horizontalmente?**
Publishers, Processors, Backends y Subscribers. Redis puede escalar con réplicas, Sentinel o Cluster.

**¿Por qué además PostgreSQL?**
Redis guarda el presente y el pasado reciente; PostgreSQL guarda lo que debe durar (reportes diarios,
auditoría de alertas). El archiver lo alimenta con un consumer group, sin afectar el tiempo real.

## 5. Checklist de requisitos mínimos (sección 174)

- [x] Redis funciona
- [x] Publisher funciona
- [x] Subscriber funciona
- [x] Processor funciona
- [x] Pub/Sub funciona
- [x] Se utilizan al menos dos estructuras Redis (se usan cinco mecanismos)
- [x] Se generan datos continuamente
- [x] Existe procesamiento
- [x] Existen mínimo dos métricas derivadas (11 + ventanas)
- [x] Existe mínimo una alerta (7 tipos)
- [x] Dashboard funciona
- [x] Dashboard actualiza sin refresh
- [x] Existen mínimo dos gráficas (tres)
- [x] Se muestra estado actual
- [x] Se muestra histórico reciente
- [x] Existe simulador
- [x] Arquitectura documentada

## 6. Checklist de la implementación avanzada (sección 175)

- [x] Redis Streams
- [x] Hashes
- [x] Sorted Sets
- [x] TTL
- [x] Múltiples canales Pub/Sub (cinco)
- [x] Ventanas temporales (1, 5 y 15 min)
- [x] Ranking de zonas
- [x] Detección de crecimiento inusual
- [x] Docker
- [x] Reconexión automática
- [x] Logging estructurado
- [x] Métricas internas (eventos/s, tiempo de procesamiento, lag del archiver)
- [x] Latencia end-to-end
- [x] Simulador controlable
- [x] Recuperación de alertas
- [x] Extra: histórico permanente en PostgreSQL con consumer group
- [x] Extra: recuperación automática del Processor desde el Stream

## 7. Preparación del equipo

Cada integrante debe poder explicar, sin leer: la arquitectura, Pub/Sub, Streams, Hashes, estado vs
histórico, la simulación, las métricas, las alertas y las limitaciones. Ensayar el guion completo al
menos una vez con cronómetro.
