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
import { isYMD, PAY_METHODS } from '@tagtech/domain';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { ResultsService } from '../results/results.service';
import { StockService } from './stock.service';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');
const qty = z.number().positive('Quantidade inválida').max(1_000_000).multipleOf(0.001);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');

const supplierSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(120),
    contact: z.string().trim().max(120).default(''),
    whatsapp: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length === 0 || (v.length >= 10 && v.length <= 13), 'WhatsApp inválido')
      .default(''),
    email: z
      .union([z.literal(''), z.string().trim().email('E-mail inválido').max(254)])
      .default(''),
    leadTimeDays: z.number().int().min(0).max(90).default(2),
    notes: z.string().trim().max(500).default(''),
    active: z.boolean().optional(),
  })
  .strict();

const itemFields = {
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  category: z.string().trim().max(60).default(''),
  unit: z.string().trim().min(1).max(20).default('unidade'),
  purchaseUnit: z.string().trim().min(1).max(20).default('unidade'),
  unitsPerPurchase: qty.default(1),
  minQty: z.number().min(0).max(1_000_000).default(0),
  supplierId: uuid.nullable().default(null),
  openValidityDays: z.number().int().min(1).max(365).nullable().default(null),
  costCents: z.number().int().min(0).max(100_000_000).optional(),
  active: z.boolean().optional(),
};
const itemCreate = z
  .object({
    ...itemFields,
    initialQty: z.number().min(0).max(1_000_000).optional(),
    initialLot: z.string().trim().max(60).optional(),
    initialExpiresOn: ymd.nullable().optional(),
  })
  .strict();
const itemPatch = z
  .object({
    name: itemFields.name,
    category: z.string().trim().max(60),
    unit: z.string().trim().min(1).max(20),
    purchaseUnit: z.string().trim().min(1).max(20),
    unitsPerPurchase: qty,
    minQty: z.number().min(0).max(1_000_000),
    supplierId: uuid.nullable(),
    openValidityDays: z.number().int().min(1).max(365).nullable(),
    costCents: z.number().int().min(0).max(100_000_000),
    active: z.boolean(),
  })
  .partial()
  .strict();
const purchaseSchema = z
  .object({
    supplierId: uuid.nullable().default(null),
    invoice: z.string().trim().max(60).default(''),
    receivedOn: ymd,
    items: z
      .array(
        z
          .object({
            itemId: uuid,
            purchaseQty: qty,
            unitPriceCents: z.number().int().min(0).max(100_000_000),
            lot: z.string().trim().max(60).default(''),
            expiresOn: ymd.nullable().default(null),
          })
          .strict(),
      )
      .min(1, 'Inclua ao menos um material')
      .max(100),
    expense: z
      .object({ dueDate: ymd, paid: z.object({ method: z.enum(PAY_METHODS) }).optional() })
      .strict()
      .optional(),
    orderId: uuid.optional(),
  })
  .strict();
const outSchema = z
  .object({
    kind: z.enum(['loss', 'expired', 'manual']),
    qty,
    reason: z.string().trim().min(3, 'Informe o motivo').max(200),
    lotId: uuid.optional(),
  })
  .strict();
const orderSchema = z
  .object({
    supplierId: uuid.nullable(),
    items: z
      .array(z.object({ itemId: uuid, purchaseQty: qty }).strict())
      .min(1)
      .max(100),
  })
  .strict();
const materialsSchema = z.array(z.object({ itemId: uuid, qty }).strict()).max(50);

/** Estoque, fornecedores e painel do resultado. */
@Controller()
@UseGuards(TenantGuard)
export class StockController {
  constructor(
    @Inject(StockService) private readonly stock: StockService,
    @Inject(ResultsService) private readonly results: ResultsService,
  ) {}

  @Get('suppliers')
  @Roles('owner', 'manager', 'reception')
  suppliers(@CurrentTenant() ctx: TenantContext) {
    return this.stock.listSuppliers(ctx);
  }

  @Post('suppliers')
  @Roles('owner', 'manager', 'reception')
  createSupplier(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.stock.createSupplier(ctx, validate(supplierSchema, body));
  }

