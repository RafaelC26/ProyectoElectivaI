// Punto de entrada apto para navegador y Node (sin dependencias de fs / ioredis).
export * from './constants/channels';
export * from './constants/domain';
export * from './constants/redis-keys';
export * from './domain/occupancy';
export * from './domain/serialization';
export * from './events/event-factory';
export * from './schemas/command.schema';
export * from './schemas/config.schema';
export * from './schemas/event.schema';
export * from './types/domain';
export * from './types/models';
