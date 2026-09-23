import { formatZodError } from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { PostgresUnavailableError } from '../db/postgres';
import { RedisUnavailableError } from '../redis/connections';
import { InvalidKeyError } from '../services/debug.service';
import { PublisherNotListeningError } from '../services/simulator.service';

export class NotFoundError extends Error {}
export class UnauthorizedError extends Error {}

/** Formato uniforme de errores: { error: { code, message } } */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: Error, req, res, _next) => {
    const send = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message } });
    if (error instanceof ZodError) return send(400, 'VALIDATION_ERROR', formatZodError(error));
    if (error instanceof NotFoundError) return send(404, 'NOT_FOUND', error.message);
    if (error instanceof UnauthorizedError) return send(401, 'UNAUTHORIZED', error.message);
    if (error instanceof InvalidKeyError) return send(400, 'INVALID_KEY', error.message);
    if (error instanceof PublisherNotListeningError) return send(503, 'PUBLISHER_OFFLINE', error.message);
    if (error instanceof PostgresUnavailableError) return send(503, 'POSTGRES_UNAVAILABLE', error.message);
    if (
      error instanceof RedisUnavailableError ||
      /enableOfflineQueue|Connection is closed|ECONNREFUSED/.test(error.message)
    ) {
      return send(503, 'REDIS_UNAVAILABLE', 'Redis no está disponible; reintentando conexión');
    }
    logger.error('Unhandled API error', { path: req.path, error: error.message });
    return send(500, 'INTERNAL_ERROR', 'Error interno del servidor');
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` } });
};
