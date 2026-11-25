import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// O navegador fala só com este app; /api (HTTP e WebSocket) é repassado para a API.
// Em produção o proxy reverso (Caddy) faz o mesmo papel.
const proxy = {
  '/api': {
    target: API_URL,
    changeOrigin: true,
    // Manda o host original (a API confere a origem das escritas com sessão).
    xfwd: true,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, proxy },
  preview: { host: true, proxy },
});
