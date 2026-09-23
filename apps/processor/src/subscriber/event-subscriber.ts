import {
  CHANNELS,
  SENSOR_EVENT_TYPES,
  SensorEventSchema,
  formatZodError,
  parseStreamEntry,
  type SensorEvent,
} from '@uptc/shared';
import type { Logger } from '@uptc/shared/node';
import type { Redis } from 'ioredis';
import type { EventProcessor } from '../processor/event-processor';
import type { SerialQueue } from '../processor/serial-queue';
import type { StateRepository } from '../redis/state-repository';

const SENSOR_TYPES = new Set<string>(SENSOR_EVENT_TYPES);

/**
 * SUBSCRIBER — escucha el canal Pub/Sub parking-events y entrega cada evento al Processor.
 *
 * Pub/Sub no conserva mensajes: lo publicado mientras este servicio estaba desconectado
 * NO llega por este canal. Para no perder el estado, al arrancar (y tras cada reconexión)
 * el Subscriber lee parking:stream desde el último evento procesado (checkpoint) y
 * recupera lo que falte.
 */
export class EventSubscriber {
  received = 0;
  invalid = 0;
  recovered = 0;
  private started = false;

  constructor(
    private readonly connection: Redis,
    private readonly repo: StateRepository,
    private readonly queue: SerialQueue,
    private readonly processor: EventProcessor,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.connection.on('message', (_channel: string, raw: string) => this.onMessage(raw));
    this.connection.on('ready', () => {
      if (!this.started) return;
      this.logger.info('Subscriber reconnected — checking parking:stream for missed events');
      void this.queue.push(() => this.catchUp('reconnection'));
    });
    await this.connection.subscribe(CHANNELS.PARKING_EVENTS);
    this.started = true;
    this.logger.info('Subscribed to Redis Pub/Sub', { channel: CHANNELS.PARKING_EVENTS });
    await this.queue.push(() => this.catchUp('startup'));
  }

  private onMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.invalid++;
      this.logger.warn('Discarded non-JSON message');
      return;
    }
    const parsed = SensorEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.invalid++;
      this.logger.warn('Discarded invalid event', { reason: formatZodError(parsed.error) });
      return;
    }
    this.received++;
    const event: SensorEvent = parsed.data;
    this.logger.debug(`Processor received ${event.event_id}`, { type: event.event_type, zone: event.entity_id });
    void this.queue.push(() => this.processor.process(event, { replayed: false }));
  }

  /** Recupera desde parking:stream los eventos posteriores al checkpoint. */
  async catchUp(reason: string): Promise<number> {
    let cursor = this.processor.lastProcessedId;
    if (cursor === '0-0') return 0; // primer arranque: se empieza desde los eventos en vivo
    let count = 0;
    for (;;) {
      const entries = await this.repo.readStreamAfter(cursor, 250);
      if (!entries.length) break;
      for (const entry of entries) {
        cursor = entry[0];
        const parsed = parseStreamEntry(entry);
        if (!parsed || !SENSOR_TYPES.has(parsed.event.event_type) || parsed.event.metadata.source !== 'SIMULATOR')
          continue;
        const valid = SensorEventSchema.safeParse(parsed.event);
        if (!valid.success) continue;
        await this.processor.process(valid.data, { replayed: true });
        count++;
      }
      if (entries.length < 250) break;
    }
    if (count > 0) {
      this.recovered += count;
      this.logger.info(`Recovered ${count} events missed while offline from parking:stream`, { reason });
      await this.processor.publishResync(`Recuperación desde parking:stream (${reason})`, count);
    } else {
      this.logger.info('No missed events in parking:stream', { reason, checkpoint: this.processor.lastProcessedId });
    }
    return count;
  }
}
