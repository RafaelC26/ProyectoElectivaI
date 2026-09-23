import {
  SOCKET_EVENTS,
  type MetricsSnapshot,
  type SimulatorState,
  type SocketAlertPayload,
  type SocketEventPayload,
  type SocketMetricsPayload,
  type SocketZoneUpdatePayload,
  type SystemStatus,
} from '@uptc/shared';
import { useEffect } from 'react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { useParking, type RealtimeBatch, type Snapshot } from '../stores/parking-store';

const FLUSH_MS = 120;

function emptyBatch(): RealtimeBatch {
  return { events: [], zones: {}, metrics: null, samples: [], alertChanges: [] };
}

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Estado inicial por REST (también tras reconectar o recibir parking:resync). */
async function loadSnapshot(): Promise<Snapshot> {
  const [zones, metrics, ranking, samples, events, activeAlerts, alertLog, simulator, status] = await Promise.all([
    settle(api.zones(), []),
    settle(api.metrics(), null),
    settle(api.ranking(), []),
    settle(api.metricsHistory(15), []),
    settle(api.events(60), []),
    settle(api.activeAlerts(), []),
    settle(api.alertHistory(40), []),
    settle(api.simulator(), null),
    settle(api.systemStatus(), null),
  ]);
  const snapshot: MetricsSnapshot | null =
    metrics?.global && metrics.cars && metrics.motorcycles
      ? { global: metrics.global, cars: metrics.cars, motorcycles: metrics.motorcycles, ranking }
      : null;
  return { zones, metrics: snapshot, samples, events, activeAlerts, alertLog, simulator, status };
}

/**
 * Conecta el dashboard al backend: carga el estado por REST y luego aplica en vivo los
 * mensajes Socket.IO. Los mensajes se agrupan cada 120 ms para renderizar de forma fluida.
 */
export function useRealtime(): void {
  useEffect(() => {
    const store = useParking.getState;
    const socket = getSocket();
    let buffer = emptyBatch();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const flush = () => {
      timer = null;
      const batch = buffer;
      buffer = emptyBatch();
      store().applyBatch(batch);
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };
    const reload = async () => {
      const snapshot = await loadSnapshot();
      if (!disposed) store().hydrate(snapshot);
    };

    void settle(api.config(), null).then((config) => config && store().setConfig(config));

    const onConnect = () => {
      store().setConnection('LIVE');
      void reload();
    };
    const onDisconnect = () => store().setConnection('RECONNECTING');
    const onEvent = (payload: SocketEventPayload) => {
      const receivedAt = Date.now();
      const { event } = payload;
      buffer.events.push({
        key: event.metadata.stream_id ?? event.event_id,
        event,
        receivedAt,
        latency: event.metadata.source === 'SIMULATOR' ? receivedAt - event.metadata.generated_at : null,
        live: true,
      });
      schedule();
    };
    const onUpdate = (payload: SocketZoneUpdatePayload) => {
      buffer.zones[payload.zone.zone_id] = payload.zone;
      schedule();
    };
    const onMetrics = (payload: SocketMetricsPayload) => {
      buffer.metrics = payload.metrics;
      if (payload.sample) buffer.samples.push(payload.sample);
      schedule();
    };
    const onAlert = (payload: SocketAlertPayload) => {
      buffer.alertChanges.push({ action: payload.action, alert: payload.alert });
      schedule();
    };
    const onResync = () => void reload();
    const onStatus = (status: SystemStatus) => store().setStatus(status);
    const onSimulator = (state: SimulatorState) => store().setSimulator(state);
    const onReconnectAttempt = () => store().setConnection('RECONNECTING');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on(SOCKET_EVENTS.EVENT, onEvent);
    socket.on(SOCKET_EVENTS.UPDATE, onUpdate);
    socket.on(SOCKET_EVENTS.METRICS, onMetrics);
    socket.on(SOCKET_EVENTS.ALERT, onAlert);
    socket.on(SOCKET_EVENTS.RECOVERY, onAlert);
    socket.on(SOCKET_EVENTS.RESYNC, onResync);
    socket.on(SOCKET_EVENTS.SYSTEM_STATUS, onStatus);
    socket.on(SOCKET_EVENTS.SIMULATOR_STATE, onSimulator);
    if (socket.connected) onConnect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off(SOCKET_EVENTS.EVENT, onEvent);
      socket.off(SOCKET_EVENTS.UPDATE, onUpdate);
      socket.off(SOCKET_EVENTS.METRICS, onMetrics);
      socket.off(SOCKET_EVENTS.ALERT, onAlert);
      socket.off(SOCKET_EVENTS.RECOVERY, onAlert);
      socket.off(SOCKET_EVENTS.RESYNC, onResync);
      socket.off(SOCKET_EVENTS.SYSTEM_STATUS, onStatus);
      socket.off(SOCKET_EVENTS.SIMULATOR_STATE, onSimulator);
    };
  }, []);
}
