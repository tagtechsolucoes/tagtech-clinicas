import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { isYMD } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { PackagesService } from './packages.service';
import { RequiresFeature } from '../subscription/feature.decorator';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');
const createSchema = z
  .object({
    serviceId: uuid,
    title: z.string().trim().max(120).optional(),
    totalSessions: z.number().int().min(1).max(200),
    priceCents: z.number().int().min(0).max(100_000_000).default(0),
    noShowCounts: z.boolean().default(true),
    validUntil: ymd.nullable().optional(),
    notes: z.string().trim().max(500).default(''),
    charge: z
      .object({ installments: z.number().int().min(1).max(24), firstDueDate: ymd.optional() })
      .strict()
      .optional(),
  })
  .strict();

/** Pacotes de sessões do paciente. */
@Controller()
@UseGuards(TenantGuard)
@Roles('owner', 'manager', 'reception', 'professional')
@RequiresFeature('packages')
export class PackagesController {
  constructor(@Inject(PackagesService) private readonly service: PackagesService) {}

  @Get('patients/:id/packages')
  list(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.list(ctx, validate(uuid, id));
  }

  @Post('patients/:id/packages')
  @Roles('owner', 'manager', 'reception')
  create(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.create(ctx, validate(uuid, id), validate(createSchema, body));
  }

  @Get('packages/ending')
  ending(@CurrentTenant() ctx: TenantContext) {
    return this.service.endingSoon(ctx);
  }

  @Post('packages/:id/cancel')
  @HttpCode(200)
  @Roles('owner', 'manager')
  cancel(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.cancel(ctx, validate(uuid, id));
  }
}
