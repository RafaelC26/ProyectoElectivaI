import { createServer } from 'node:http';
import { SERVICES } from '@uptc/shared';
import {
  createLogger,
  envNumber,
  envOptional,
  envString,
  loadEnv,
  loadSimulationConfig,
  loadThresholds,
  loadZones,
  onShutdown,
  startHeartbeat,
} from '@uptc/shared/node';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { errorHandler, notFoundHandler } from './controllers/http-errors';
import { parkingController } from './controllers/parking.controller';
import { systemController } from './controllers/system.controller';
import { Postgres } from './db/postgres';
import { createConnections } from './redis/connections';
import { createRouter } from './routes';
import { ArchiveService } from './services/archive.service';
import { DebugService } from './services/debug.service';
import { ParkingService } from './services/parking.service';
import { SimulatorService } from './services/simulator.service';
import { SystemService } from './services/system.service';
import { SocketGateway } from './websocket/socket-gateway';

loadEnv();
const logger = createLogger('backend');
const port = envNumber('BACKEND_PORT', 3000);
const corsOrigin = envString('CORS_ORIGIN', '*');
const zones = loadZones();
const thresholds = loadThresholds();
const schedule = loadSimulationConfig().schedule;
const startedAt = Date.now();

const { commands, subscriber } = createConnections(logger);
const postgres = new Postgres(envOptional('DATABASE_URL'), logger.child('postgres'));

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin }, pingInterval: 10_000, pingTimeout: 8_000 });

const parking = new ParkingService(commands, zones);
const simulator = new SimulatorService(commands);
const debug = new DebugService(commands);
const archive = new ArchiveService(postgres, logger.child('archive'));
let gateway: SocketGateway | null = null;
const system = new SystemService({
  redis: commands,
  postgres,
  startedAt,
  websocketClients: () => gateway?.clients ?? 0,
  archiveCounts: () => archive.cachedCounts(),
});
gateway = new SocketGateway(io, subscriber, system, simulator, logger.child('ws'));

app.disable('x-powered-by');
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '32kb' }));
app.use(
  '/api',
  createRouter(
    parkingController(parking, { zones, thresholds, schedule }),
    systemController({
      system,
      simulator,
      debug,
      archive,
      demoToken: envOptional('DEMO_CONTROL_TOKEN'),
    }),
  ),
);
app.use(notFoundHandler);
app.use(errorHandler(logger));

async function main() {
  await gateway!.start();
  await archive.refreshCounts();
  const archiveTimer = setInterval(() => void archive.refreshCounts(), 5000);

  const stopHeartbeat = startHeartbeat(commands, SERVICES.BACKEND, logger, () => ({
    websocket_clients: gateway!.clients,
    socket_messages_emitted: gateway!.emitted,
    postgres: postgres.connected,
  }));

  server.listen(port, () => {
    logger.info('Backend listening', { port, rest: `http://localhost:${port}/api`, websocket: 'socket.io' });
  });

  onShutdown(logger, async () => {
    clearInterval(archiveTimer);
    stopHeartbeat();
    gateway!.stop();
    io.close();
    await Promise.allSettled([subscriber.quit(), commands.quit(), postgres.close()]);
  });
}

main().catch((error: Error) => {
  logger.error('Backend crashed', { error: error.message });
  process.exit(1);
});
