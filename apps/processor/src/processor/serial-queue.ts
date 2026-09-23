import type { Logger } from '@uptc/shared/node';

/**
 * Cola serial: los eventos se procesan uno a la vez y en orden de llegada, de modo que la
 * secuencia leer‑estado → calcular → guardar de una zona nunca se intercala con otra.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;

  constructor(private readonly logger: Logger) {}

  push<T>(task: () => Promise<T>): Promise<T | undefined> {
    this.pending++;
    const run = this.tail
      .then(task)
      .catch((error: Error) => {
        this.logger.error('Queued task failed', { error: error.message });
        return undefined;
      })
      .finally(() => {
        this.pending--;
      });
    this.tail = run;
    return run;
  }

  drain(): Promise<unknown> {
    return this.tail;
  }
}
