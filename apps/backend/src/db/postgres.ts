import type { Logger } from '@uptc/shared/node';
import pg from 'pg';

/**
 * Conexión opcional a PostgreSQL (histórico permanente que alimenta el servicio archiver).
 * Si DATABASE_URL no está definida o Postgres no responde, el resto del sistema sigue
 * funcionando: sólo los endpoints /api/archive/* responden 503.
 */
export class Postgres {
  readonly pool: pg.Pool | null;
  connected = false;

  constructor(
    url: string | undefined,
    private readonly logger: Logger,
  ) {
    this.pool = url ? new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 3000 }) : null;
    this.pool?.on('error', (error) => logger.warn('PostgreSQL pool error', { error: error.message }));
  }

  get configured(): boolean {
    return this.pool !== null;
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      if (!this.connected) this.logger.info('PostgreSQL connected');
      this.connected = true;
    } catch (error) {
      if (this.connected) this.logger.warn('PostgreSQL unreachable', { error: (error as Error).message });
      this.connected = false;
    }
    return this.connected;
  }

  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new PostgresUnavailableError('DATABASE_URL no está configurada');
    try {
      const result = await this.pool.query<T>(sql, params);
      this.connected = true;
      return result.rows;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // 42P01 = tabla inexistente (el archiver aún no creó el esquema)
      if (code === '42P01' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === '28P01') {
        this.connected = code === '42P01';
        throw new PostgresUnavailableError((error as Error).message);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export class PostgresUnavailableError extends Error {}
