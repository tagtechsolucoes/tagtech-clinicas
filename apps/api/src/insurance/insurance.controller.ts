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
  UseGuards,
} from '@nestjs/common';
import { isYMD } from '@tagtech/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { NfseService } from '../nfse/nfse.service';
import { InsuranceService } from './insurance.service';
import { RequiresFeature } from '../subscription/feature.decorator';

const uuid = z.string().uuid('Identificador inválido');
const ymd = z.string().refine(isYMD, 'Data inválida');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');
const cents = z.number().int().min(0).max(100_000_000);

const insurerSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(120),
    ansCode: z
      .string()
      .regex(/^(\d{6})?$/, 'Registro ANS tem 6 dígitos')
      .default(''),
    providerCode: z.string().trim().max(20).default(''),
    paymentDays: z.number().int().min(0).max(180).default(30),
    showOnSite: z.boolean().default(true),
    active: z.boolean().optional(),
  })
  .strict();
const pricesSchema = z
  .array(
    z
      .object({
        serviceId: uuid,
        priceCents: cents,
        copayCents: cents.default(0),
        tussCode: z
          .string()
          .regex(/^(\d{8})?$/, 'Código TUSS tem 8 dígitos')
          .default(''),
        needsAuthorization: z.boolean().default(false),
      })
      .strict(),
  )
  .max(300);
const cardSchema = z
  .object({
    cardNumber: z.string().trim().min(1, 'Informe a carteirinha').max(30),
    planName: z.string().trim().max(60).default(''),
    validUntil: ymd.nullable().default(null),
  })
  .strict();
const authSchema = z
  .object({
    insurerId: uuid,
    serviceId: uuid,
    guideNumber: z.string().trim().min(1, 'Informe o número da guia').max(20),
    password: z.string().trim().max(20).default(''),
    validUntil: ymd.nullable().default(null),
    sessions: z.number().int().min(1).max(200).default(1),
  })
  .strict();
const receiveSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            claimId: uuid,
            paidCents: cents,
            glosaReason: z.string().trim().max(200).default(''),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
const fiscalSchema = z
  .object({
    environment: z.enum(['homologacao', 'producao']),
    token: z.string().trim().min(10).max(200).optional(),
    standard: z.enum(['nacional', 'municipal']).default('nacional'),
    cnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length === 14, 'CNPJ inválido'),
    municipalRegistration: z.string().trim().max(20).default(''),
    cityCode: z.string().regex(/^\d{7}$/, 'Código IBGE do município tem 7 dígitos'),
    serviceCode: z.string().trim().min(1, 'Informe o código do serviço').max(20),
    municipalServiceCode: z.string().trim().max(20).default(''),
    issRate: z.number().min(0).max(10).default(0),
    simplesOption: z.number().int().min(1).max(3).default(3),
    description: z.string().trim().min(1).max(500).default('Serviços de saúde'),
    autoEmit: z.boolean().default(false),
  })
  .strict();

/** Convênios e nota fiscal de serviço. */
@Controller()
@UseGuards(TenantGuard)
@RequiresFeature('insurance')
export class InsuranceController {
  constructor(
    @Inject(InsuranceService) private readonly insurance: InsuranceService,
    @Inject(NfseService) private readonly nfse: NfseService,
  ) {}

  @Get('insurers')
  @Roles('owner', 'manager', 'reception', 'professional')
  list(@CurrentTenant() ctx: TenantContext) {
    return this.insurance.list(ctx);
  }

  @Post('insurers')
  @Roles('owner', 'manager')
  create(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.insurance.create(ctx, validate(insurerSchema, body));
  }

  @Patch('insurers/:id')
  @Roles('owner', 'manager')
  update(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.insurance.update(ctx, validate(uuid, id), validate(insurerSchema.partial(), body));
  }

  @Put('insurers/:id/prices')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async prices(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.insurance.setPrices(ctx, validate(uuid, id), validate(pricesSchema, body));
  }

  @Put('insurers/:id/professionals')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async professionals(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.insurance.setProfessionals(
      ctx,
      validate(uuid, id),
      validate(z.array(uuid).max(200), body),
    );
  }

  @Get('patients/:id/insurance')
  @Roles('owner', 'manager', 'reception', 'professional')
  cards(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.insurance.patientCards(ctx, validate(uuid, id));
  }

  @Put('patients/:id/insurance/:insurerId')
  @Roles('owner', 'manager', 'reception')
  setCard(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Param('insurerId') insurerId: string,
    @Body() body: unknown,
  ) {
    return this.insurance.setCard(
      ctx,
      validate(uuid, id),
      validate(uuid, insurerId),
      validate(cardSchema, body),
    );
  }

