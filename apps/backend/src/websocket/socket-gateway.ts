import {
  CHANNELS,
  SOCKET_EVENTS,
  type AlertChange,
  type ProcessedMessage,
  type SimulatorState,
  type SocketAlertPayload,
  type SocketEventPayload,
  type SocketMetricsPayload,
  type SocketResyncPayload,
  type SocketZoneUpdatePayload,
  type SystemEvent,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import type { SimulatorService } from '../services/simulator.service';
import type { SystemService } from '../services/system.service';

/**
 * Puente Redis → navegador.
 *   parking-updates  → parking:event · parking:update · parking:metrics · parking:resync
 *   parking-alerts   → parking:alert (RAISED) · parking:recovery (RESOLVED)
 *   system-events    → parking:event (SIMULATION_STARTED / STOPPED / SCENARIO_CHANGED)
 * Además emite system:status cada 2 s y simulator:state cuando cambia.
 */
export class SocketGateway {
  emitted = 0;
  private lastSimulatorJson = '';
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly io: Server,
    private readonly subscriber: Redis,
    private readonly system: SystemService,
    private readonly simulator: SimulatorService,
    private readonly logger: Logger,
  ) {}

  get clients(): number {
    return this.io.engine.clientsCount;
  }

  async start(): Promise<void> {
    this.io.on('connection', (socket) => {
      this.logger.info('Dashboard connected', { socket: socket.id, clients: this.clients });
      void this.pushStatus(socket.id);
      socket.on('disconnect', (reason) =>
        this.logger.info('Dashboard disconnected', { socket: socket.id, reason, clients: this.clients }),
      );
    });

    this.subscriber.on('message', (channel: string, raw: string) => {
      try {
        this.route(channel, JSON.parse(raw));
      } catch (error) {
        this.logger.warn('Invalid message from Redis channel', { channel, error: (error as Error).message });
      }
    });
    await this.subscriber.subscribe(CHANNELS.PARKING_UPDATES, CHANNELS.PARKING_ALERTS, CHANNELS.SYSTEM_EVENTS);
    this.logger.info('Subscribed to Redis channels', {
      channels: [CHANNELS.PARKING_UPDATES, CHANNELS.PARKING_ALERTS, CHANNELS.SYSTEM_EVENTS].join(','),
    });

    this.timers.push(setInterval(() => void this.pushStatus(), 2000));
    this.timers.push(setInterval(() => void this.pushSimulatorState(), 1000));
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
  }

  private route(channel: string, payload: unknown): void {
    const emitted_at = Date.now();
    switch (channel) {
      case CHANNELS.PARKING_UPDATES:
        this.routeUpdate(payload as ProcessedMessage, emitted_at);
        break;
      case CHANNELS.PARKING_ALERTS: {
        const change = payload as AlertChange;
        const message: SocketAlertPayload = { ...change, emitted_at };
        this.emit(change.action === 'RAISED' ? SOCKET_EVENTS.ALERT : SOCKET_EVENTS.RECOVERY, message);
        break;
      }
      case CHANNELS.SYSTEM_EVENTS: {
        const message: SocketEventPayload = { event: payload as SystemEvent, emitted_at };
        this.emit(SOCKET_EVENTS.EVENT, message);
        void this.pushSimulatorState(true);
        break;
      }
    }
  }

  private routeUpdate(message: ProcessedMessage, emitted_at: number): void {
    switch (message.type) {
      case 'ZONE_UPDATE': {
        this.emit(SOCKET_EVENTS.EVENT, { event: message.event, emitted_at } satisfies SocketEventPayload);
        for (const derived of message.derived_events) {
          this.emit(SOCKET_EVENTS.EVENT, { event: derived, emitted_at } satisfies SocketEventPayload);
        }
        const update: SocketZoneUpdatePayload = {
          zone: message.zone,
          event_id: message.event.event_id,
          generated_at: message.event.metadata.generated_at,
          processed_at: message.processed_at,
          emitted_at,
        };
        this.emit(SOCKET_EVENTS.UPDATE, update);
        this.emit(SOCKET_EVENTS.METRICS, {
          kind: 'snapshot',
          metrics: message.metrics,
          emitted_at,
        } satisfies SocketMetricsPayload);
        this.logger.info('Dashboard update emitted', {
          event_id: message.event.event_id,
          zone: message.zone.zone_id,
          occupancy: message.zone.occupancy,
          clients: this.clients,
        });
        break;
      }
      case 'METRICS_SAMPLE':
        this.emit(SOCKET_EVENTS.METRICS, {
          kind: 'sample',
          metrics: message.metrics,
          sample: message.sample,
          emitted_at,
        } satisfies SocketMetricsPayload);
        break;
      case 'RESYNC':
        this.logger.info('Resync broadcast to dashboards', { recovered: message.recovered_events });
        this.emit(SOCKET_EVENTS.RESYNC, {
          reason: message.reason,
          recovered_events: message.recovered_events,
          emitted_at,
        } satisfies SocketResyncPayload);
        break;
    }
  }

  private emit(event: string, payload: unknown): void {
    this.emitted++;
    this.io.emit(event, payload);
  }

  private async pushStatus(socketId?: string): Promise<void> {
    try {
      const status = await this.system.getStatus();
      if (socketId) this.io.to(socketId).emit(SOCKET_EVENTS.SYSTEM_STATUS, status);
      else this.io.emit(SOCKET_EVENTS.SYSTEM_STATUS, status);
    } catch (error) {
      this.logger.debug('System status unavailable', { error: (error as Error).message });
    }
  }

  private async pushSimulatorState(force = false): Promise<void> {
    try {
      const state: SimulatorState | null = await this.simulator.getState();
      if (!state) return;
      const { updated_at: _ignored, ...comparable } = state;
      const json = JSON.stringify(comparable);
      if (!force && json === this.lastSimulatorJson) return;
      this.lastSimulatorJson = json;
      this.io.emit(SOCKET_EVENTS.SIMULATOR_STATE, state);
    } catch {
      // Redis no disponible: se reintentará en el próximo ciclo.
    }
  }
}
