import {
  CHANNELS,
  LABELS,
  SERVICES,
  SIMULATION_MODES,
  SimulatorCommandEnvelopeSchema,
  formatZodError,
  type SimulationMode,
  type SimulatorCommand,
  type SystemEvent,
} from '@uptc/shared';
import {
  createLogger,
  createRedis,
  envNumber,
  envString,
  isReady,
  loadEnv,
  loadSimulationConfig,
  loadZones,
  onShutdown,
  startHeartbeat,
  waitForReady,
} from '@uptc/shared/node';
import { EventNormalizer, buildSystemEvent } from './publisher/event-normalizer';
import { EventValidationError, validateSensorEvent, validateSystemEvent } from './publisher/event-validator';
import { PublisherService } from './publisher/publisher.service';
import { ParkingSimulator, type PlannedMovement } from './simulation/parking-simulator';

loadEnv();
const logger = createLogger('publisher');

const zones = loadZones();
const zoneIds = new Set(zones.map((z) => z.id));
const simulationConfig = loadSimulationConfig();
const modeEnv = envString('SIMULATION_MODE', 'ACCELERATED_DEMO');
const mode: SimulationMode = (SIMULATION_MODES as readonly string[]).includes(modeEnv)
  ? (modeEnv as SimulationMode)
  : 'ACCELERATED_DEMO';

const simulator = new ParkingSimulator({
  zones,
  config: simulationConfig,
  mode,
  intervalMs: envNumber('SIMULATION_INTERVAL_MS', 5000),
  startTime: envString('SIMULATION_START_TIME', '06:30'),
  timeZone: envString('SIMULATION_TIMEZONE', 'America/Bogota'),
  seed: envNumber('SIMULATION_SEED', 2026),
});

const redis = createRedis('publisher', logger);
const commands = createRedis('publisher-commands', logger);
const normalizer = new EventNormalizer(zones);
const publisher = new PublisherService(redis, logger, envNumber('STREAM_MAX_LENGTH', 10_000));

let stopping = false;
let rejectedEvents = 0;
let lastReceivers = -1;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const sleepUntil = (at: number) => sleep(at - Date.now());

/** Cola serial: garantiza que los eventos se publiquen en el mismo orden en que se capturan. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
  const next = queue.then(task).catch((error: Error) => {
    logger.error('Publish task failed', { error: error.message });
    return undefined;
  });
  queue = next;
  return next;
}

/** CAPTURAR → NORMALIZAR → VALIDAR → PUBLICAR */
async function emitMovement(movement: PlannedMovement): Promise<void> {
  const reading = simulator.apply(movement); // 1. captura (sensor virtual)
  if (!reading) {
    logger.debug('Movement discarded by zone bounds', { zone: movement.zoneId, kind: movement.kind });
    return;
  }
  const eventId = await publisher.nextEventId();
  const candidate = normalizer.normalize(reading, eventId); // 2. normaliza

  let event;
  try {
    event = validateSensorEvent(candidate); // 3. valida (Zod)
  } catch (error) {
    rejectedEvents++;
    if (error instanceof EventValidationError) {
      logger.warn('Event rejected by validation', { event_id: error.eventId, reason: error.message });
      return;
    }
    throw error;
  }

  const { streamId, receivers } = await publisher.publishSensorEvent(event); // 4. publica
  simulator.eventsPublished++;
  logger.info(`${event.event_type} ${event.entity_id} published`, {
    event_id: event.event_id,
    occupied: `${event.data.occupied}/${event.data.capacity}`,
    occupancy: event.data.occupancy,
    stream_id: streamId,
    receivers,
    ...(movement.manual ? { manual: true } : {}),
  });

  if (receivers === 0 && lastReceivers !== 0) {
    logger.warn(
      'No Pub/Sub subscriber received the event — Pub/Sub does not retain messages; it remains in parking:stream',
    );
  } else if (receivers > 0 && lastReceivers === 0) {
    logger.info('Pub/Sub subscribers available again', { receivers });
  }
  lastReceivers = receivers;
}

async function emitSystemEvent(type: SystemEvent['event_type'], message: string, zoneId: string | null = null) {
  const scenario = zoneId ? simulator.scenarios.scenarioFor(zoneId) : simulator.scenarios.global;
  const event = validateSystemEvent(
    buildSystemEvent(
      type,
      await publisher.nextEventId(),
      { mode: simulator.mode, speed: simulator.speed, scenario, simulatedTime: simulator.clock.label() },
      message,
      zoneId,
    ),
  );
  await publisher.publishSystemEvent(event);
  logger.info(type, { message, event_id: event.event_id });
}

async function saveState() {
  if (isReady(redis)) await publisher.saveState(simulator.snapshot());
}

function assertZone(zoneId: string, allowAll: boolean): boolean {
  if ((allowAll && zoneId === 'ALL') || zoneIds.has(zoneId)) return true;
  logger.warn('Command rejected: unknown zone', { zone: zoneId });
  return false;
}

