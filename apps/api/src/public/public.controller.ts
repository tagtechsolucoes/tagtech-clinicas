import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { isHHMM, isYMD } from '@tagtech/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate } from '../common/validate';
import { birthDateField, phoneField } from '../patients/patients.controller';
import { PublicService } from './public.service';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');
const slug = z.string().regex(/^[a-z0-9-]{1,63}$/i, 'Endereço inválido');
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Link inválido');

const slotsQuery = z.object({
  serviceId: uuid,
  date: ymd,
  professionalId: uuid.optional(),
  unitId: uuid.optional(),
});
const daysQuery = z.object({
  serviceId: uuid,
  from: ymd,
  days: z.coerce.number().int().min(1).max(21).default(14),
  professionalId: uuid.optional(),
  unitId: uuid.optional(),
});
const bookSchema = z
  .object({
    serviceId: uuid,
    professionalId: uuid.optional(),
    unitId: uuid.optional(),
    date: ymd,
    time: z.string().refine(isHHMM, 'Horário inválido'),
    name: z
      .string()
      .trim()
      .min(5, 'Informe nome e sobrenome')
      .max(120)
      .refine((n) => n.includes(' '), 'Informe nome e sobrenome'),
    phone: phoneField.refine((p) => p !== '', 'Informe seu WhatsApp com DDD'),
    email: z
      .union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(254)])
      .optional(),
    birthDate: birthDateField.optional(),
    notes: z.string().trim().max(500).optional(),
    // Aceite do uso dos dados para o agendamento (LGPD). Sem ele, não agenda.
    consent: z.literal(true, {
      errorMap: () => ({ message: 'Aceite o uso dos dados para agendar' }),
    }),
  })
  .strict();
const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() }).strict();

/** Site público da clínica. Sem login: quem identifica é o endereço ou o link. */
@Controller('public')
export class PublicController {
  constructor(@Inject(PublicService) private readonly service: PublicService) {}

  @Get('clinics/:slug')
  info(@Param('slug') value: string) {
    return this.service.info(validate(slug, value));
  }

  @Get('clinics/:slug/slots')
  slots(@Param('slug') value: string, @Query() query: unknown) {
    return this.service.slots(validate(slug, value), validate(slotsQuery, query));
  }

  @Get('clinics/:slug/days')
  days(@Param('slug') value: string, @Query() query: unknown) {
    return this.service.days(validate(slug, value), validate(daysQuery, query));
  }

  @Post('clinics/:slug/appointments')
  book(@Param('slug') value: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    const { consent: _c, ...input } = validate(bookSchema, body);
    return this.service.book(validate(slug, value), input, request.ip);
  }

  @Get('appointments/:token')
  manage(@Param('token') value: string) {
    return this.service.manage(validate(token, value));
  }

  @Post('appointments/:token/confirm')
  @HttpCode(200)
  confirm(@Param('token') value: string) {
    return this.service.confirm(validate(token, value));
  }

  @Post('appointments/:token/cancel')
  @HttpCode(200)
  cancel(@Param('token') value: string, @Body() body: unknown) {
    return this.service.cancel(validate(token, value), validate(cancelSchema, body ?? {}).reason);
  }
}
