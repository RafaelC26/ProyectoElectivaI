import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

// En desarrollo Vite reenvía /api y /socket.io al backend; en Docker lo hace nginx.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 5173),
    host: true,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
