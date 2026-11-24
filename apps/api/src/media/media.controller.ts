import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MediaService } from './media.service';

/** Entrega pública das imagens. Os nomes são aleatórios e o conteúdo nunca muda. */
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get(':name')
  async get(@Param('name') name: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const { stream, size } = await this.media.open(name);
    reply.headers({
      'content-type': 'image/webp',
      'content-length': size,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    return new StreamableFile(stream);
  }
}
