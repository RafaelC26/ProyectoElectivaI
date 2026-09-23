import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Cliente Socket.IO único. Reconexión automática con espera creciente (1 s → 5 s);
 * mientras reconecta el dashboard muestra "● RECONNECTING".
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });
  }
  return socket;
}
