import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { isTooth, isYMD, RECORD_KINDS, TOOTH_STATES } from '@tagtech/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { RecordsService } from './records.service';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');

const noteCreate = z
  .object({
    kind: z.enum(RECORD_KINDS),
    data: z.record(z.unknown()).default({}),
    text: z.string().max(10000).default(''),
    appointmentId: uuid.optional(),
    private: z.boolean().optional(),
    addendumOf: uuid.optional(),
  })
  .strict();
const notePatch = z
  .object({ data: z.record(z.unknown()), text: z.string().max(10000), private: z.boolean() })
  .partial()
  .strict();
const toothSchema = z
  .object({ state: z.enum(TOOTH_STATES).nullable(), note: z.string().trim().max(200).default('') })
  .strict();
const photoFields = {
  stage: z.enum(['before', 'during', 'after']),
  region: z.string().trim().max(60),
  angle: z.string().trim().max(40),
  takenOn: ymd,
  note: z.string().trim().max(300),
};
const photoQuery = z
  .object({ ...photoFields, appointmentId: uuid })
  .partial()
  .required({ stage: true })
  .transform((q) => ({ ...q, region: q.region ?? '', angle: q.angle ?? '', note: q.note ?? '' }));
const photoPatch = z.object(photoFields).partial().strict();
const consentSchema = z
  .object({
    scope: z.enum(['site', 'social', 'both']),
    signedOn: ymd,
    termText: z.string().max(4000).optional(),
  })
  .strict();
const publishSchema = z
  .object({
    beforePhotoId: uuid,
    afterPhotoId: uuid,
    title: z.string().trim().min(1).max(80),
    serviceId: uuid.optional(),
  })
  .strict();

/**
 * Prontuário e fotos clínicas. A recepção não vê: só dono, gerente e profissionais.
 */
@Controller()
@UseGuards(TenantGuard)
@Roles('owner', 'manager', 'professional')
export class RecordsController {
  constructor(@Inject(RecordsService) private readonly service: RecordsService) {}

  @Get('patients/:id/notes')
  notes(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.notes(ctx, validate(uuid, id));
  }

  @Post('patients/:id/notes')
  createNote(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.createNote(ctx, validate(uuid, id), validate(noteCreate, body));
  }

  @Patch('notes/:id')
  updateNote(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.updateNote(ctx, validate(uuid, id), validate(notePatch, body));
  }

  @Post('notes/:id/lock')
  @HttpCode(200)
  lock(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.lockNote(ctx, validate(uuid, id));
  }

  @Get('patients/:id/teeth')
  teeth(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.teeth(ctx, validate(uuid, id));
  }

  @Put('patients/:id/teeth/:tooth')
  setTooth(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Param('tooth') tooth: string,
    @Body() body: unknown,
  ) {
    const n = validate(
      z.coerce.number().int().refine(isTooth, 'Dente inválido (use a numeração FDI)'),
      tooth,
    );
    const { state, note } = validate(toothSchema, body);
    return this.service.setTooth(ctx, validate(uuid, id), n, state, note);
  }

  @Get('patients/:id/photos')
  photos(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.photos(ctx, validate(uuid, id));
  }

  /** A foto vem como corpo binário (JPEG, PNG ou WebP); os dados, na query. */
  @Put('patients/:id/photos')
  addPhoto(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    return this.service.addPhoto(ctx, validate(uuid, id), body, validate(photoQuery, query));
  }

  @Patch('photos/:id')
  updatePhoto(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.updatePhoto(ctx, validate(uuid, id), validate(photoPatch, body));
  }

  @Delete('photos/:id')
  @HttpCode(204)
  async deletePhoto(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.service.deletePhoto(ctx, validate(uuid, id));
  }

  @Get('photos/:id/file')
  async photoFile(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { stream, size } = await this.service.photoFile(ctx, validate(uuid, id));
    reply.headers({
      'content-type': 'image/webp',
      'content-length': size,
      // Foto clínica: nada de cache compartilhado.
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  @Get('patients/:id/image-consent')
  consent(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.consent(ctx, validate(uuid, id));
  }

  @Post('patients/:id/image-consent')
  recordConsent(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.recordConsent(ctx, validate(uuid, id), validate(consentSchema, body));
  }

  @Delete('patients/:id/image-consent')
  revokeConsent(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.revokeConsent(ctx, validate(uuid, id));
  }

  @Get('gallery')
  gallery(@CurrentTenant() ctx: TenantContext) {
    return this.service.gallery(ctx);
  }

  @Post('gallery')
  @Roles('owner', 'manager')
  publish(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.publish(ctx, validate(publishSchema, body));
  }

  @Delete('gallery/:id')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async unpublish(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.service.unpublish(ctx, validate(uuid, id));
  }
}
