import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { DocumentsService } from './documents.service';

const uuid = z.string().uuid('Identificador inválido');
const texto = (max: number) => z.string().trim().max(max);

// O conteúdo de cada tipo é fechado: só estes campos vão para o documento.
const prescription = z
  .object({
    items: z
      .array(
        z
          .object({
            name: texto(160).min(1, 'Informe o medicamento'),
            dosage: texto(120).default(''),
            instructions: texto(300).default(''),
            quantity: texto(60).default(''),
          })
          .strict(),
      )
      .min(1, 'Inclua ao menos um item')
      .max(20),
    controlled: z.boolean().default(false),
    notes: texto(600).default(''),
  })
  .strict();
const certificate = z
  .object({
    days: z.number().int().min(0).max(365),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    // CID só com autorização do paciente (Resolução CFM 1.658/2002).
    cid: texto(10).default(''),
    patientAllowedCid: z.boolean().default(false),
    notes: texto(600).default(''),
  })
  .strict()
  .refine(
    (c) => !c.cid || c.patientAllowedCid,
    'O CID só vai no atestado com autorização do paciente',
  );
const declaration = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    start: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido'),
    end: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido'),
    companion: texto(120).default(''),
  })
  .strict();
const examRequest = z
  .object({
    exams: z.array(texto(160).min(1)).min(1, 'Inclua ao menos um exame').max(40),
    indication: texto(600).default(''),
  })
  .strict();

const mealPlan = z
  .object({
    meals: z
      .array(
        z
          .object({
            time: z
              .string()
              .regex(/^\d{2}:\d{2}$/, 'Horário inválido')
              .or(z.literal(''))
              .default(''),
            name: texto(60).min(1, 'Dê um nome à refeição'),
            items: z.array(texto(200).min(1)).min(1, 'Inclua ao menos um alimento').max(30),
          })
          .strict(),
      )
      .min(1, 'Inclua ao menos uma refeição')
      .max(12),
    water: texto(60).default(''),
    notes: texto(1000).default(''),
  })
  .strict();

const createSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('meal_plan'), content: mealPlan }),
    z.object({ kind: z.literal('prescription'), content: prescription }),
    z.object({ kind: z.literal('certificate'), content: certificate }),
    z.object({ kind: z.literal('declaration'), content: declaration }),
    z.object({ kind: z.literal('exam_request'), content: examRequest }),
  ])
  .and(z.object({ professionalId: uuid.optional(), appointmentId: uuid.optional() }));

/** Documentos clínicos: como o prontuário, a recepção não vê. */
@Controller()
@UseGuards(TenantGuard)
@Roles('owner', 'manager', 'professional')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly service: DocumentsService) {}

  @Get('patients/:id/documents')
  list(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.list(ctx, validate(uuid, id));
  }

  @Post('patients/:id/documents')
  create(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const b = validate(createSchema, body);
    return this.service.create(ctx, validate(uuid, id), {
      kind: b.kind,
      content: b.content as Record<string, unknown>,
      professionalId: b.professionalId,
      appointmentId: b.appointmentId,
    });
  }

  @Get('documents/:id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.get(ctx, validate(uuid, id));
  }
}
