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
}