  @Patch('suppliers/:id')
  @Roles('owner', 'manager', 'reception')
  updateSupplier(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.stock.updateSupplier(
      ctx,
      validate(uuid, id),
      validate(supplierSchema.partial(), body),
    );
  }

  @Get('stock')
  @Roles('owner', 'manager', 'reception', 'professional')
  overview(@CurrentTenant() ctx: TenantContext) {
    return this.stock.overview(ctx);
  }

  @Post('stock/items')
  @Roles('owner', 'manager', 'reception')
  createItem(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.stock.createItem(ctx, validate(itemCreate, body));
  }

  @Patch('stock/items/:id')
  @Roles('owner', 'manager', 'reception')
  updateItem(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.stock.updateItem(ctx, validate(uuid, id), validate(itemPatch, body));
  }

  @Get('stock/items/:id/moves')
  @Roles('owner', 'manager', 'reception', 'professional')
  moves(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.stock.moves(ctx, validate(uuid, id));
  }

  @Post('stock/items/:id/out')
  @HttpCode(204)
  @Roles('owner', 'manager', 'reception', 'professional')
  async out(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    await this.stock.manualOut(ctx, validate(uuid, id), validate(outSchema, body));
  }

  @Post('stock/items/:id/count')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  count(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const { counted } = validate(
      z.object({ counted: z.number().min(0).max(1_000_000).multipleOf(0.001) }).strict(),
      body,
    );
    return this.stock.count(ctx, validate(uuid, id), counted);
  }

  @Post('stock/purchases')
  @Roles('owner', 'manager', 'reception')
  purchase(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.stock.purchase(ctx, validate(purchaseSchema, body));
  }

  @Get('stock/shopping')
  @Roles('owner', 'manager', 'reception')
  shopping(@CurrentTenant() ctx: TenantContext) {
    return this.stock.shopping(ctx);
  }

  @Get('stock/orders')
  @Roles('owner', 'manager', 'reception')
  orders(@CurrentTenant() ctx: TenantContext) {
    return this.stock.listOrders(ctx);
  }

  @Post('stock/orders')
  @Roles('owner', 'manager', 'reception')
  createOrder(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.stock.createOrder(ctx, validate(orderSchema, body));
  }

  @Delete('stock/orders/:id')
  @HttpCode(204)
  @Roles('owner', 'manager', 'reception')
  async cancelOrder(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.stock.cancelOrder(ctx, validate(uuid, id));
  }

  @Get('stock/check')
  @Roles('owner', 'manager', 'reception', 'professional')
  check(@CurrentTenant() ctx: TenantContext, @Query() q: unknown) {
    const { serviceId, startsAt } = validate(
      z.object({ serviceId: uuid, startsAt: z.coerce.date() }),
      q,
    );
    return this.stock.check(ctx, serviceId, startsAt);
  }

  @Get('stock/report')
  @Roles('owner', 'manager')
  report(@CurrentTenant() ctx: TenantContext, @Query('month') m: string) {
    return this.stock.report(ctx, validate(month, m));
  }

  @Get('services/:id/materials')
  @Roles('owner', 'manager', 'reception', 'professional')
  serviceMaterials(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.stock.serviceMaterials(ctx, validate(uuid, id));
  }

  @Put('services/:id/materials')
  @Roles('owner', 'manager')
  setServiceMaterials(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.stock.setServiceMaterials(ctx, validate(uuid, id), validate(materialsSchema, body));
  }

  @Get('appointments/:id/materials')
  @Roles('owner', 'manager', 'reception', 'professional')
  appointmentMaterials(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.stock.appointmentMaterials(ctx, validate(uuid, id));
  }

  @Post('appointments/:id/materials')
  @Roles('owner', 'manager', 'professional')
  addMaterial(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const b = validate(z.object({ itemId: uuid, qty }).strict(), body);
    return this.stock.addToAppointment(ctx, validate(uuid, id), b.itemId, b.qty);
  }

  @Get('results')
  @Roles('owner', 'manager')
  resultsMonth(@CurrentTenant() ctx: TenantContext, @Query('month') m: string) {
    return this.results.month(ctx, validate(month, m));
  }
}
