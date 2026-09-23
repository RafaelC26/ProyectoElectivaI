# UPTC Smart Parking

**Sistema distribuido de monitoreo de estacionamientos en tiempo real con Redis**
UPTC Seccional Sogamoso · Tendencias Modernas de Bases de Datos · Grupo 4

![Dashboard en tiempo real](docs/img/dashboard.png)

Sensores simulados registran las entradas y salidas de carros y motocicletas en seis zonas de
parqueo (420 cupos). Cada evento recorre **Simulador → Publisher → Redis → Processor → Backend →
Dashboard** en unos 10 milisegundos, y el tablero cambia sin recargar la página. **Redis es el núcleo**
(Pub/Sub, Streams, Hashes, Sorted Sets y TTL) y **PostgreSQL** conserva el histórico permanente.

> Las zonas, capacidades y parámetros de demanda son **valores de demostración**; no representan los
> parqueaderos físicos reales de la universidad.

**Documento completo del proyecto (para entregar y estudiar):**
[`Documento_Proyecto_UPTC_Smart_Parking.pdf`](Documento_Proyecto_UPTC_Smart_Parking.pdf) (también en `.docx`).

---

## Contenido

- [Parte 1. Cómo ejecutarlo](#parte-1-cómo-ejecutarlo)
  - [Requisitos](#requisitos)
  - [Paso 1: clonar el repositorio](#paso-1-clonar-el-repositorio)
  - [Paso 2: crear el archivo .env](#paso-2-crear-el-archivo-env)
  - [Paso 3: elegir dónde corre PostgreSQL](#paso-3-elegir-dónde-corre-postgresql)
  - [Paso 4: levantar el sistema](#paso-4-levantar-el-sistema)
  - [Paso 5: comprobar que todo funciona](#paso-5-comprobar-que-todo-funciona)
  - [Ajustes para el día de la exposición](#ajustes-para-el-día-de-la-exposición)
  - [Comandos del día a día](#comandos-del-día-a-día)
  - [Modo desarrollo y pruebas](#modo-desarrollo-y-pruebas)
  - [Solución de problemas](#solución-de-problemas)
- [Parte 2. Guion de exposición: qué es y cómo funciona](#parte-2-guion-de-exposición-qué-es-y-cómo-funciona)
  - [Preparación antes de empezar](#preparación-antes-de-empezar)
  - [Bloque 1. El problema, la arquitectura y el recorrido de un evento](#bloque-1-el-problema-la-arquitectura-y-el-recorrido-de-un-evento)
  - [Bloque 2. El simulador y el Publisher](#bloque-2-el-simulador-y-el-publisher)
  - [Bloque 3. Redis por dentro, procesamiento y alertas](#bloque-3-redis-por-dentro-procesamiento-y-alertas)
  - [Bloque 4. Dashboard, demostración en vivo y cierre](#bloque-4-dashboard-demostración-en-vivo-y-cierre)
  - [Preguntas probables del profesor](#preguntas-probables-del-profesor)
- [Parte 3. Referencia técnica](#parte-3-referencia-técnica)
- [Documentación](#documentación)

---

## Parte 1. Cómo ejecutarlo

Todo el sistema corre en **Docker**: no hace falta instalar Node.js, Redis ni PostgreSQL para
ejecutarlo. Sigan los pasos en orden; cada comando va en su propio bloque para copiarlo tal cual.

### Requisitos

| Requisito | Para qué | Cómo comprobarlo |
|---|---|---|
| **Docker Desktop** (Windows / macOS) o Docker Engine + Compose v2 (Linux), **abierto y en ejecución** | Ejecuta todos los servicios | `docker compose version` responde con la versión (v2 o superior) |
| **Git** | Descargar el repositorio | `git --version` |
| 4 GB de RAM libres y 3 GB de disco | Imágenes y contenedores | — |
| Puertos libres **5173**, **3000** y **6379** | Dashboard, backend y Redis | Ver [Solución de problemas](#solución-de-problemas) si alguno está ocupado |
| *(Opcional)* PostgreSQL 14 o superior instalado | Sólo para la opción B del paso 3 | `psql --version` |
| *(Opcional)* Node.js 22 o superior | Sólo para el modo desarrollo y las pruebas | `node --version` |

### Paso 1: clonar el repositorio

```bash
git clone https://github.com/RafaelC26/ProyectoElectivaI.git
```

```bash
cd ProyectoElectivaI
```

### Paso 2: crear el archivo .env

El sistema lee su configuración de `.env`. Se crea copiando la plantilla:

```bash
cp .env.example .env
```

> `cp` funciona en macOS, Linux, Git Bash y PowerShell. En el CMD de Windows usar
> `copy .env.example .env`.

### Paso 3: elegir dónde corre PostgreSQL

Redis funciona siempre. PostgreSQL sólo guarda el **histórico permanente** (reportes diarios, alertas
archivadas); si no está disponible el sistema sigue funcionando, pero `/system` lo mostrará OFFLINE.
Elijan **una** de estas dos opciones:

| | **Opción A: todo en Docker** (recomendada) | **Opción B: PostgreSQL instalado en el equipo** |
|---|---|---|
| Cuándo usarla | No tienen PostgreSQL instalado o quieren lo más simple | Ya tienen PostgreSQL corriendo en el puerto 5432 |
| Qué hay que hacer | Editar dos líneas de `.env` | Crear el usuario y la base de datos una sola vez |

#### Opción A: PostgreSQL en un contenedor

Abrir `.env` con cualquier editor y dejar estas dos líneas así (una ya existe vacía y la otra ya
existe con otro host; hay que **reemplazarlas**, no duplicarlas):

```dotenv
COMPOSE_PROFILES=local-db
DATABASE_URL=postgres://proyecto_electiva_1:Admin@postgres:5432/uptc_smart_parking
```

- `COMPOSE_PROFILES=local-db` hace que Docker levante también un contenedor de PostgreSQL 18.
- El host de la URL pasa de `host.docker.internal` (el equipo) a `postgres` (el contenedor).
- El contenedor crea solo el usuario `proyecto_electiva_1`, la contraseña `Admin` y la base
  `uptc_smart_parking`; las tablas las crea el servicio archiver al arrancar. No hay nada más que hacer.

#### Opción B: PostgreSQL instalado en el equipo

`.env` ya viene configurado para esta opción. Sólo hay que crear el usuario y la base de datos
**una vez**. En macOS o Linux, con `psql` disponible en la terminal:

```bash
bash scripts/setup-postgres.sh
```

En Windows (o si el script no funciona), abrir **pgAdmin → Query Tool** o `psql -U postgres` y
ejecutar:

```sql
CREATE ROLE proyecto_electiva_1 LOGIN PASSWORD 'Admin';
CREATE DATABASE uptc_smart_parking OWNER proyecto_electiva_1;
```

Las tablas (`db/schema.sql`) las crea automáticamente el archiver al iniciar.

> En Linux, además, PostgreSQL debe aceptar conexiones desde la red de Docker (`listen_addresses` y
> `pg_hba.conf`). Si no quieren configurarlo, usen la opción A.

### Paso 4: levantar el sistema

El mismo comando para las dos opciones:

```bash
docker compose up --build -d
```

- La **primera vez** puede tardar varios minutos (depende de la conexión a Internet): descarga las
  imágenes, instala las dependencias y compila el dashboard. Las siguientes veces arranca en segundos.
- `-d` deja todo corriendo en segundo plano; la terminal queda libre.

Cuando termine, abrir el dashboard: **<http://localhost:5173>**

### Paso 5: comprobar que todo funciona

**1. Todos los contenedores están arriba.**

```bash
docker compose ps
```

Deben aparecer `redis`, `publisher`, `processor`, `backend`, `archiver` y `frontend` en estado
`Up` (`redis` y `backend` con `(healthy)`). Con la opción A aparece además `postgres`.

**2. El backend responde y ve a todos los servicios.**

```bash
curl http://localhost:3000/api/health
```

La respuesta debe decir `"status":"healthy"`, `"redis":"connected"`, `"postgres":"connected"` y los
servicios en `running`. (También se puede abrir esa dirección en el navegador).

**3. El dashboard está en vivo.** En <http://localhost:5173>:

- Arriba a la derecha aparece **● LIVE** en verde y **Redis Connected**.
- La **hora simulada** avanza (un minuto real equivale a una hora simulada).
- Las tarjetas de las zonas cambian cada pocos segundos **sin recargar la página**.

**4. Todos los componentes están ONLINE.** En <http://localhost:5173/system> deben aparecer Redis,
Publisher, Processor, Backend, WebSocket, Simulador, Archiver y PostgreSQL en **ONLINE**.

**5. PostgreSQL está recibiendo datos.** En <http://localhost:5173/debug>, el panel
**PostgreSQL — histórico permanente** muestra los eventos y alertas archivados, y el número crece.

Si los cinco puntos se cumplen, el sistema está funcionando completo.

### Ajustes para el día de la exposición

1. **Más movimiento en pantalla.** En `.env`, cambiar `SIMULATION_INTERVAL_MS=5000` por
   `SIMULATION_INTERVAL_MS=2000` y aplicar el cambio:

   ```bash
   docker compose up -d
   ```

2. **RedisInsight (opcional)**, la interfaz gráfica oficial de Redis: agregar `insight` a los perfiles
   de `.env` (`COMPOSE_PROFILES=insight`, o `COMPOSE_PROFILES=local-db,insight` con la opción A), volver
   a ejecutar `docker compose up -d` y abrir <http://localhost:5540>. Si la conexión no aparece
   preconfigurada, agregar una base con host `redis` y puerto `6379`.
3. **Empezar el día desde el principio.** Unos 30 segundos antes de exponer, en
   <http://localhost:5173/simulator> presionar **Reiniciar día**: la simulación vuelve a las 06:30 y a
   las 07:00 empieza la llegada masiva de la mañana.

### Comandos del día a día

| Quiero… | Comando |
|---|---|
| Ver el estado de los contenedores | `docker compose ps` |
| Ver los logs en vivo de un servicio | `docker compose logs -f publisher` (o `processor`, `backend`, `archiver`) |
| Detener todo sin perder datos | `docker compose stop` |
| Volver a iniciar | `docker compose start` |
| Aplicar cambios de `.env` | `docker compose up -d` |
| Actualizar después de un `git pull` | `docker compose up --build -d` |
| Reiniciar un servicio | `docker compose restart publisher` |
| Usar `redis-cli` | `docker compose exec redis redis-cli` |
| Borrar todo, **incluidos los datos** de Redis y del PostgreSQL en contenedor | `docker compose down -v` |

`docker compose down -v` no toca un PostgreSQL instalado en el equipo (opción B).

### Modo desarrollo y pruebas

Sólo para modificar el código (requiere **Node.js 22 o superior**).

Instalar dependencias:

```bash
npm install
```

Correr los servicios Node fuera de Docker, con recarga automática: primero detener los contenedores de
la aplicación (Redis sigue en Docker) y luego crear `.env.local`, que apunta a `localhost`.

```bash
docker compose stop publisher processor backend archiver frontend
```

```bash
cp .env.local.example .env.local
```

```bash
npm run dev
```

El dashboard de desarrollo queda en <http://localhost:5173>. Con la opción A, cambiar en `.env.local`
el puerto de `DATABASE_URL` a `5433` (el contenedor de PostgreSQL se publica en ese puerto).

Pruebas:

```bash
npm test
```

68 pruebas unitarias: ocupación, disponibilidad, estados, límites, perfiles, escenarios,
normalización, validación, métricas y alertas (escalado, histéresis, cooldown y recuperación).

```bash
npm run test:integration
```

4 pruebas de integración contra un Redis **desechable** en el puerto 6380 (necesita Docker): Pub/Sub,
Stream con MAXLEN, Hash, Sorted Set, secuencia de alertas con TTL y recuperación tras desconexión.

```bash
npm run typecheck
```

Prueba de tiempo real desde la consola (muestra lo que llega por WebSocket y la latencia):

```bash
node scripts/socket-probe.mjs http://localhost:5173 10
```

### Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Cannot connect to the Docker daemon` / `error during connect` | Docker Desktop no está abierto | Abrir Docker Desktop, esperar a que diga *Running* y repetir |
| `port is already allocated` (5173, 3000 o 6379) | Otro programa usa ese puerto | En `.env` cambiar `FRONTEND_PORT` o `BACKEND_PORT`; para 6379, detener el Redis local |
| El dashboard muestra **RECONNECTING** | El backend no está arriba | `docker compose ps` y luego `docker compose up -d backend` |
| Las zonas no cambian | El simulador está en pausa | En `/simulator` presionar **Reanudar** |
| `/simulator` dice *Sin conexión con el Publisher* | El publisher se detuvo | `docker compose restart publisher` |
| PostgreSQL **OFFLINE** en `/system` y `docker compose logs archiver` dice *PostgreSQL unavailable* | Opción B sin PostgreSQL corriendo o sin usuario/base | Iniciar PostgreSQL y ejecutar el paso 3 (opción B), o pasarse a la opción A |
| Con la opción A no aparece el contenedor `postgres` | Falta `COMPOSE_PROFILES=local-db` en `.env` | Corregir `.env` y ejecutar `docker compose up -d` |
| `docker-credential-desktop: executable file not found` (macOS) | La terminal no ve las herramientas de Docker | `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"` y repetir |
| Quiero empezar de cero | Datos de pruebas anteriores | `docker compose exec redis redis-cli FLUSHALL` y luego `docker compose restart` |

---

## Parte 2. Guion de exposición: qué es y cómo funciona

Esta parte explica el sistema **en el orden en que se expone**. Cada tema dice **qué decir** (las
citas) y **qué mostrar** en pantalla. Duración aproximada: 16 minutos más preguntas.

Reparto sugerido (el mismo del documento del proyecto):

| Bloque | Temas | Tiempo |
|---|---|---|
| 1 | El problema, la arquitectura y el recorrido de un evento | 3 min |
| 2 | El simulador y el Publisher | 3 min |
| 3 | Redis por dentro, procesamiento, métricas y alertas | 4 min |
| 4 | Dashboard, demostración en vivo, tolerancia a fallos, PostgreSQL y cierre | 6 min |

Aunque cada integrante exponga un bloque, **todos deben poder responder** sobre la arquitectura,
Pub/Sub, Streams, Hashes, estado actual vs histórico, simulación, métricas, alertas y limitaciones.

### Preparación antes de empezar

1. Sistema arriba con `SIMULATION_INTERVAL_MS=2000` (ver [ajustes para la exposición](#ajustes-para-el-día-de-la-exposición)).
2. Pestañas abiertas en el navegador: **Dashboard** (<http://localhost:5173>), **Simulador**
   (`/simulator`), **Redis y BD** (`/debug`), **Sistema** (`/system`) y, si se usa, **RedisInsight**
   (<http://localhost:5540>).
3. Tres terminales en la carpeta del proyecto:
   - A: `docker compose logs -f publisher`
   - B: `docker compose logs -f processor`
   - C: libre para comandos.
4. Verificar **● LIVE**, **Redis Connected** y todo ONLINE en `/system`.
5. 30 segundos antes de empezar: `/simulator` → **Reiniciar día**.

---

### Bloque 1. El problema, la arquitectura y el recorrido de un evento

#### 1.1 El problema (≈ 45 s)

> "En la universidad, quien llega en carro o en moto no sabe si hay cupo hasta que recorre el
> parqueadero. Nuestro sistema responde en tiempo real tres preguntas: ¿cuántos espacios libres hay
> en cada zona?, ¿qué zona se está llenando? y ¿cuándo hay que avisar? Monitoreamos seis zonas de
> demostración: tres de carros con 180 cupos y tres de motos con 240, 420 en total."

**Mostrar:** el dashboard. Señalar los indicadores de arriba (ocupación global, carros, motos,
disponibles, zonas críticas, flujo del último minuto) y el plano con las seis zonas.

#### 1.2 La idea: una arquitectura orientada a eventos (≈ 1 min)

> "Cada vez que un vehículo entra o sale se produce un **evento**. El dashboard no pregunta cada
> rato si hay algo nuevo: cada componente **reacciona** cuando le llega un evento. Cada componente
> hace una sola cosa y corre en su propio contenedor Docker; si uno se cae, los demás siguen."

![Arquitectura general](docs/img/arquitectura.png)

| Componente | Qué hace, en una frase |
|---|---|
| **Simulador** | Seis sensores virtuales que generan entradas y salidas realistas |
| **Publisher** | Recibe cada lectura, la normaliza, la valida y la publica en Redis |
| **Redis** | El núcleo: transporta los eventos y guarda el estado actual y el histórico reciente |
| **Subscriber / Processor** | Escucha los eventos, calcula métricas, detecta alertas y guarda el resultado en Redis |
| **Backend** | API REST y puente Redis → WebSocket hacia el navegador |
| **Dashboard** | Página React que se actualiza sola en cuanto llega un cambio |
| **Archiver → PostgreSQL** | Copia el histórico a PostgreSQL para que dure en el tiempo |

**Mostrar:** en el dashboard, el panel **Recorrido de un evento**: las etapas con sus contadores
aumentando en vivo.

#### 1.3 El recorrido de un evento real (≈ 1,5 min)

> "Sigamos un evento real, el `evt_009115`: una moto entra a la Zona M2, que tenía 72 de sus 80
> puestos ocupados."

1. El sensor virtual de la Zona M2 reporta `count = 73`.
2. El **Publisher** lo normaliza (`motos-02` → `MOTOS-02`, `IN` → `VEHICLE_ENTERED`, 7 disponibles,
   91,25 %) y lo valida contra el esquema.
3. El Publisher lo guarda en el histórico (`XADD parking:stream`) y lo difunde al instante
   (`PUBLISH parking-events`).
4. El **Processor** lo recibe, lee el estado anterior de la zona (`HGETALL parking:zone:MOTOS-02` →
   72/80), actualiza las ventanas de tiempo y calcula: 73 / 80 = **91,25 % → CRITICAL**.
5. Guarda el nuevo estado (`HSET`), el ranking (`ZADD`) y el punto de la gráfica
   (`XADD parking:timeseries`), y publica el resultado en `parking-updates`.
6. El **Backend** recibe ese mensaje y lo envía al navegador por WebSocket (Socket.IO).
7. La tarjeta de la Zona M2 pasa a **73/80** sin recargar la página.

> "Todo el recorrido tomó unos **13 milisegundos**; el procesamiento del evento, 3,7 ms."

![Recorrido de un evento](docs/img/recorrido-evento.png)

---

### Bloque 2. El simulador y el Publisher

#### 2.1 El simulador (≈ 1,5 min)

> "No tenemos sensores físicos, así que los simulamos, pero **no con números aleatorios**. Cada zona
> recuerda su ocupación anterior y aplica `ocupados(t+1) = ocupados(t) + entradas − salidas`, sin
> bajar nunca de 0 ni pasar de la capacidad."

- **Perfil de demanda por hora**, igual que un día real de universidad:

  | Franja | Comportamiento |
  |---|---|
  | 07:00 – 08:00 | Alta entrada (llegada a clases) |
  | 08:00 – 12:00 | Estable |
  | 12:00 – 14:00 | Alta salida (almuerzo) |
  | 14:00 – 17:00 | Demanda media |
  | 17:00 – 18:00 | Alta salida |
  | Resto del día | Baja demanda |

- Las llegadas siguen una **distribución de Poisson** y cada zona tiene su **factor de demanda**: la
  Zona B y la Zona M2 son las más solicitadas.
- **Modo acelerado:** 1 minuto real = 1 hora simulada, así que el día completo (06:00 a 20:00) se ve
  en 14 minutos. También existe el modo de hora real.
- **Semilla fija** (`SIMULATION_SEED=2026`): cada ejecución es reproducible.
- **Escenarios forzables** para la demostración: Normal, Alta demanda, Entrada masiva, Salida
  masiva, Cerca de lleno, Llenar zona y Recuperación.

**Mostrar:** la página `/simulator`: hora simulada, perfil de demanda actual, eventos publicados y
el panel de escenarios.

![Panel del simulador](docs/img/simulador.png)

#### 2.2 El Publisher (≈ 1,5 min)

> "El Publisher es la puerta de entrada a Redis. Hace cuatro pasos: captura, normaliza, valida y
> publica."

| Paso | Qué hace |
|---|---|
| 1. Captura | Recibe la lectura cruda del sensor (zona, dirección, conteo, hora) |
| 2. Normaliza | La convierte al modelo común de eventos: id único (`INCR parking:seq:event`), tipo, zona, fecha ISO, disponibles y porcentaje |
| 3. Valida | Comprueba el evento con un esquema **Zod**; si no cumple, no se publica |
| 4. Publica | `XADD parking:stream` (queda guardado) + `PUBLISH parking-events` (llega al instante) |

> "¿Por qué publicamos en dos lugares? Porque **Pub/Sub es inmediato pero no guarda nada**: si nadie
> está escuchando, el mensaje se pierde. El **Stream sí lo guarda**, y así se puede recuperar
> después."

**Mostrar:** la terminal A (logs del publisher):

```text
VEHICLE_ENTERED MOTOS-02 published event_id=evt_015912 occupied=63/80 occupancy=78.75 stream_id=1790123812623-0 receivers=1
```

`receivers=1` significa que un suscriptor (el Processor) recibió el mensaje. Luego, en la terminal
C, ver los eventos pasar en vivo por Pub/Sub (salir con `Ctrl+C`):

```bash
docker compose exec redis redis-cli SUBSCRIBE parking-events
```

---

### Bloque 3. Redis por dentro, procesamiento y alertas

#### 3.1 Redis: cinco mecanismos, cinco responsabilidades (≈ 2 min)

> "Redis es una base de datos **en memoria RAM**: lee y escribe en microsegundos, por eso sirve para
> tiempo real. No lo usamos como una simple caché: usamos cinco mecanismos de Redis y cada uno
> cumple una función distinta."

| Mecanismo | Para qué lo usamos | Claves o canales | Comando típico |
|---|---|---|---|
| **Pub/Sub** | Comunicación inmediata entre servicios | `parking-events`, `parking-updates`, `parking-alerts`, `system-events`, `simulator-commands` | `PUBLISH` / `SUBSCRIBE` |
| **Streams** | Histórico reciente, recuperación de eventos perdidos y archivo en PostgreSQL | `parking:stream` (máx. ~10 000), `parking:timeseries`, `parking:alerts:stream` | `XADD`, `XRANGE`, `XREADGROUP` |
| **Hashes** | Estado actual de cada zona y métricas globales | `parking:zone:<id>`, `parking:metrics:*`, `parking:alerts:active` | `HSET`, `HGETALL` |
| **Sorted Sets** | Ranking de ocupación y ventanas deslizantes de 1, 5 y 15 minutos | `parking:ranking:occupancy`, `parking:window:entries:<id>` | `ZADD`, `ZREVRANGE`, `ZCOUNT` |
| **TTL** | Datos que deben desaparecer solos | `parking:heartbeat:*` (10 s), `parking:alert:cooldown:*` (30 s) | `SET … EX`, `EXPIRE`, `TTL` |

> "La idea más importante: **el Hash es el estado actual**, la foto de este instante; **el Stream es
> el histórico reciente**, la película de lo que pasó. Con los dos respondemos *cómo está* y *cómo
> llegó ahí*."

**Mostrar:** en `/debug`, los botones **Estado actual (Hash)**, **Histórico reciente (Stream)** y
**Ranking (Sorted Set)**, y la tabla de claves donde el TTL de los heartbeats baja en vivo. O en la
terminal C:

```bash
docker compose exec redis redis-cli HGETALL parking:zone:MOTOS-02
```

```bash
docker compose exec redis redis-cli XREVRANGE parking:stream + - COUNT 3
```

```bash
docker compose exec redis redis-cli ZREVRANGE parking:ranking:occupancy 0 -1 WITHSCORES
```

```bash
docker compose exec redis redis-cli TTL parking:heartbeat:publisher
```

#### 3.2 El Processor: de un evento a las métricas (≈ 1 min)

> "El Subscriber escucha `parking-events` y entrega los eventos **en orden, uno por uno**, al
> Processor. Por cada evento, el Processor lee el estado anterior, calcula el nuevo, actualiza
> ventanas y ranking, guarda todo en Redis, evalúa las alertas y publica el resultado."

Qué calcula:

- Ocupación y espacios disponibles por zona, global, de carros y de motos.
- Entradas y salidas por minuto, y en ventanas de 5 y 15 minutos (Sorted Sets con la hora como score).
- Variación y **tendencia** (sube, baja o estable: cambio de ±3 puntos en 30 segundos).
- Zona más ocupada, número de zonas críticas y promedio de ocupación de los últimos 5 minutos.

Estado de cada zona según su ocupación:

| LOW | NORMAL | WARNING | CRITICAL | FULL |
|---|---|---|---|---|
| < 60 % | 60 – 79,9 % | 80 – 89,9 % | 90 – 99,9 % | 100 % |

#### 3.3 Las alertas (≈ 1 min)

> "Las alertas salen de una **máquina de estados**. Subir de nivel es inmediato; para bajar, la
> ocupación debe caer **2 puntos por debajo** del umbral. Eso es la **histéresis** y evita que una
> zona que oscila entre 89 % y 90 % dispare alertas a cada segundo. Además, cada alerta resuelta
> deja un **cooldown de 30 segundos** guardado como una clave con TTL."

![Máquina de estados de las alertas](docs/img/maquina-alertas.png)

| Alerta | Se dispara cuando… |
|---|---|
| `OCCUPANCY_WARNING` | La zona llega al 80 % |
| `HIGH_OCCUPANCY` | La zona llega al 90 % |
| `PARKING_FULL` | La zona llega al 100 % |
| `LOW_AVAILABILITY` | Quedan 5 espacios o menos |
| `UNUSUAL_OCCUPANCY_INCREASE` | La ocupación sube 20 puntos o más en 6 segundos |
| `CAR_PARKING_FULL` / `MOTORCYCLE_PARKING_FULL` | Se llenan todas las zonas de carros o de motos |

Cuando la zona se recupera se genera el evento `ZONE_RECOVERED` y la alerta pasa a **Resueltas**.

---

### Bloque 4. Dashboard, demostración en vivo y cierre

#### 4.1 El dashboard (≈ 45 s)

> "El backend está suscrito a `parking-updates` y `parking-alerts` y reenvía cada mensaje por
> **WebSocket** con Socket.IO. Por eso el dashboard cambia sin recargar la página."

- **Encabezado:** hora simulada, **latencia de extremo a extremo** (del sensor a la pantalla),
  **● LIVE** y **Redis Connected**.
- **Indicadores**, **plano de las zonas** (un cuadrito por puesto), **alertas activas y resueltas** y
  **actividad en tiempo real**.
- **Gráficas:** evolución de la ocupación, entradas vs salidas por minuto y ranking de zonas.
- **Recorrido de un evento** con los contadores de cada etapa.
- Clic en una zona: su **estado actual (Hash)** junto a su **histórico (Stream)**.

#### 4.2 Demostración en vivo (≈ 3 min)

| # | Qué hacer | Qué se ve | Qué decir |
|---|---|---|---|
| 1 | Mostrar el dashboard | ● LIVE, las zonas se mueven solas | "Nadie está recargando la página." |
| 2 | `/simulator` → Zona: **Zona A** → **Forzar VEHICLE_ENTERED** | La tarjeta suma 1, destella, cambia el indicador y aparece la fila en *Actividad* | "Un evento acaba de recorrer toda la arquitectura." |
| 3 | Zona: **Zona C** → **Cerca de lleno** | La zona sube a 90–99 % en pocos segundos; aparecen las alertas de ocupación (advertencia y luego crítica), disponibilidad baja y crecimiento inusual | "La máquina de estados escala el nivel." |
| 4 | **Llenar zona** | `PARKING_FULL`: tarjeta roja, 0 disponibles | "Alerta crítica: zona llena." |
| 5 | **Recuperación** | Salidas progresivas; `ZONE_RECOVERED`; la alerta pasa a *Resueltas* | "Con histéresis, sin alertas intermitentes." |
| 6 | Terminal C: `docker compose exec redis redis-cli HGETALL parking:zone:CARS-C` | El estado actual de la Zona C | "Esto es la foto de ahora: el Hash." |
| 7 | Terminal C: `docker compose exec redis redis-cli XREVRANGE parking:stream + - COUNT 5` | Los últimos eventos | "Y esto es cómo llegó ahí: el Stream." |
| 8 | `/simulator` → Zona: **Todas las zonas** → **Normal** | Todo vuelve al perfil normal | — |

#### 4.3 Tolerancia a fallos (≈ 1 min)

> "¿Qué pasa si se cae el Processor? Pub/Sub no guarda mensajes, pero el Stream sí."

```bash
docker compose stop processor
```

La terminal A muestra `receivers=0` y el aviso *"Pub/Sub does not retain messages; it remains in
parking:stream"*. El dashboard se congela. Esperar unos 15 segundos:

```bash
docker compose start processor
```

La terminal B muestra *"Recovered N events missed while offline from parking:stream"* y el dashboard
se pone al día solo.

> "Y si se cae Redis, todos los servicios reintentan la conexión a 1, 2 y 5 segundos; al volver, el
> estado se conserva porque Redis guarda instantáneas en disco (RDB)."

(Opcional: `docker compose stop redis`, ver *Redis reconectando* en el encabezado y
`docker compose start redis`).

#### 4.4 PostgreSQL: la memoria de largo plazo (≈ 45 s)

> "Redis guarda el presente y el pasado reciente; lo que debe durar va a PostgreSQL. El **archiver**
> lee el Stream con un **consumer group**: `XREADGROUP` → `INSERT` → `XACK`. Si el archiver se
> detiene, los eventos esperan en el Stream y se archivan cuando vuelve: no se pierde nada."

| Tabla | Contenido |
|---|---|
| `parking_events` | Todos los eventos, con su `stream_id` de Redis |
| `alerts` | Alertas levantadas y resueltas, con duración y motivo |
| `zone_snapshots` | Foto del estado de cada zona cada 60 segundos |
| `daily_zone_summary` (vista) | Reporte diario por zona: entradas, salidas, pico, promedio, veces llena y alertas |

**Mostrar:** `/debug` → panel **PostgreSQL — histórico permanente**.

#### 4.5 Resultados y cierre (≈ 45 s)

| Medición | Resultado |
|---|---|
| Latencia de extremo a extremo (sensor → pantalla) | ≈ 9 – 13 ms |
| Tiempo de procesamiento por evento | 4 – 6 ms |
| Eventos en un día simulado | ≈ 3 400 |
| Memoria de Redis con el Stream lleno | ≈ 9 MB |
| Pruebas automáticas | 68 unitarias + 4 de integración |

> "En conclusión: Redis resolvió el tiempo real. Pub/Sub comunica, los Streams recuerdan, los
> Hashes guardan el estado actual, los Sorted Sets ordenan y el TTL limpia solo. PostgreSQL
> complementa con la memoria de largo plazo."

Limitaciones que conviene mencionar: Redis depende de la RAM, Pub/Sub no conserva mensajes (por eso
el Stream), el histórico en Redis es limitado a propósito (`MAXLEN`) y los sensores son simulados.

---

### Preguntas probables del profesor

Las 22 preguntas con su respuesta completa están en el capítulo 19 del
[documento del proyecto](Documento_Proyecto_UPTC_Smart_Parking.pdf) y en
[`docs/presentation.md`](docs/presentation.md). Las más importantes, en corto:

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué Redis? | Porque trabaja en memoria (latencia de milisegundos) y trae Pub/Sub, Streams, Hashes y Sorted Sets, que encajan con una arquitectura orientada a eventos. |
| ¿Diferencia entre estado actual e histórico? | El estado actual es la última foto de cada zona (Hash `parking:zone:<id>`); el histórico es la secuencia de eventos que llevó a ella (Stream `parking:stream`). |
| ¿Por qué Hashes? | Una zona tiene muchos atributos relacionados; el Hash los lee juntos con un comando y permite cambiar sólo los que cambian. |
| ¿Por qué Streams si ya tienen Pub/Sub? | Pub/Sub no guarda mensajes. El Stream conserva el histórico reciente para recuperar eventos perdidos, dibujar gráficas y archivar en PostgreSQL. |
| ¿Qué pasa si se desconecta el Subscriber? | Pierde los mensajes Pub/Sub de ese lapso, pero al volver los recupera del Stream desde su último checkpoint (se demuestra en vivo). |
| ¿Qué pasa si Redis se reinicia? | Se recupera de la instantánea RDB y, además, los sensores envían conteos absolutos: el primer evento de cada zona recalibra su estado. |
| ¿Cómo controlan el crecimiento de los datos? | Streams con `MAXLEN ~`, ventanas recortadas con `EXPIRE`, TTL en los datos temporales, límite de memoria con `volatile-lru` y retención en PostgreSQL. |
| ¿Cómo generan los datos? | Con un simulador con continuidad (`ocupados(t+1) = ocupados(t) + entradas − salidas`), perfiles por hora y llegadas de Poisson; no son números aleatorios independientes. |
| ¿Qué escala horizontalmente? | Publishers, Processors (consumer groups por zona) y Backends; Redis con réplicas, Sentinel o Cluster. |
| ¿Por qué además PostgreSQL? | Redis guarda el presente y el pasado reciente; PostgreSQL guarda lo que debe durar (reportes diarios, auditoría de alertas) sin afectar el tiempo real. |

---

## Parte 3. Referencia técnica

### Servicios

| Servicio | Tecnología | Responsabilidad |
|---|---|---|
| `publisher` | Node.js 22 + TypeScript | Simulador de sensores + Publisher (captura → normaliza → valida con Zod → publica) |
| `processor` | Node.js 22 + TypeScript | Subscriber de `parking-events` + Processor (estado, ventanas, ranking, métricas, alertas) |
| `backend` | Express 5 + Socket.IO 4 | API REST, puente Redis → WebSocket, estado del sistema |
| `archiver` | Node.js + pg | Consumer group de Redis Streams que archiva en PostgreSQL |
| `frontend` | React 19 + Vite + Tailwind 4 + Recharts | Dashboard (servido por nginx en Docker) |
| `redis` | Redis 7 | Comunicación, estado actual, histórico reciente, ranking, datos temporales |
| `postgres` | PostgreSQL 18 (perfil `local-db`) | Histórico permanente en contenedor (opción A) |
| `redis-insight` | RedisInsight (perfil `insight`) | Interfaz gráfica de Redis |

### Puertos

| Puerto | Servicio |
|---|---|
| 5173 | Dashboard (nginx en Docker / Vite en desarrollo) |
| 3000 | Backend REST + Socket.IO |
| 6379 | Redis |
| 5540 | RedisInsight (perfil `insight`) |
| 5432 | PostgreSQL instalado en el equipo (opción B) |
| 5433 | PostgreSQL en contenedor (opción A) |

### Configuración

| Archivo | Contenido |
|---|---|
| `.env` | Conexiones, perfiles de Docker, intervalos, límites de crecimiento, logging (plantilla: `.env.example`) |
| `config/zones.json` | Zonas: id, nombre, tipo de vehículo, capacidad y factor de demanda (reiniciar servicios al cambiarlo) |
| `config/thresholds.json` | Umbrales de estados y alertas, histéresis y cooldown |
| `config/simulation.json` | Perfiles de demanda por franja horaria y parámetros de cada escenario |

| Variable | Por defecto | Descripción |
|---|---|---|
| `COMPOSE_PROFILES` | vacío | `local-db` (PostgreSQL en contenedor), `insight` (RedisInsight) |
| `SIMULATION_INTERVAL_MS` | `5000` | Un ciclo de simulación cada 5 s (usar `2000` en la exposición) |
| `SIMULATION_MODE` | `ACCELERATED_DEMO` | `ACCELERATED_DEMO` (1 min real = 1 h simulada) o `REAL_TIME_PROFILE` |
| `SIMULATION_SEED` | `2026` | Semilla del simulador (ejecución reproducible) |
| `STREAM_MAX_LENGTH` | `10000` | `XADD parking:stream MAXLEN ~ 10000` |
| `WARNING_OCCUPANCY` / `CRITICAL_OCCUPANCY` | `80` / `90` | Sobrescriben `thresholds.json` |
| `LOW_AVAILABILITY` | `5` | Espacios para la alerta `LOW_AVAILABILITY` |
| `ALERT_COOLDOWN_SECONDS` | `30` | TTL del cooldown de alertas |
| `DATABASE_URL` | `host.docker.internal` | PostgreSQL del equipo visto desde Docker (opción B) |
| `DEMO_CONTROL_TOKEN` | vacío | Si se define, el panel del simulador exige la cabecera `x-demo-token` |

### Páginas del dashboard

| Ruta | Contenido |
|---|---|
| `/` | Indicadores, plano de zonas, alertas, actividad, gráficas, ranking y recorrido de un evento |
| `/simulator` | Control del simulador: pausa, reinicio, velocidad, modo, escenarios y eventos manuales |
| `/system` | Estado ONLINE / OFFLINE / RECONNECTING de cada componente |
| `/debug` | Redis (canales, claves con TTL en vivo, inspector) y PostgreSQL (tablas, reporte diario) |

### API REST y Socket.IO

```text
GET  /api/health                  GET  /api/metrics               GET  /api/alerts
GET  /api/zones                   GET  /api/metrics/cars          GET  /api/alerts/active
GET  /api/zones/:id               GET  /api/metrics/motorcycles   GET  /api/events
GET  /api/zones/:id/history       GET  /api/metrics/history       GET  /api/ranking
GET  /api/system/status           GET  /api/config
GET  /api/simulator               POST /api/simulator/commands
GET  /api/debug/keys · /api/debug/inspect?key= · /api/debug/pubsub
GET  /api/archive/stats · /daily · /occupancy · /events · /alerts
```

Eventos Socket.IO: `parking:event`, `parking:update`, `parking:metrics`, `parking:alert`,
`parking:recovery`, `parking:resync`, `system:status`, `simulator:state`.

Ejemplo de orden al simulador:

```bash
curl -X POST localhost:3000/api/simulator/commands -H 'content-type: application/json' -d '{"action":"SET_SCENARIO","scenario":"FULL","zone_id":"CARS-C"}'
```

### Estructura del repositorio

```text
ProyectoElectivaI/
├── apps/
│   ├── publisher/   simulation/ (simulador, perfiles, escenarios, reloj) · publisher/ (normaliza, valida, publica)
│   ├── processor/   subscriber/ · processor/ · metrics/ · alerts/ · redis/
│   ├── backend/     controllers/ · routes/ · services/ · websocket/ · redis/ · db/
│   ├── archiver/    consumer group Redis Streams → PostgreSQL
│   └── frontend/    components/ · pages/ · charts/ · hooks/ · services/ · stores/
├── packages/shared/ modelo de eventos, esquemas Zod, constantes, dominio, utilidades Node
├── config/          zones.json · thresholds.json · simulation.json
├── db/schema.sql    esquema de PostgreSQL (lo aplica el archiver)
├── docker/          Dockerfiles, nginx.conf, redis.conf
├── docs/            documentación técnica e imágenes
├── scripts/         setup-postgres · redis-cli · simulate-day · socket-probe · test-integration
├── tests/           pruebas de integración
├── docker-compose.yml · .env.example · package.json
└── Documento_Proyecto_UPTC_Smart_Parking.pdf / .docx
```

### Despliegue en una VPS

1. Instalar Docker y Compose, clonar el repositorio y crear `.env`.
2. Base de datos: opción A (`COMPOSE_PROFILES=local-db`) o un PostgreSQL del servidor
   (`host.docker.internal` funciona en Linux gracias a `extra_hosts: host-gateway`; PostgreSQL debe
   escuchar en la interfaz de Docker y permitirlo en `pg_hba.conf`).
3. Cambiar la contraseña `Admin` por una segura, definir `DEMO_CONTROL_TOKEN` para proteger el panel
   del simulador y `CORS_ORIGIN` con el dominio.
4. No exponer los puertos 6379, 5432 ni 5433 a Internet (quitar esos `ports:` en `docker-compose.yml`).
5. Poner un proxy HTTPS (Caddy o nginx) delante del puerto 5173.

---

## Documentación

- **[`Documento_Proyecto_UPTC_Smart_Parking.pdf`](Documento_Proyecto_UPTC_Smart_Parking.pdf)** (también en
  `.docx`): documento completo para entregar y estudiar (66 páginas): funcionamiento paso a paso,
  Redis, simulador, métricas, alertas, dashboard, guía de exposición y 22 preguntas de sustentación.
- [`docs/architecture.md`](docs/architecture.md): arquitectura, diagramas de contexto, contenedores y secuencia.
- [`docs/redis-design.md`](docs/redis-design.md): claves, estructuras, comandos, crecimiento y persistencia.
- [`docs/event-model.md`](docs/event-model.md): esquema de eventos, alertas y mensajes.
- [`docs/simulator.md`](docs/simulator.md): modelo de simulación, perfiles y escenarios.
- [`docs/database.md`](docs/database.md): PostgreSQL, esquema, archiver y retención.
- [`docs/technical-report.md`](docs/technical-report.md): informe técnico.
- [`docs/presentation.md`](docs/presentation.md): presentación, guion de demostración y preguntas.
