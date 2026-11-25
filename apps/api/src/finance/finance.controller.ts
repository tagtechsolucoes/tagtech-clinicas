import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { isTooth, isYMD, PAY_METHODS } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { FinanceService } from './finance.service';
import { PlansService } from './plans.service';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');
const cents = z.number().int().min(0).max(100_000_000);
const method = z.enum(PAY_METHODS);
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Link inválido');

const itemSchema = z
  .object({
    serviceId: uuid.optional(),
    description: z.string().trim().min(1, 'Descreva o item').max(160),
    tooth: z.number().int().refine(isTooth, 'Dente inválido').nullable().optional(),
    quantity: z.number().int().min(1).max(99).default(1),
    unitPriceCents: cents,
  })
  .strict();
export const planSchema = z
  .object({
    title: z.string().trim().min(1, 'Dê um nome ao orçamento').max(120),
    professionalId: uuid.nullable().optional(),
    discountCents: cents.default(0),
    cashDiscountPct: z.number().int().min(0).max(50).default(0),
    maxInstallments: z.number().int().min(1).max(24).default(1),
    notes: z.string().trim().max(2000).default(''),
    validUntil: ymd.nullable().optional(),
    items: z.array(itemSchema).max(60).default([]),
  })
  .strict();
const approveSchema = z
  .object({ installments: z.number().int().min(1).max(24), firstDueDate: ymd.optional() })
  .strict();
const linkSchema = z.object({ appointmentId: uuid.nullable() }).strict();

const chargeSchema = z
  .object({
    patientId: uuid.optional(),
    appointmentId: uuid.optional(),
    description: z.string().trim().min(1, 'Descreva a cobrança').max(160),
    amountCents: cents.refine((v) => v > 0, 'Informe o valor'),
    dueDate: ymd,
  })
  .strict();
const listQuery = z.object({
  status: z.enum(['open', 'paid', 'cancelled']).optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  patientId: uuid.optional(),
});
const paySchema = z.object({ method }).strict();
const expenseSchema = z
  .object({
    description: z.string().trim().min(1, 'Descreva a conta').max(160),
    category: z.string().trim().max(60).default(''),
    supplier: z.string().trim().max(120).default(''),
    amountCents: cents.refine((v) => v > 0, 'Informe o valor'),
    dueDate: ymd,
    paid: z.object({ method }).optional(),
  })
  .strict();
