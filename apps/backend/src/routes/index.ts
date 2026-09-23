import { Router } from 'express';
import type { parkingController } from '../controllers/parking.controller';
import type { systemController } from '../controllers/system.controller';

/**
 * API REST
 *   GET  /api/health                 GET  /api/metrics               GET  /api/alerts
 *   GET  /api/zones                  GET  /api/metrics/cars          GET  /api/alerts/active
 *   GET  /api/zones/:id              GET  /api/metrics/motorcycles   GET  /api/events
 *   GET  /api/zones/:id/history      GET  /api/metrics/history       GET  /api/ranking
 *   GET  /api/system/status          GET  /api/config
 *   GET  /api/simulator              POST /api/simulator/commands
 *   GET  /api/debug/keys · /api/debug/inspect · /api/debug/pubsub
 *   GET  /api/archive/stats · /daily · /occupancy · /events · /alerts   (PostgreSQL)
 */
export function createRouter(
  parking: ReturnType<typeof parkingController>,
  system: ReturnType<typeof systemController>,
): Router {
  const router = Router();

  router.get('/health', system.health);
  router.get('/config', parking.config);

  router.get('/zones', parking.zones);
  router.get('/zones/:id', parking.zone);
  router.get('/zones/:id/history', parking.zoneHistory);

  router.get('/metrics', parking.metrics);
  router.get('/metrics/cars', parking.metricsCars);
  router.get('/metrics/motorcycles', parking.metricsMotorcycles);
  router.get('/metrics/history', parking.metricsHistory);

  router.get('/alerts', parking.alerts);
  router.get('/alerts/active', parking.activeAlerts);

  router.get('/events', parking.events);
  router.get('/ranking', parking.ranking);

  router.get('/system/status', system.status);

  router.get('/simulator', system.simulatorState);
  router.post('/simulator/commands', system.requireDemoToken, system.simulatorCommand);

  router.get('/debug/keys', system.debugKeys);
  router.get('/debug/inspect', system.debugInspect);
  router.get('/debug/pubsub', system.debugPubSub);

  router.get('/archive/stats', system.archiveStats);
  router.get('/archive/daily', system.archiveDaily);
  router.get('/archive/occupancy', system.archiveOccupancy);
  router.get('/archive/events', system.archiveEvents);
  router.get('/archive/alerts', system.archiveAlerts);

  return router;
}
