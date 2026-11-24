import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

export const MEDIA_DIR = Symbol('MEDIA_DIR');
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const NAME = /^[0-9a-f]{32}\.webp$/;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function defaultMediaDir(): string {
  return process.env.MEDIA_DIR ?? join(repoRoot, '.data', 'media');
}

export type ImageKind = 'photo' | 'logo' | 'cover';

const SIZES: Record<ImageKind, { width: number; height: number; fit: 'cover' | 'inside' }> = {
  // Foto de prato: quadrada, para a miniatura e o detalhe usarem o mesmo arquivo.
  photo: { width: 800, height: 800, fit: 'cover' },
  logo: { width: 512, height: 512, fit: 'cover' },
  cover: { width: 1600, height: 900, fit: 'cover' },
};

/**
 * Guarda as imagens do restaurante. Hoje em disco; em produção a mesma interface
 * passa a gravar no S3. Toda imagem é reprocessada antes de ser guardada: isso
 * confirma que o arquivo é mesmo uma imagem, tira metadados (localização da foto,
 * por exemplo) e padroniza tamanho e formato.
 */
@Injectable()
export class MediaService {
  constructor(private readonly dir: string) {}

  async saveImage(input: unknown, kind: ImageKind): Promise<string> {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      throw new BadRequestException('Envie a imagem no corpo da requisição (JPEG, PNG ou WebP)');
    }
    const size = SIZES[kind];
    let output: Buffer;
    try {
      output = await sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' })
        .rotate() // aplica a orientação da câmera antes de descartar os metadados
        .resize({ ...size, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('O arquivo não é uma imagem válida');
    }
    const name = `${randomBytes(16).toString('hex')}.webp`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, name), output);
    return `/media/${name}`;
  }

  /** Apaga uma imagem substituída. Falhar aqui não pode derrubar a requisição. */
  async remove(url: string | null | undefined): Promise<void> {
    const name = url?.replace(/^\/media\//, '');
    if (!name || !NAME.test(name)) return;
    await unlink(join(this.dir, name)).catch(() => {});
  }

  async open(name: string) {
    // O formato fixo do nome impede sair da pasta (nada de "../").
    if (!NAME.test(name)) throw new NotFoundException();
    const path = join(this.dir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();
    return { stream: createReadStream(path), size: info.size };
  }
}
