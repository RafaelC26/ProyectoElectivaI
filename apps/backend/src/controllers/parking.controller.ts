import {
  ALERT_TYPES,
  ZONE_EVENT_TYPES,
  SYSTEM_EVENT_TYPES,
  type ScheduleEntry,
  type Thresholds,
  type ZoneConfig,
} from '@uptc/shared';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { ParkingService } from '../services/parking.service';
import { NotFoundError } from './http-errors';

const EventQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  zone: z.string().max(40).optional(),
  type: z.enum([...ZONE_EVENT_TYPES, ...SYSTEM_EVENT_TYPES]).optional(),
  before: z
    .string()
    .regex(/^\d+-\d+$/)
    .optional(),
});
const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  minutes: z.coerce.number().int().min(1).max(60).default(15),
});
const MinutesQuery = z.object({ minutes: z.coerce.number().int().min(1).max(120).default(15) });
const AlertQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  zone: z.string().max(40).optional(),
});

export function parkingController(
  parking: ParkingService,
  config: { zones: ZoneConfig[]; thresholds: Thresholds; schedule: ScheduleEntry[] },
) {
  const zone: RequestHandler = async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const state = parking.zoneExists(id) ? await parking.getZone(id) : null;
    if (!state) throw new NotFoundError(`Zona no encontrada: ${id}`);
    res.json({ data: state });
  };

  return {
    config: (async (_req, res) => {
      res.json({
        data: {
          zones: config.zones,
          thresholds: config.thresholds,
          schedule: config.schedule,
          alert_types: ALERT_TYPES,
        },
      });
    }) satisfies RequestHandler,

    zones: (async (_req, res) => {
      res.json({ data: await parking.getZones() });
    }) satisfies RequestHandler,

    zone,

    zoneHistory: (async (req, res) => {
      const id = String(req.params.id).toUpperCase();
      if (!parking.zoneExists(id)) throw new NotFoundError(`Zona no encontrada: ${id}`);
      const { limit, minutes } = HistoryQuery.parse(req.query);
      res.json({ data: await parking.getZoneHistory(id, limit, minutes) });
    }) satisfies RequestHandler,

    metrics: (async (_req, res) => {
      res.json({ data: await parking.getMetrics() });
    }) satisfies RequestHandler,

    metricsCars: (async (_req, res) => {
      res.json({ data: (await parking.getMetrics()).cars });
    }) satisfies RequestHandler,

    metricsMotorcycles: (async (_req, res) => {
      res.json({ data: (await parking.getMetrics()).motorcycles });
    }) satisfies RequestHandler,

    metricsHistory: (async (req, res) => {
      const { minutes } = MinutesQuery.parse(req.query);
      res.json({ data: await parking.getMetricsHistory(minutes) });
    }) satisfies RequestHandler,

    ranking: (async (_req, res) => {
      res.json({ data: await parking.getRanking() });
    }) satisfies RequestHandler,

    events: (async (req, res) => {
      const q = EventQuery.parse(req.query);
      res.json({ data: await parking.getEvents({ ...q, zone: q.zone?.toUpperCase() }) });
    }) satisfies RequestHandler,

    alerts: (async (req, res) => {
      const { limit, zone: zoneId } = AlertQuery.parse(req.query);
      res.json({ data: await parking.getAlertHistory(limit, zoneId?.toUpperCase()) });
    }) satisfies RequestHandler,

    activeAlerts: (async (_req, res) => {
      res.json({ data: await parking.getActiveAlerts() });
    }) satisfies RequestHandler,
  };
}
