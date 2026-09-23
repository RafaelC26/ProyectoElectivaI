import {
  CHANNELS,
  KEYS,
  formatAlertId,
  parseAlert,
  type Alert,
  type AlertChange,
  type AlertType,
  type Thresholds,
  type ZoneState,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { Redis } from 'ioredis';
import {
  GROUP_SCOPES,
  ZONE_ALERT_TYPES,
  evaluateGroupAlerts,
  evaluateZoneAlerts,
  resolvedCopy,
  type AlertDraft,
  type AlertLevel,
  type CooldownKey,
  type ResolutionDraft,
} from './alert-engine';

const COOLDOWN_KEYS: CooldownKey[] = ['OCCUPANCY', 'LOW_AVAILABILITY', 'UNUSUAL_OCCUPANCY_INCREASE'];

/**
 * Persistencia de alertas en Redis:
 *   Hash    parking:alerts:active            campo "<zona>:<tipo>" → alerta activa (JSON)
 *   Hash    parking:alert:state:<zona>       nivel actual de la máquina de estados
 *   String  parking:alert:cooldown:<zona>:<clave>  con TTL (EXPIRE) → evita alertas repetidas
 *   Stream  parking:alerts:stream            historial de alertas (RAISED / RESOLVED), MAXLEN ~
 */
export class AlertService {
  constructor(
    private readonly redis: Redis,
    private readonly thresholds: Thresholds,
    private readonly logger: Logger,
    private readonly streamMaxLength: number,
  ) {}

  async evaluateZone(
    zone: ZoneState,
    unusualIncrease: number | null,
    timestamp: string,
  ): Promise<{ changes: AlertChange[]; recovered: boolean }> {
    const fields = ZONE_ALERT_TYPES.map((type) => `${zone.zone_id}:${type}`);
    const pipeline = this.redis
      .pipeline()
      .hget(KEYS.alertState(zone.zone_id), 'level')
      .hmget(KEYS.alertsActive, ...fields);
    for (const key of COOLDOWN_KEYS) pipeline.exists(KEYS.alertCooldown(zone.zone_id, key));
    const results = (await pipeline.exec()) ?? [];

    const level = ((results[0]?.[1] as string | null) ?? 'NONE') as AlertLevel;
    const activeRaw = (results[1]?.[1] as (string | null)[]) ?? [];
    const active: Partial<Record<AlertType, Alert>> = {};
    ZONE_ALERT_TYPES.forEach((type, i) => {
      const alert = parseAlert(activeRaw[i]);
      if (alert) active[type] = alert;
    });
    const cooldowns = new Set<CooldownKey>(COOLDOWN_KEYS.filter((_, i) => Number(results[2 + i]?.[1]) === 1));

    const outcome = evaluateZoneAlerts({
      zone,
      level,
      active,
      cooldowns,
      unusualIncrease,
      thresholds: this.thresholds,
      timestamp,
    });

    const changes = await this.persist(outcome.raise, outcome.resolve, timestamp);
    const writes = this.redis.pipeline();
    if (outcome.level !== level) {
      writes.hset(KEYS.alertState(zone.zone_id), { level: outcome.level, updated_at: timestamp });
    }
    for (const key of outcome.cooldowns) {
      // EXPIRE: la clave desaparece sola tras el cooldown configurado.
      writes.set(KEYS.alertCooldown(zone.zone_id, key), timestamp, 'EX', this.thresholds.alertCooldownSeconds);
    }
    if (writes.length) await writes.exec();
    return { changes, recovered: outcome.recovered };
  }

  async evaluateGroups(zones: ZoneState[], timestamp: string): Promise<AlertChange[]> {
    const fields = GROUP_SCOPES.map((g) => `${g.scopeId}:${g.type}`);
    const raw = await this.redis.hmget(KEYS.alertsActive, ...fields);
    const active: Partial<Record<AlertType, Alert>> = {};
    GROUP_SCOPES.forEach((g, i) => {
      const alert = parseAlert(raw[i]);
      if (alert) active[g.type] = alert;
    });
    const { raise, resolve } = evaluateGroupAlerts(zones, active, timestamp);
    return this.persist(raise, resolve, timestamp);
  }

  async listActive(): Promise<Alert[]> {
    const values = await this.redis.hvals(KEYS.alertsActive);
    return values.map(parseAlert).filter((a): a is Alert => a !== null);
  }

  private async persist(raise: AlertDraft[], resolve: ResolutionDraft[], timestamp: string): Promise<AlertChange[]> {
    if (!raise.length && !resolve.length) return [];
    const changes: AlertChange[] = [];
    const pipeline = this.redis.pipeline();

    for (const draft of resolve) {
      const alert = resolvedCopy(draft, timestamp);
      pipeline.hdel(KEYS.alertsActive, `${alert.zone_id}:${alert.type}`);
      this.appendToStream(pipeline, 'RESOLVED', alert);
      changes.push({ action: 'RESOLVED', alert });
      this.logger.info('Alert resolved', {
        id: alert.id,
        zone: alert.zone_id,
        type: alert.type,
        resolution: alert.resolution,
      });
    }

    if (raise.length) {
      const last = await this.redis.incrby(KEYS.seqAlert, raise.length);
      raise.forEach((draft, i) => {
        const alert: Alert = { id: formatAlertId(last - raise.length + 1 + i), ...draft };
        pipeline.hset(KEYS.alertsActive, `${alert.zone_id}:${alert.type}`, JSON.stringify(alert));
        this.appendToStream(pipeline, 'RAISED', alert);
        changes.push({ action: 'RAISED', alert });
        this.logger.warn(alert.message, {
          id: alert.id,
          zone: alert.zone_id,
          type: alert.type,
          severity: alert.severity,
        });
      });
    }

    await pipeline.exec();
    for (const change of changes) await this.redis.publish(CHANNELS.PARKING_ALERTS, JSON.stringify(change));
    return changes;
  }

  private appendToStream(pipeline: ReturnType<Redis['pipeline']>, action: AlertChange['action'], alert: Alert) {
    pipeline.xadd(
      KEYS.alertsStream,
      'MAXLEN',
      '~',
      String(this.streamMaxLength),
      '*',
      'action',
      action,
      'alert_id',
      alert.id,
      'zone_id',
      alert.zone_id,
      'type',
      alert.type,
      'severity',
      alert.severity,
      'payload',
      JSON.stringify(alert),
    );
  }
}
