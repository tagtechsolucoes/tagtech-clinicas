import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Versão do sistema (package.json da raiz), mostrada no rodapé do painel.
const VERSAO = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

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
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  server: { host: true, proxy },
  preview: { host: true, proxy },
});
