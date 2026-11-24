import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { isYMD, normalizeCpf, normalizePhoneBR } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { PatientsService } from './patients.service';

const uuid = z.string().uuid('Identificador inválido');

export const phoneField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return '';
    const n = normalizePhoneBR(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o WhatsApp com DDD' });
    return n ?? '';
  });
const cpfField = z
  .string()
  .trim()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === '') return null;
    const n = normalizeCpf(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF inválido' });
    return n;
  });
export const birthDateField = z
  .string()
  .nullable()
  .refine(
    (v) =>
      v === null || (isYMD(v) && v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10)),
    'Data de nascimento inválida',
  );

const fields = {
  name: z.string().trim().min(2, 'Informe o nome completo').max(120),
  phone: phoneField,
  email: z.union([
    z.literal(''),
    z.string().trim().toLowerCase().email('E-mail inválido').max(254),
  ]),
  birthDate: birthDateField,
  cpf: cpfField,
  allergies: z.string().trim().max(500),
  medications: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
};
const createSchema = z.object(fields).partial().required({ name: true }).strict();
const patchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Envie pelo menos um campo para alterar');
const searchSchema = z.object({
  q: z.string().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
// Na importação, linha com telefone ou CPF ruim não derruba o lote: o campo fica vazio.
const importRow = z
  .object({
    name: fields.name,
    phone: z.string().max(40).optional(),
    email: z.string().max(254).optional(),
    birthDate: z.string().max(10).optional(),
    cpf: z.string().max(20).optional(),
    notes: z.string().max(2000).optional(),
  })
  .transform((r) => ({
    name: r.name,
    phone: (r.phone && normalizePhoneBR(r.phone)) || '',
    email:
      r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim())
        ? r.email.trim().toLowerCase()
        : '',
    birthDate: r.birthDate && isYMD(r.birthDate) ? r.birthDate : null,
    cpf: (r.cpf && normalizeCpf(r.cpf)) || null,
    notes: r.notes?.trim() ?? '',
  }));
const importSchema = z.object({ rows: z.array(importRow).min(1).max(5000) });

@Controller('patients')
@UseGuards(TenantGuard)
export class PatientsController {
  constructor(@Inject(PatientsService) private readonly service: PatientsService) {}

  @Get()
  search(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    const { q, limit } = validate(searchSchema, query);
    return this.service.search(ctx, q, limit);
  }

  @Post()
  create(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.create(ctx, validate(createSchema, body));
  }

  @Post('import')
  @Roles('owner', 'manager')
  import(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.import(ctx, validate(importSchema, body).rows);
  }

  @Get(':id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.get(ctx, validate(uuid, id));
  }

  @Patch(':id')
  update(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(ctx, validate(uuid, id), validate(patchSchema, body));
  }

  @Get(':id/access-log')
  @Roles('owner', 'manager')
  accessLog(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.accessLog(ctx, validate(uuid, id));
  }
}
