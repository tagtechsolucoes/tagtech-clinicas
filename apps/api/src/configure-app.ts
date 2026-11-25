import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IMAGE_CONTENT_TYPES, MAX_UPLOAD_BYTES } from './media/media.service';

/** Ajustes do servidor HTTP usados tanto pela API de verdade quanto pelos testes. */
export function configureApp(app: NestFastifyApplication): void {
  // Upload de imagem vem como corpo binário puro (sem multipart), com teto de tamanho.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
      IMAGE_CONTENT_TYPES,
      { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
      (_request, body, done) => done(null, body),
    );

  // Painel e site são subdomínios do mesmo domínio ("mesmo site" para o navegador), então o
  // SameSite=Lax do cookie não separa os dois. Escrita com sessão só vale vinda da mesma origem.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
      if (!/(^|;\s*)tt_session=/.test(request.headers.cookie ?? '')) return;
      const origin = request.headers.origin;
      if (!origin) return;
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        host = '';
      }
      const proprio = request.headers['x-forwarded-host'] ?? request.headers.host;
      if (host !== proprio) {
        await reply.code(403).send({ message: 'Origem não permitida' });
      }
    });
}
