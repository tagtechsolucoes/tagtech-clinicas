import { Body, Controller, Get, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { ReportsService } from './reports.service';
import { RequiresFeature } from '../subscription/feature.decorator';

const uuid = z.string().uuid('Identificador inválido');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');
const pct = z.number().min(0).max(100);
const commissionSchema = z
  .object({
    commissionPct: pct,
    rules: z
      .array(
        z
          .object({
            serviceId: uuid,
            pct: pct.nullable().optional(),
            fixedCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
          })
          .strict()
          .refine(
            (r) => (r.pct == null) !== (r.fixedCents == null),
            'Use porcentagem ou valor fixo',
          ),
      )
      .max(200)
      .default([]),
  })
  .strict();

/** Relatórios e repasse: só dono e gerente. */
@Controller('reports')
@UseGuards(TenantGuard)
@Roles('owner', 'manager')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get('overview')
  overview(@CurrentTenant() ctx: TenantContext, @Query('month') m: string) {
    return this.service.overview(ctx, validate(month, m));
  }

  @RequiresFeature('reports')
  @Get('payouts')
  payouts(@CurrentTenant() ctx: TenantContext, @Query('month') m: string) {
    return this.service.payouts(ctx, validate(month, m));
  }

  @RequiresFeature('reports')
  @Get('commissions')
  commissions(@CurrentTenant() ctx: TenantContext) {
    return this.service.commissions(ctx);
  }

  @RequiresFeature('reports')
  @Put('commissions/:professionalId')
  @Roles('owner')
  save(
    @CurrentTenant() ctx: TenantContext,
    @Param('professionalId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveCommission(ctx, validate(uuid, id), validate(commissionSchema, body));
  }
}
