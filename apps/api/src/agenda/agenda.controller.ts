import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { APPOINTMENT_STATUSES, isYMD } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { phoneField } from '../patients/patients.controller';
import { AgendaService } from './agenda.service';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida (use AAAA-MM-DD)');
const instant = z
  .string()
  .datetime({ offset: true, message: 'Data e hora inválidas' })
  .transform((v) => new Date(v));

const rangeQuery = z
  .object({ from: instant, to: instant, unitId: uuid.optional() })
  .refine((q) => q.from < q.to, 'O fim precisa ser depois do começo')
  .refine(
    (q) => q.to.getTime() - q.from.getTime() <= 62 * 24 * 3600_000,
    'Peça no máximo 62 dias por vez',
  );
const slotsQuery = z.object({
  serviceId: uuid,
  date: ymd,
  professionalId: uuid.optional(),
  unitId: uuid.optional(),
});

const bookSchema = z
  .object({
    patientId: uuid.optional(),
    patient: z
      .object({
        name: z.string().trim().min(2, 'Informe o nome completo').max(120),
        phone: phoneField,
      })
      .optional(),
    serviceId: uuid,
    professionalId: uuid,
    unitId: uuid.optional(),
    roomId: uuid.nullable().optional(),
    startsAt: instant,
    durationMinutes: z.number().int().min(5).max(600).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    allowOutsideHours: z.boolean().optional(),
    packageId: uuid.optional(),
    repeat: z
      .object({
        everyWeeks: z.number().int().min(1).max(4),
        count: z.number().int().min(2).max(52),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (b) => Boolean(b.patientId) !== Boolean(b.patient),
    'Escolha um paciente ou cadastre um novo',
  );

const patchSchema = z
  .object({
    startsAt: instant,
    professionalId: uuid,
    roomId: uuid.nullable(),
    notes: z.string().trim().max(1000),
    priceCents: z.number().int().min(0).max(100_000_000).nullable(),
    allowOutsideHours: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (p) => Object.keys(p).filter((k) => k !== 'allowOutsideHours').length > 0,
    'Nada para alterar',
  );

const statusSchema = z
  .object({ status: z.enum(APPOINTMENT_STATUSES), reason: z.string().trim().max(200).optional() })
  .strict();

const waitlistSchema = z
  .object({
    patientId: uuid,
    serviceId: uuid,
    professionalId: uuid.nullable().default(null),
    unitId: uuid.nullable().default(null),
    fromDate: ymd,
    toDate: ymd,
    period: z.enum(['any', 'morning', 'afternoon', 'evening']).default('any'),
    notes: z.string().trim().max(300).default(''),
  })
  .strict()
  .refine((w) => w.fromDate <= w.toDate, 'A data final precisa ser depois da inicial');
const waitlistStatus = z
  .object({
    status: z.enum(['waiting', 'offered', 'booked', 'cancelled']),
    appointmentId: uuid.optional(),
  })
  .strict();

/** Agenda da clínica: toda a equipe usa. */
@Controller()
@UseGuards(TenantGuard)
export class AgendaController {
  constructor(@Inject(AgendaService) private readonly service: AgendaService) {}

  @Get('agenda')
  agenda(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    const { from, to, unitId } = validate(rangeQuery, query);
    return this.service.agenda(ctx, from, to, unitId);
  }

  @Get('agenda/slots')
  slots(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    return this.service.slots(ctx, validate(slotsQuery, query));
  }

  @Post('appointments')
  @Roles('owner', 'manager', 'reception', 'professional')
  book(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.book(ctx, validate(bookSchema, body));
  }

  @Patch('appointments/:id')
  update(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(ctx, validate(uuid, id), validate(patchSchema, body));
  }

  @Post('appointments/:id/status')
  @HttpCode(200)
  setStatus(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const { status, reason } = validate(statusSchema, body);
    return this.service.setStatus(ctx, validate(uuid, id), status, reason);
  }

  @Post('appointments/:id/cancel-series')
  @HttpCode(200)
  cancelSeries(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { reason } = validate(
      z.object({ reason: z.string().trim().min(3, 'Informe o motivo').max(200) }).strict(),
      body,
    );
    return this.service.cancelSeries(ctx, validate(uuid, id), reason);
  }

  @Post('appointments/:id/link')
  @HttpCode(200)
  link(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.newManageLink(ctx, validate(uuid, id));
  }

  @Get('appointments/:id/history')
  history(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.history(ctx, validate(uuid, id));
  }

  @Get('appointments/:id/waitlist')
  matches(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.waitlistMatches(ctx, validate(uuid, id));
  }

  @Get('waitlist')
  waitlist(@CurrentTenant() ctx: TenantContext) {
    return this.service.listWaitlist(ctx);
  }

  @Post('waitlist')
  addToWaitlist(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.addToWaitlist(ctx, validate(waitlistSchema, body));
  }

  @Patch('waitlist/:id')
  setWaitlistStatus(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { status, appointmentId } = validate(waitlistStatus, body);
    return this.service.setWaitlistStatus(ctx, validate(uuid, id), status, appointmentId);
  }
}
