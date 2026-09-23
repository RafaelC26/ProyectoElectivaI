// Prueba de tiempo real: se conecta a Socket.IO y muestra lo que recibe durante N segundos.
//   node scripts/socket-probe.mjs [url] [segundos]
import { io } from 'socket.io-client';
const url = process.argv[2] ?? 'http://localhost:3000';
const seconds = Number(process.argv[3] ?? 10);
const socket = io(url, { transports: ['websocket'] });
const counts = {};
const latencies = [];
socket.on('connect', () => console.log(`connected ${socket.id}`));
socket.onAny((name, payload) => {
  counts[name] = (counts[name] ?? 0) + 1;
  if (name === 'parking:event' && payload.event.metadata.source === 'SIMULATOR') {
    latencies.push(Date.now() - payload.event.metadata.generated_at);
    if (counts[name] <= 3) console.log(name, payload.event.event_type, payload.event.entity_id, `${payload.event.data.occupied}/${payload.event.data.capacity}`);
  }
  if (name === 'parking:alert' || name === 'parking:recovery') console.log(name, payload.alert.type, payload.alert.zone_id, payload.alert.message);
});
setTimeout(() => {
  latencies.sort((a, b) => a - b);
  console.log('counts', counts);
  if (latencies.length) console.log(`e2e latency ms: p50=${latencies[Math.floor(latencies.length / 2)]} p95=${latencies[Math.floor(latencies.length * 0.95)]} max=${latencies.at(-1)}`);
  socket.close();
}, seconds * 1000);
