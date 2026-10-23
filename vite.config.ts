import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    // In production nginx serves /api from the same origin; in dev, forward it
    // to the live server (override with API_PROXY_TARGET, e.g. a local
    // server/nowplaying on http://127.0.0.1:3100).
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'https://radio.recepguzel.com',
        changeOrigin: true,
      },
    },
  },
});
