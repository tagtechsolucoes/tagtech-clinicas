import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

const config: NextConfig = {
  // Os pacotes internos são TypeScript puro; o Next compila junto com o app.
  transpilePackages: ['@tagtech/domain'],
  // O navegador fala só com este app. O /api é repassado para a API, o que dispensa
  // CORS e mantém cookies e chamadas na mesma origem.
  // O Socket.IO chama /api/ws/ com barra no fim; sem isto o Next responderia com um
  // redirecionamento e a conexão ao vivo nunca abriria.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default config;
