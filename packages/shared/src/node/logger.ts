/**
 * Logger estructurado sin dependencias.
 *   pretty: 14:40:03 INFO  [processor] Zone state updated zone=CARS-A occupancy=81.67
 *   json:   {"ts":"…","level":"info","service":"processor","msg":"…","zone":"CARS-A"}
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(scope: string): Logger;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return JSON.stringify(value.message);
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function clock(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

export function createLogger(service: string): Logger {
  const minLevel = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;
  const json = process.env.LOG_FORMAT === 'json';
  const color = !json && process.stdout.isTTY;

  const write = (level: Level, msg: string, ctx?: LogContext) => {
    if (ORDER[level] < minLevel) return;
    const now = new Date();
    let line: string;
    if (json) {
      const payload: LogContext = { ts: now.toISOString(), level, service, msg };
      for (const [k, v] of Object.entries(ctx ?? {})) payload[k] = v instanceof Error ? v.message : v;
      line = JSON.stringify(payload);
    } else {
      const tag = level.toUpperCase().padEnd(5);
      const extras = Object.entries(ctx ?? {})
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(' ');
      const lvl = color ? `${COLORS[level]}${tag}${RESET}` : tag;
      line = `${clock(now)} ${lvl} [${service}] ${msg}${extras ? ` ${extras}` : ''}`;
    }
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };

  return {
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    child: (scope) => createLogger(`${service}:${scope}`),
  };
}
