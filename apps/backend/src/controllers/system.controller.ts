import { SimulatorCommandSchema } from '@uptc/shared';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { ArchiveService } from '../services/archive.service';
import type { DebugService } from '../services/debug.service';
import type { SimulatorService } from '../services/simulator.service';
import type { SystemService } from '../services/system.service';
import { UnauthorizedError } from './http-errors';

export function systemController(deps: {
  system: SystemService;
  simulator: SimulatorService;
  debug: DebugService;
  archive: ArchiveService;
  demoToken?: string;
}) {
  const { system, simulator, debug, archive } = deps;

  /** Si DEMO_CONTROL_TOKEN está definido, las órdenes al simulador requieren la cabecera x-demo-token. */
  const requireDemoToken: RequestHandler = (req, _res, next) => {
    if (deps.demoToken && req.header('x-demo-token') !== deps.demoToken) {
      throw new UnauthorizedError('Token de demostración inválido (cabecera x-demo-token)');
    }
    next();
  };

  const limit = (max: number, fallback: number) => z.coerce.number().int().min(1).max(max).default(fallback);

  return {
    requireDemoToken,

    health: (async (_req, res) => {
      const health = await system.getHealth();
      res.status(health.status === 'unhealthy' ? 503 : 200).json(health);
    }) satisfies RequestHandler,

    status: (async (_req, res) => {
      res.json({ data: await system.getStatus() });
    }) satisfies RequestHandler,

    simulatorState: (async (_req, res) => {
      res.json({ data: await simulator.getState() });
    }) satisfies RequestHandler,

    simulatorCommand: (async (req, res) => {
      const command = SimulatorCommandSchema.parse(req.body);
      const result = await simulator.send(command);
      res.status(202).json({ data: { ...result, command } });
    }) satisfies RequestHandler,

    debugKeys: (async (_req, res) => {
      res.json({ data: await debug.listKeys() });
    }) satisfies RequestHandler,

    debugInspect: (async (req, res) => {
      const { key, count } = z.object({ key: z.string().min(1).max(200), count: limit(100, 10) }).parse(req.query);
      res.json({ data: await debug.inspect(key, count) });
    }) satisfies RequestHandler,

    debugPubSub: (async (_req, res) => {
      res.json({ data: await debug.pubsub() });
    }) satisfies RequestHandler,

    archiveStats: (async (_req, res) => {
      res.json({ data: await archive.stats() });
    }) satisfies RequestHandler,

    archiveDaily: (async (req, res) => {
      const { days } = z.object({ days: limit(90, 7) }).parse(req.query);
      res.json({ data: await archive.dailySummary(days) });
    }) satisfies RequestHandler,

    archiveOccupancy: (async (req, res) => {
      const q = z.object({ hours: limit(168, 6), zone: z.string().max(40).optional() }).parse(req.query);
      res.json({ data: await archive.hourlyOccupancy(q.zone?.toUpperCase(), q.hours) });
    }) satisfies RequestHandler,

    archiveEvents: (async (req, res) => {
      const q = z
        .object({ limit: limit(500, 50), zone: z.string().max(40).optional(), type: z.string().max(40).optional() })
        .parse(req.query);
      res.json({ data: await archive.events(q.limit, q.zone?.toUpperCase(), q.type) });
    }) satisfies RequestHandler,

    archiveAlerts: (async (req, res) => {
      const { limit: n } = z.object({ limit: limit(500, 50) }).parse(req.query);
      res.json({ data: await archive.alerts(n) });
    }) satisfies RequestHandler,
  };
}