async function handleCommand(command: SimulatorCommand): Promise<void> {
  switch (command.action) {
    case 'SET_SCENARIO': {
      if (!assertZone(command.zone_id, true)) return;
      const message = simulator.scenarios.set(command.scenario, command.zone_id, [...zoneIds]);
      await emitSystemEvent('SCENARIO_CHANGED', message, command.zone_id === 'ALL' ? null : command.zone_id);
      break;
    }
    case 'SET_SPEED':
      simulator.speed = command.speed;
      logger.info('Simulation speed changed', {
        speed: `x${command.speed}`,
        interval_ms: simulator.effectiveIntervalMs,
      });
      break;
    case 'SET_MODE':
      simulator.setMode(command.mode);
      logger.info('Simulation mode changed', { mode: command.mode, simulated_time: simulator.clock.label() });
      break;
    case 'PAUSE':
      if (simulator.status === 'RUNNING') {
        simulator.status = 'PAUSED';
        await emitSystemEvent('SIMULATION_STOPPED', 'Simulación en pausa desde el panel de control');
      }
      break;
    case 'RESUME':
      if (simulator.status !== 'RUNNING') {
        simulator.status = 'RUNNING';
        await emitSystemEvent('SIMULATION_STARTED', 'Simulación reanudada desde el panel de control');
      }
      break;
    case 'RESET':
      simulator.reset();
      await emitSystemEvent('SIMULATION_STARTED', `Simulación reiniciada: día 1, ${simulator.clock.label()}`);
      break;
    case 'FORCE_ENTRY':
    case 'FORCE_EXIT': {
      if (!assertZone(command.zone_id, false)) return;
      const kind = command.action === 'FORCE_ENTRY' ? 'ENTRY' : 'EXIT';
      logger.info('Manual movement forced', { zone: command.zone_id, kind, count: command.count });
      // handleCommand ya se ejecuta dentro de la cola serial: se emite directamente.
      for (const movement of simulator.forced(command.zone_id, kind, command.count)) {
        await emitMovement(movement);
        if (command.count > 1) await sleep(60);
      }
      break;
    }
  }
  await saveState();
}

let commandChain: Promise<void> = Promise.resolve();
async function listenForCommands() {
  await commands.subscribe(CHANNELS.SIMULATOR_COMMANDS);
  logger.info('Listening for simulator commands', { channel: CHANNELS.SIMULATOR_COMMANDS });
  commands.on('message', (_channel: string, raw: string) => {
    let parsed;
    try {
      parsed = SimulatorCommandEnvelopeSchema.safeParse(JSON.parse(raw));
    } catch {
      logger.warn('Ignoring non-JSON command');
      return;
    }
    if (!parsed.success) {
      logger.warn('Ignoring invalid command', { reason: formatZodError(parsed.error) });
      return;
    }
    const { command, command_id } = parsed.data;
    logger.info('Command received', { command_id, action: command.action });
    commandChain = commandChain
      .then(() => enqueue(() => handleCommand(command)).then(() => undefined))
      .catch((error: Error) => logger.error('Command failed', { error: error.message }));
  });
}

async function run() {
  await waitForReady(redis);

  const previous = await publisher.loadState(zones);
  if (previous) {
    simulator.restore(previous);
    logger.info('Simulator state restored from Redis', {
      simulated_time: simulator.clock.label(),
      day: simulator.clock.day,
      zones: Object.keys(previous.occupancy).length,
    });
  }

  await listenForCommands();
  startHeartbeat(redis, SERVICES.PUBLISHER, logger, () => ({
    status: simulator.status,
    mode: simulator.mode,
    speed: simulator.speed,
    simulated_time: simulator.clock.label(),
    profile: simulator.currentProfile().profile,
    scenario: simulator.scenarios.global,
    events_published: simulator.eventsPublished,
    events_rejected: rejectedEvents,
  }));

  logger.info('Simulator started', {
    mode: simulator.mode,
    interval_ms: simulator.intervalMs,
    sim_minutes_per_tick: simulator.simMinutesPerTick,
    zones: zones.length,
    simulated_time: simulator.clock.label(),
  });
  await enqueue(() =>
    emitSystemEvent(
      'SIMULATION_STARTED',
      `Simulación iniciada (${simulator.mode === 'ACCELERATED_DEMO' ? '1 min real = 1 h simulada' : 'hora real'}), ${zones.length} zonas`,
    ),
  );

  let lastProfile = '';
  while (!stopping) {
    if (simulator.status !== 'RUNNING' || !isReady(redis)) {
      await sleep(300);
      continue;
    }
    const tickStart = Date.now();
    const plan = simulator.tick();

    if (plan.newDay) logger.info('New simulated day', { day: simulator.clock.day, simulated_time: plan.simulatedTime });
    if (plan.profile.profile !== lastProfile) {
      lastProfile = plan.profile.profile;
      logger.info('Demand profile active', {
        profile: plan.profile.profile,
        label: LABELS.profile[plan.profile.profile],
        range: `${plan.profile.from}-${plan.profile.to}`,
        entry_weight: plan.profile.entryWeight,
        exit_weight: plan.profile.exitWeight,
      });
    }
    for (const transition of plan.transitions) {
      await enqueue(() => emitSystemEvent('SCENARIO_CHANGED', transition.message, transition.zoneId));
    }
    for (const movement of plan.movements) {
      if (stopping || simulator.status !== 'RUNNING') break;
      await sleepUntil(tickStart + movement.offsetMs);
      await enqueue(() => emitMovement(movement));
    }
    await enqueue(saveState);
    await sleepUntil(tickStart + simulator.effectiveIntervalMs);
  }
}

onShutdown(logger, async () => {
  stopping = true;
  if (isReady(redis)) {
    await enqueue(() => emitSystemEvent('SIMULATION_STOPPED', 'Publisher detenido'));
    await saveState();
  }
  await Promise.allSettled([commands.quit(), redis.quit()]);
});

run().catch((error: Error) => {
  logger.error('Publisher crashed', { error: error.message });
  process.exit(1);
});
