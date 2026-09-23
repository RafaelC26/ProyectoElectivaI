# Simulador de sensores

El simulador (`apps/publisher/src/simulation`) reemplaza a los sensores físicos de conteo. Cada zona
es una entidad monitoreada con un **sensor virtual** que detecta entradas y salidas. No depende de
APIs externas y **no genera valores aleatorios independientes**: la ocupación futura depende siempre
de la anterior.

```text
occupied(t + 1) = occupied(t) + entradas − salidas
0 <= occupied <= capacity
```

## 1. Componentes

| Archivo | Responsabilidad |
|---|---|
| `parking-simulator.ts` | Orquesta el ciclo: avanza el reloj, planifica movimientos por zona y los aplica |
| `zone-simulator.ts` | Sensor virtual de una zona: conserva la ocupación, rechaza movimientos imposibles, cuenta el último minuto |
| `demand-profile.ts` | Resuelve el perfil de demanda vigente para la hora simulada |
| `scenario-manager.ts` | Escenarios especiales (globales o por zona) |
| `sim-clock.ts` | Reloj simulado (`REAL_TIME_PROFILE` / `ACCELERATED_DEMO`) |
| `random.ts` | Generador con semilla (mulberry32) + Poisson |

## 2. Perfiles de demanda (`config/simulation.json`)

| Franja | Perfil | entryWeight | exitWeight | intensity* |
|---|---|---|---|---|
| 06:00–07:00 | MEDIUM (llegadas tempranas) | 0,60 | 0,40 | 0,006 |
| 07:00–08:00 | HIGH_ENTRY | 0,80 | 0,20 | 0,017 |
| 08:00–12:00 | STABLE | 0,50 | 0,50 | 0,005 |
| 12:00–14:00 | HIGH_EXIT | 0,25 | 0,75 | 0,0045 |
| 14:00–17:00 | MEDIUM | 0,55 | 0,45 | 0,020 |
| 17:00–18:00 | HIGH_EXIT | 0,15 | 0,85 | 0,016 |
| 18:00–06:00 | LOW | 0,30 | 0,70 | 0,006 |

\* `intensity` = movimientos esperados por minuto simulado como fracción de la capacidad.
Son **parámetros de simulación**, no mediciones reales.

## 3. Algoritmo de un ciclo

Para cada zona:

1. `λ = intensity × capacity × minutos_simulados_del_ciclo × demandFactor`
2. `movimientos ~ Poisson(λ)` (llegadas aleatorias pero con tasa realista)
3. Cada movimiento es **entrada** con probabilidad `entryWeight`, si no **salida**.
4. **Saturación:** por encima del "techo" del escenario (75 % en NORMAL, 97 % en HIGH_DEMAND) la
   probabilidad de entrada se multiplica por `((1 − r) / (1 − techo))²`: los conductores buscan otra
   zona cuando casi no hay espacio. Así NORMAL se estabiliza alrededor de 80 % en el pico y no genera
   alertas críticas, mientras que HIGH_DEMAND sí se acerca a la saturación.
5. Los movimientos se reparten a lo largo del intervalo (desfases aleatorios ordenados), de modo que
   el tablero recibe eventos de forma continua y no en ráfagas cada 5 s.
6. Al "detectar" el movimiento el sensor lo aplica sobre la ocupación **actual**: una entrada en zona
   llena o una salida en zona vacía se descartan.

Resultado para un día simulado (semilla 2026, intervalo 2 s):

```text
07:00 HIGH_ENTRY  A: 27%  B: 11%  C: 16%  M1: 14%  M2: 14%  M3: 15%
08:00 STABLE      A: 77%  B: 76%  C: 74%  M1: 63%  M2: 80%  M3: 63%
12:00 HIGH_EXIT   A: 48%  B: 77%  C: 68%  M1: 73%  M2: 74%  M3: 66%
14:00 MEDIUM      A: 22%  B: 36%  C: 46%  M1: 51%  M2: 45%  M3: 50%
17:00 HIGH_EXIT   A: 40%  B: 39%  C: 80%  M1: 73%  M2: 65%  M3: 80%
19:00 LOW         A:  2%  B:  1%  C:  0%  M1:  1%  M2:  3%  M3: 31%
≈ 3 400 eventos por día simulado · pico de ocupación en NORMAL: 78–86 %
```

Se reproduce con `node --import tsx scripts/simulate-day.ts 2000`.

## 4. Tiempo simulado

| Modo | Reloj | Uso |
|---|---|---|
| `ACCELERATED_DEMO` | Avanza `intervalo × 60` (1 min real = 1 h simulada). Jornada 06:00–20:00; al terminar salta al día siguiente | Exposición: un día completo en ≈ 14 min |
| `REAL_TIME_PROFILE` | Hora actual de Bogotá (`SIMULATION_TIMEZONE`) | Funcionamiento realista |

La velocidad x1/x2/x5 acorta el intervalo real entre ciclos (5 000 ms → 2 500 / 1 000 ms).

## 5. Escenarios especiales

| Escenario | Alcance | Comportamiento | Termina |
|---|---|---|---|
| `NORMAL` | global o zona | Perfil del día con techo 75 % | — |
| `HIGH_DEMAND` | global o zona | Intensidad ×1,8, entrada +0,20, techo 97 % → tendencia ascendente | al cambiar |
| `MASS_ENTRY` | zona o todas | 30 % de la capacidad en 3 ciclos, concentrado al inicio de cada ciclo | solo, tras 3 ciclos |
| `MASS_EXIT` | zona o todas | 35 % de la capacidad en 3 ciclos | solo, tras 3 ciclos |
| `NEAR_FULL` | zona o todas | Sube ~6 % por ciclo hasta 90 % y oscila entre 90 % y 99 % | al cambiar |
| `FULL` | zona o todas | Sube ~8 % por ciclo hasta `occupied = capacity`; luego rotación ocasional (sale 1, entra 1) | al cambiar |
| `RECOVERY` | zona o todas | Salidas progresivas ~6 % por ciclo (100 → 94 → 88 → 82 → 76 …) | solo, al llegar a 70 % |

Cada cambio (manual o automático) se publica como `SCENARIO_CHANGED` en `system-events`.

## 6. Control

Panel **/simulator** o `POST /api/simulator/commands`:

```json
{ "action": "SET_SCENARIO", "scenario": "NEAR_FULL", "zone_id": "CARS-B" }
{ "action": "FORCE_ENTRY", "zone_id": "CARS-A", "count": 5 }
{ "action": "SET_SPEED", "speed": 5 }
{ "action": "PAUSE" }
```

El backend publica la orden en `simulator-commands`; el Publisher la valida con Zod y la aplica en
su cola serial (los eventos conservan el orden).

## 7. Continuidad ante reinicios

El Publisher guarda su estado en `parking:simulator:state` (reloj, día, escenario global y por zona,
velocidad, modo). Al reiniciar lo restaura junto con la ocupación de cada zona leída de los Hashes;
en un arranque limpio usa la ocupación inicial configurada (6–14 %).

## 8. Reproducibilidad

`SIMULATION_SEED` fija la secuencia pseudoaleatoria: con la misma semilla, configuración e intervalo
el día simulado es idéntico (verificado por la prueba *"es reproducible con la misma semilla"*).
