/** Canales Redis Pub/Sub. */
export const CHANNELS = {
  /** Eventos crudos del simulador (VEHICLE_ENTERED / VEHICLE_EXITED). Publisher → Processor. */
  PARKING_EVENTS: 'parking-events',
  /** Estados procesados (zona + métricas + eventos derivados). Processor → Backend. */
  PARKING_UPDATES: 'parking-updates',
  /** Alertas levantadas o resueltas. Processor → Backend. */
  PARKING_ALERTS: 'parking-alerts',
  /** Cambios internos: simulación iniciada/detenida, escenario, reinicio. */
  SYSTEM_EVENTS: 'system-events',
  /** Órdenes del panel de simulación. Backend → Publisher. */
  SIMULATOR_COMMANDS: 'simulator-commands',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Eventos Socket.IO emitidos por el backend al dashboard. */
export const SOCKET_EVENTS = {
  EVENT: 'parking:event',
  UPDATE: 'parking:update',
  METRICS: 'parking:metrics',
  ALERT: 'parking:alert',
  RECOVERY: 'parking:recovery',
  RESYNC: 'parking:resync',
  SYSTEM_STATUS: 'system:status',
  SIMULATOR_STATE: 'simulator:state',
} as const;