const rangeQuery = z.object({ from: ymd.optional(), to: ymd.optional() });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');
const pixSchema = z
  .object({
    accessToken: z.string().trim().min(10).max(300).optional(),
    depositCents: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

/** Orçamentos e financeiro da clínica. */
@Controller()
@UseGuards(TenantGuard)
export class FinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(PlansService) private readonly plans: PlansService,
  ) {}

  // ------------------------------------------------------------ orçamentos

  @Get('patients/:id/plans')
  @Roles('owner', 'manager', 'reception', 'professional')
  listPlans(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.plans.list(ctx, validate(uuid, id));
  }

  @Post('patients/:id/plans')
  @Roles('owner', 'manager', 'reception', 'professional')
  createPlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.plans.create(ctx, validate(uuid, id), validate(planSchema, body));
  }

  @Get('plans/:id')
  @Roles('owner', 'manager', 'reception', 'professional')
  getPlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.plans.get(ctx, validate(uuid, id));
  }

  @Put('plans/:id')
  @Roles('owner', 'manager', 'reception', 'professional')
  updatePlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.plans.update(ctx, validate(uuid, id), validate(planSchema, body));
  }

  @Post('plans/:id/send')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception', 'professional')
  sendPlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.plans.send(ctx, validate(uuid, id));
  }

  @Post('plans/:id/approve')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  approvePlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.plans.approve(ctx, validate(uuid, id), validate(approveSchema, body));
  }

  @Post('plans/:id/decline')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception', 'professional')
  declinePlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.plans.decline(ctx, validate(uuid, id));
  }

  @Post('plans/:id/cancel')
  @HttpCode(200)
  @Roles('owner', 'manager')
  cancelPlan(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.plans.cancel(ctx, validate(uuid, id));
  }

  @Put('plans/:id/items/:itemId/appointment')
  @Roles('owner', 'manager', 'reception', 'professional')
  linkItem(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.plans.linkItem(
      ctx,
      validate(uuid, id),
      validate(uuid, itemId),
      validate(linkSchema, body).appointmentId,
    );
  }

  // ------------------------------------------------------------ a receber

  @Get('finance/charges')
  @Roles('owner', 'manager', 'reception')
  charges(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    return this.finance.listCharges(ctx, validate(listQuery, query));
  }

  @Post('finance/charges')
  @Roles('owner', 'manager', 'reception')
  createCharge(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.finance.createCharge(ctx, validate(chargeSchema, body));
  }

  @Post('finance/charges/:id/pay')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  pay(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.payCharge(ctx, validate(uuid, id), validate(paySchema, body).method);
  }

  @Post('finance/charges/:id/cancel')
  @HttpCode(200)
  @Roles('owner', 'manager')
  cancelCharge(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.finance.cancelCharge(ctx, validate(uuid, id));
  }

  @Post('finance/charges/:id/reopen')
  @HttpCode(200)
  @Roles('owner', 'manager')
  reopen(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.finance.reopenCharge(ctx, validate(uuid, id));
  }

  @Post('finance/charges/:id/pix')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  chargePix(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.finance.chargePix(ctx, validate(uuid, id));
  }

  @Get('finance/charges/:id/receipt')
  @Roles('owner', 'manager', 'reception')
  receipt(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.finance.receipt(ctx, validate(uuid, id));
  }

  @Get('finance/cashbox')
  @Roles('owner', 'manager', 'reception')
  cashbox(@CurrentTenant() ctx: TenantContext, @Query('day') day: string) {
    return this.finance.cashbox(ctx, validate(ymd, day));
  }

  // ------------------------------------------------------------ a pagar e resumo

  @Get('finance/expenses')
  @Roles('owner', 'manager')
  expenses(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    return this.finance.listExpenses(ctx, validate(rangeQuery, query));
  }

  @Post('finance/expenses')
  @Roles('owner', 'manager')
  createExpense(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.finance.createExpense(ctx, validate(expenseSchema, body));
  }

  @Post('finance/expenses/:id/pay')
  @HttpCode(200)
  @Roles('owner', 'manager')
  payExpense(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.finance.payExpense(ctx, validate(uuid, id), validate(paySchema, body).method);
  }

  @Delete('finance/expenses/:id')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async deleteExpense(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.finance.deleteExpense(ctx, validate(uuid, id));
  }

  @Get('finance/summary')
  @Roles('owner', 'manager')
  summary(@CurrentTenant() ctx: TenantContext, @Query('month') m: string) {
    return this.finance.summary(ctx, validate(month, m));
  }

  // ------------------------------------------------------------ Pix da clínica

  @Get('finance/pix')
  @Roles('owner', 'manager')
  pixSettings(@CurrentTenant() ctx: TenantContext) {
    return this.finance.pixSettings(ctx);
  }

  @Put('finance/pix')
  @Roles('owner')
  savePix(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.finance.savePix(ctx, validate(pixSchema, body));
  }

  @Delete('finance/pix')
  @Roles('owner')
  removePix(@CurrentTenant() ctx: TenantContext) {
    return this.finance.removePix(ctx);
  }
}

/** Partes sem login: link do orçamento e aviso do Pix. */
@Controller('public')
export class PublicFinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(PlansService) private readonly plans: PlansService,
  ) {}

  @Get('plans/:token')
  plan(@Param('token') value: string) {
    return this.plans.publicGet(validate(token, value));
  }

  @Post('plans/:token/approve')
  @HttpCode(200)
  approve(@Param('token') value: string, @Body() body: unknown) {
    const { installments } = validate(
      z.object({ installments: z.number().int().min(1).max(24) }),
      body,
    );
    return this.plans.publicApprove(validate(token, value), installments);
  }

  @Post('plans/:token/decline')
  @HttpCode(200)
  decline(@Param('token') value: string) {
    return this.plans.publicDecline(validate(token, value));
  }

  /** Aviso do Mercado Pago. Conferimos com o provedor antes de dar baixa. */
  @Post('pix/:id')
  @HttpCode(200)
  async webhook(@Param('id') id: string) {
    await this.finance.checkPix(validate(uuid, id)).catch(() => undefined);
    return { ok: true };
  }

  @Get('pix/:id')
  status(@Param('id') id: string) {
    return this.finance.checkPix(validate(uuid, id));
  }

  /** Pix de teste: só fora de produção. */
  @Post('pix/:id/fake-approve')
  @HttpCode(200)
  fakeApprove(@Param('id') id: string) {
    return this.finance.approveFake(validate(uuid, id));
  }
}
