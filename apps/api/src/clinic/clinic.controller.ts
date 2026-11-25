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
  UseGuards,
} from '@nestjs/common';
import { DISPLAY_FONTS, normalizePhoneBR, RECORD_KINDS } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { ClinicService } from './clinic.service';

const uuid = z.string().uuid('Identificador inválido');
const color = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use uma cor no formato #rrggbb');
/** Telefone opcional: vazio apaga; senão precisa ser um número brasileiro com DDD. */
const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return '';
    const n = normalizePhoneBR(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o telefone com DDD' });
    return n ?? '';
  });
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido');
const nonEmpty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .strict()
    .refine((p) => Object.keys(p).length > 0, 'Envie pelo menos um campo para alterar');

const clinicSchema = nonEmpty({
  name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(120),
  about: z.string().trim().max(1200),
  whatsapp: phone,
  instagram: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^@/, ''))
    .pipe(z.string().regex(/^[a-z0-9._]{0,30}$/, 'Instagram inválido')),
  primaryColor: color,
  accentColor: color,
  displayFont: z.enum(DISPLAY_FONTS),
  bookingEnabled: z.boolean(),
  minNoticeMinutes: z.number().int().min(0).max(10080),
  horizonDays: z.number().int().min(1).max(365),
  slotStepMinutes: z.union([
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(20),
    z.literal(30),
    z.literal(60),
  ]),
});

const unitFields = {
  name: z.string().trim().min(1).max(120),
  timezone,
  address: z.string().trim().max(300),
  phone,
  active: z.boolean(),
};
const unitCreate = z.object(unitFields).partial().required({ name: true }).strict();
const unitPatch = nonEmpty(unitFields);

const roomCreate = z.object({ unitId: uuid, name: z.string().trim().min(1).max(60) }).strict();
const roomPatch = nonEmpty({ name: z.string().trim().min(1).max(60), active: z.boolean() });

const proFields = {
  name: z.string().trim().min(1).max(120),
  specialty: z.string().trim().max(80),
  council: z.string().trim().max(40),
  bio: z.string().trim().max(600),
  color,
  onlineBooking: z.boolean(),
  active: z.boolean(),
  membershipId: uuid.nullable(),
  recordKind: z.enum(RECORD_KINDS),
};
const proCreate = z.object(proFields).partial().required({ name: true }).strict();
const proPatch = nonEmpty(proFields);

const hoursSchema = z
  .array(
    z
      .object({
        unitId: uuid,
        weekday: z.number().int().min(0).max(6),
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
      })
      .refine((h) => h.start < h.end, 'O turno precisa terminar depois de começar'),
  )
  .max(70);

const serviceFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  category: z.string().trim().max(60),
  durationMinutes: z.number().int().min(5).max(600),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  color,
  onlineBooking: z.boolean(),
  active: z.boolean(),
  professionalIds: z.array(uuid).max(200),
};
const serviceCreate = z
  .object(serviceFields)
  .partial()
  .required({ name: true, durationMinutes: true })
  .strict();
const servicePatch = nonEmpty(serviceFields);

const isoDate = z
  .string()
  .datetime({ offset: true, message: 'Data e hora inválidas' })
  .transform((v) => new Date(v));
const timeOffCreate = z
  .object({
    professionalId: uuid.nullable().default(null),
    unitId: uuid.nullable().default(null),
    startsAt: isoDate,
    endsAt: isoDate,
    reason: z.string().trim().max(120).default(''),
  })
  .strict()
  .refine((t) => t.startsAt < t.endsAt, 'O bloqueio precisa terminar depois de começar');
const rangeQuery = z.object({ from: isoDate, to: isoDate });

/** Cadastro da clínica. Todo mundo da equipe lê; dono e gerente alteram. */
@Controller()
@UseGuards(TenantGuard)
export class ClinicController {
  constructor(@Inject(ClinicService) private readonly service: ClinicService) {}

