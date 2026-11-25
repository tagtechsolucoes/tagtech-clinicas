import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
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

export type ImageKind = 'photo' | 'logo' | 'cover' | 'space';

const SIZES: Record<ImageKind, { width: number; height: number; fit: 'cover' | 'inside' }> = {
  // Foto de prato: quadrada, para a miniatura e o detalhe usarem o mesmo arquivo.
  photo: { width: 800, height: 800, fit: 'cover' },
  logo: { width: 512, height: 512, fit: 'cover' },
  // Capa e fotos do espaço mantêm o formato original; o site recorta conforme o lugar.
  cover: { width: 1600, height: 1600, fit: 'inside' },
  space: { width: 1200, height: 1200, fit: 'inside' },
};

/**
 * Guarda as imagens da clínica. Hoje em disco; em produção a mesma interface
 * passa a gravar no S3. Toda imagem é reprocessada antes de ser guardada: isso
 * confirma que o arquivo é mesmo uma imagem, tira metadados (localização da foto,
 * por exemplo) e padroniza tamanho e formato.
 */
/** Área a esconder, em fração da imagem (0 a 1). */
export interface HideArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

  // ---------------------------------------------------------------- fotos clínicas
  // Ficam numa subpasta que a rota pública não serve (o nome sozinho não abre nada).

  private clinicalDir() {
    return join(this.dir, 'clinico');
  }

  /** Foto clínica: lado maior até 2000 px, sem metadados. Devolve o nome do arquivo. */
  async saveClinical(input: unknown): Promise<string> {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      throw new BadRequestException('Envie a foto no corpo da requisição (JPEG, PNG ou WebP)');
    }
    let output: Buffer;
    try {
      output = await sharp(input, { limitInputPixels: 50_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86 })
        .toBuffer();
    } catch {
      throw new BadRequestException('O arquivo não é uma imagem válida');
    }
    const name = `${randomBytes(16).toString('hex')}.webp`;
    await mkdir(this.clinicalDir(), { recursive: true });
    await writeFile(join(this.clinicalDir(), name), output);
    return name;
  }

  async openClinical(name: string) {
    if (!NAME.test(name)) throw new NotFoundException();
    const path = join(this.clinicalDir(), name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();
    return { stream: createReadStream(path), size: info.size };
  }

  async removeClinical(name: string): Promise<void> {
    if (!NAME.test(name)) return;
    await unlink(join(this.clinicalDir(), name)).catch(() => {});
  }

  /**
   * Cópia pública de uma foto clínica (galeria autorizada). As áreas marcadas (rosto,
   * tatuagem…) saem borradas e pixeladas na cópia; a foto original do prontuário não muda.
   * Devolve a URL pública.
   */
  async publishClinical(name: string, hide: HideArea[] = []): Promise<string> {
    if (!NAME.test(name)) throw new NotFoundException();
    const pub = `${randomBytes(16).toString('hex')}.webp`;
    await mkdir(this.dir, { recursive: true });
    const src = join(this.clinicalDir(), name);
    if (!hide.length) {
      await copyFile(src, join(this.dir, pub));
      return `/media/${pub}`;
    }
    const base = sharp(src);
    const { width = 0, height = 0 } = await base.metadata();
    const camadas = await Promise.all(
      hide.map(async (a) => {
        const left = Math.max(0, Math.floor(a.x * width));
        const top = Math.max(0, Math.floor(a.y * height));
        const w = Math.max(1, Math.min(width - left, Math.ceil(a.w * width)));
        const h = Math.max(1, Math.min(height - top, Math.ceil(a.h * height)));
        // Pixela (reduz e amplia) e depois borra: não dá para reverter e reconhecer.
        const bloco = Math.max(1, Math.round(Math.max(w, h) / 12));
        const pequeno = await sharp(src)
          .extract({ left, top, width: w, height: h })
          .blur(Math.max(3, Math.max(w, h) / 10))
          .resize(Math.max(1, Math.round(w / bloco)), Math.max(1, Math.round(h / bloco)))
          .toBuffer();
        const input = await sharp(pequeno)
          .resize(w, h, { kernel: 'nearest' })
          .blur(Math.max(2, bloco / 2))
          .toBuffer();
        return { input, left, top };
      }),
    );
    await base.composite(camadas).webp({ quality: 85 }).toFile(join(this.dir, pub));
    return `/media/${pub}`;
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
