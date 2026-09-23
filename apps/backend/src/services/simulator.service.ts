import { randomUUID } from 'node:crypto';
import {
  CHANNELS,
  KEYS,
  type SimulatorCommand,
  type SimulatorCommandEnvelope,
  type SimulatorState,
  type ZoneScenarioState,
} from '@uptc/shared';
import type { Redis } from 'ioredis';
import { assertReady } from '../redis/connections';

export class PublisherNotListeningError extends Error {}

/** Panel de simulación: lee parking:simulator:state y envía órdenes por Pub/Sub. */
export class SimulatorService {
  constructor(private readonly redis: Redis) {}

  async getState(): Promise<SimulatorState | null> {
    assertReady(this.redis);
    const raw = await this.redis.hgetall(KEYS.simulatorState);
    if (!raw || !raw.status) return null;
    let zoneScenarios: Record<string, ZoneScenarioState> = {};
    try {
      zoneScenarios = JSON.parse(raw.zone_scenarios ?? '{}');
    } catch {
      zoneScenarios = {};
    }
    return {
      status: raw.status as SimulatorState['status'],
      mode: raw.mode as SimulatorState['mode'],
      speed: Number(raw.speed) || 1,
      interval_ms: Number(raw.interval_ms) || 0,
      effective_interval_ms: Number(raw.effective_interval_ms) || 0,
      simulated_time: raw.simulated_time ?? '',
      simulated_day: Number(raw.simulated_day) || 1,
      profile: raw.profile ?? '',
      global_scenario: (raw.global_scenario as SimulatorState['global_scenario']) ?? 'NORMAL',
      zone_scenarios: zoneScenarios,
      ticks: Number(raw.ticks) || 0,
      events_published: Number(raw.events_published) || 0,
      started_at: raw.started_at ?? '',
      updated_at: raw.updated_at ?? '',
    };
  }

  /** PUBLISH simulator-commands {command_id, issued_at, command} */
  async send(command: SimulatorCommand): Promise<{ command_id: string; receivers: number }> {
    assertReady(this.redis);
    const envelope: SimulatorCommandEnvelope = { command_id: randomUUID(), issued_at: Date.now(), command };
    const receivers = await this.redis.publish(CHANNELS.SIMULATOR_COMMANDS, JSON.stringify(envelope));
    if (receivers === 0) {
      throw new PublisherNotListeningError('El Publisher no está escuchando órdenes (¿servicio detenido?)');
    }
    return { command_id: envelope.command_id, receivers };
  }
}