  @Get('clinic')
  get(@CurrentTenant() ctx: TenantContext) {
    return this.service.get(ctx);
  }

  @Patch('clinic')
  @Roles('owner', 'manager')
  update(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.update(ctx, validate(clinicSchema, body));
  }

  @Put('clinic/logo')
  @Roles('owner', 'manager')
  setLogo(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.setBrandImage(ctx, 'logo', body);
  }

  @Delete('clinic/logo')
  @Roles('owner', 'manager')
  removeLogo(@CurrentTenant() ctx: TenantContext) {
    return this.service.setBrandImage(ctx, 'logo', null);
  }

  @Put('clinic/cover')
  @Roles('owner', 'manager')
  setCover(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.setBrandImage(ctx, 'cover', body);
  }

  @Delete('clinic/cover')
  @Roles('owner', 'manager')
  removeCover(@CurrentTenant() ctx: TenantContext) {
    return this.service.setBrandImage(ctx, 'cover', null);
  }

  // ------------------------------------------------------------ unidades e salas

  @Post('units')
  @Roles('owner')
  createUnit(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.createUnit(ctx, validate(unitCreate, body));
  }

  @Patch('units/:id')
  @Roles('owner', 'manager')
  updateUnit(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.updateUnit(ctx, validate(uuid, id), validate(unitPatch, body));
  }

  @Get('rooms')
  rooms(@CurrentTenant() ctx: TenantContext) {
    return this.service.listRooms(ctx);
  }

  @Post('rooms')
  @Roles('owner', 'manager')
  createRoom(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.createRoom(ctx, validate(roomCreate, body));
  }

  @Patch('rooms/:id')
  @Roles('owner', 'manager')
  updateRoom(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.updateRoom(ctx, validate(uuid, id), validate(roomPatch, body));
  }

  // ------------------------------------------------------------ profissionais

  @Get('professionals')
  professionals(@CurrentTenant() ctx: TenantContext) {
    return this.service.listProfessionals(ctx);
  }

  @Post('professionals')
  @Roles('owner', 'manager')
  createProfessional(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.createProfessional(ctx, validate(proCreate, body));
  }

  @Patch('professionals/:id')
  @Roles('owner', 'manager')
  updateProfessional(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateProfessional(ctx, validate(uuid, id), validate(proPatch, body));
  }

  @Put('professionals/:id/hours')
  @Roles('owner', 'manager')
  setHours(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.setHours(ctx, validate(uuid, id), validate(hoursSchema, body));
  }

  @Put('professionals/:id/photo')
  @Roles('owner', 'manager')
  setPhoto(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.setProfessionalPhoto(ctx, validate(uuid, id), body);
  }

  @Delete('professionals/:id/photo')
  @Roles('owner', 'manager')
  removePhoto(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.setProfessionalPhoto(ctx, validate(uuid, id), null);
  }

  // ------------------------------------------------------------ serviços

  @Get('services')
  services(@CurrentTenant() ctx: TenantContext) {
    return this.service.listServices(ctx);
  }

  @Post('services')
  @Roles('owner', 'manager')
  createService(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.createService(ctx, validate(serviceCreate, body));
  }

  @Patch('services/:id')
  @Roles('owner', 'manager')
  updateService(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateService(ctx, validate(uuid, id), validate(servicePatch, body));
  }

  // ------------------------------------------------------------ bloqueios

  @Get('time-off')
  timeOff(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    const { from, to } = validate(rangeQuery, query);
    return this.service.listTimeOff(ctx, from, to);
  }

  @Post('time-off')
  @Roles('owner', 'manager', 'reception')
  createTimeOff(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.createTimeOff(ctx, validate(timeOffCreate, body));
  }

  @Delete('time-off/:id')
  @HttpCode(204)
  @Roles('owner', 'manager', 'reception')
  async deleteTimeOff(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.service.deleteTimeOff(ctx, validate(uuid, id));
  }
}