  @Delete('patients/:id/insurance/:insurerId')
  @Roles('owner', 'manager', 'reception')
  removeCard(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Param('insurerId') insurerId: string,
  ) {
    return this.insurance.removeCard(ctx, validate(uuid, id), validate(uuid, insurerId));
  }

  @Post('patients/:id/authorizations')
  @Roles('owner', 'manager', 'reception')
  addAuth(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.insurance.addAuthorization(ctx, validate(uuid, id), validate(authSchema, body));
  }

  @Delete('authorizations/:id')
  @HttpCode(204)
  @Roles('owner', 'manager', 'reception')
  async removeAuth(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    await this.insurance.removeAuthorization(ctx, validate(uuid, id));
  }

  @Put('appointments/:id/insurance')
  @Roles('owner', 'manager', 'reception')
  setAppointment(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = validate(
      z
        .object({ insurerId: uuid.nullable(), authorizationId: uuid.nullable().default(null) })
        .strict(),
      body,
    );
    return this.insurance.setAppointmentInsurance(
      ctx,
      validate(uuid, id),
      b.insurerId,
      b.insurerId ? b.authorizationId : null,
    );
  }

  @Get('insurance/billing')
  @Roles('owner', 'manager', 'reception')
  billing(@CurrentTenant() ctx: TenantContext, @Query('competence') c: string) {
    return this.insurance.billing(ctx, validate(month, c));
  }

  @Post('insurance/batches')
  @Roles('owner', 'manager', 'reception')
  createBatch(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    const b = validate(z.object({ insurerId: uuid, competence: month }).strict(), body);
    return this.insurance.createBatch(ctx, b.insurerId, b.competence);
  }

  @Get('insurance/batches/:id')
  @Roles('owner', 'manager', 'reception')
  batch(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.insurance.getBatch(ctx, validate(uuid, id));
  }

  @Get('insurance/batches/:id/tiss')
  @Roles('owner', 'manager', 'reception')
  async tiss(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const { fileName, xml } = await this.insurance.tiss(ctx, validate(uuid, id));
    void reply
      .header('content-type', 'application/xml; charset=ISO-8859-1')
      .header('content-disposition', `attachment; filename="${fileName}"`)
      .send(Buffer.from(xml, 'latin1'));
  }

  @Post('insurance/batches/:id/send')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  send(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.insurance.sendBatch(ctx, validate(uuid, id));
  }

  @Post('insurance/batches/:id/receive')
  @HttpCode(200)
  @Roles('owner', 'manager')
  receive(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.insurance.receiveBatch(
      ctx,
      validate(uuid, id),
      validate(receiveSchema, body).items,
    );
  }

  @Post('insurance/claims/:id/rebill')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  rebill(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.insurance.rebill(ctx, validate(uuid, id));
  }

  @Get('insurance/report')
  @Roles('owner', 'manager')
  report(@CurrentTenant() ctx: TenantContext) {
    return this.insurance.report(ctx);
  }

  // ------------------------------------------------------------ NFS-e

  @RequiresFeature('nfse')
  @Get('nfse/settings')
  @Roles('owner', 'manager', 'reception')
  fiscal(@CurrentTenant() ctx: TenantContext) {
    return this.nfse.settings(ctx);
  }

  @RequiresFeature('nfse')
  @Put('nfse/settings')
  @Roles('owner')
  saveFiscal(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.nfse.save(ctx, validate(fiscalSchema, body));
  }

  @RequiresFeature('nfse')
  @Delete('nfse/settings')
  @Roles('owner')
  removeFiscal(@CurrentTenant() ctx: TenantContext) {
    return this.nfse.remove(ctx);
  }

  @RequiresFeature('nfse')
  @Get('nfse')
  @Roles('owner', 'manager', 'reception')
  invoices(@CurrentTenant() ctx: TenantContext, @Query('charges') ids?: string) {
    const lista = ids ? validate(z.array(uuid).max(200), ids.split(',')) : undefined;
    return this.nfse.list(ctx, lista);
  }

  @RequiresFeature('nfse')
  @Post('nfse')
  @Roles('owner', 'manager', 'reception')
  emit(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.nfse.emit(ctx, validate(z.object({ chargeId: uuid }).strict(), body).chargeId);
  }

  @RequiresFeature('nfse')
  @Post('nfse/:id/refresh')
  @HttpCode(200)
  @Roles('owner', 'manager', 'reception')
  refresh(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.nfse.refresh(ctx, validate(uuid, id));
  }

  @RequiresFeature('nfse')
  @Post('nfse/:id/cancel')
  @HttpCode(200)
  @Roles('owner', 'manager')
  cancel(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = validate(
      z
        .object({
          reason: z
            .string()
            .trim()
            .min(15, 'A justificativa precisa de 15 caracteres ou mais')
            .max(255),
        })
        .strict(),
      body,
    );
    return this.nfse.cancel(ctx, validate(uuid, id), reason);
  }
}
