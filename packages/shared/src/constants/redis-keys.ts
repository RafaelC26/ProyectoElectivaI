/**
 * Convención de claves Redis:  parking:<category>:<identifier>
 *
 * Cada estructura tiene una responsabilidad explícita:
 *   Hash        parking:zone:<id>              → estado ACTUAL de una zona
 *   Stream      parking:stream                 → histórico RECIENTE de eventos (MAXLEN ~)
 *   Stream      parking:timeseries             → muestras de métricas cada N s (gráficas)
 *   Sorted Set  parking:ranking:occupancy      → ranking de zonas por % de ocupación
 *   Sorted Set  parking:window:entries:<id>    → ventana deslizante de entradas (score = epoch ms)
 *   String+TTL  parking:heartbeat:<service>    → servicio vivo mientras la clave exista
 *   String+TTL  parking:alert:cooldown:*       → evita alertas repetidas
 */
export const KEY_PREFIX = 'parking';

export const KEYS = {
  zone: (zoneId: string) => `parking:zone:${zoneId}`,
  zonePattern: 'parking:zone:*',

  stream: 'parking:stream',
  timeseries: 'parking:timeseries',
  alertsStream: 'parking:alerts:stream',

  alertsActive: 'parking:alerts:active',
  alertState: (scopeId: string) => `parking:alert:state:${scopeId}`,
  alertCooldown: (scopeId: string, type: string) => `parking:alert:cooldown:${scopeId}:${type}`,

  metricsGlobal: 'parking:metrics:global',
  metricsCars: 'parking:metrics:cars',
  metricsMotorcycles: 'parking:metrics:motorcycles',

  ranking: 'parking:ranking:occupancy',

  windowEntries: (zoneId: string) => `parking:window:entries:${zoneId}`,
  windowExits: (zoneId: string) => `parking:window:exits:${zoneId}`,

  statsEntries: 'parking:stats:entries',
  statsExits: 'parking:stats:exits',
  statsSystem: 'parking:stats:system',

  heartbeat: (service: string) => `parking:heartbeat:${service}`,
  heartbeatPattern: 'parking:heartbeat:*',
  temporaryMetric: (name: string) => `parking:temporary:metric:${name}`,

  simulatorState: 'parking:simulator:state',

  seqEvent: 'parking:seq:event',
  seqAlert: 'parking:seq:alert',

  processorCheckpoint: 'parking:processor:checkpoint',
} as const;

/** Grupo de consumidores del Stream usado por el servicio archiver (Redis → PostgreSQL). */
export const STREAM_GROUPS = {
  ARCHIVER: 'archiver',
} as const;

export const SERVICES = {
  PUBLISHER: 'publisher',
  PROCESSOR: 'processor',
  BACKEND: 'backend',
  ARCHIVER: 'archiver',
} as const;

export type ServiceName = (typeof SERVICES)[keyof typeof SERVICES];
