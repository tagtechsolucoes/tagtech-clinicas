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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { WhatsAppService } from './whatsapp.service';

const settingsSchema = z
  .object({
    phoneNumberId: z
      .string()
      .trim()
      .regex(/^\d{5,30}$/, 'O ID do número tem só dígitos'),
    accessToken: z.string().trim().min(20).max(600).optional(),
    templateName: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,200}$/, 'Nome do modelo: minúsculas, números e _'),
    templateLang: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Ex.: pt_BR'),
    reminderHours: z.number().int().min(2).max(72),
    enabled: z.boolean(),
  })
  .strict();

/** Mensagens automáticas no WhatsApp. Só o dono mexe: envolve o token da Meta. */
@Controller()
@UseGuards(TenantGuard)
export class WhatsAppController {
  constructor(@Inject(WhatsAppService) private readonly service: WhatsAppService) {}

  @Get('whatsapp')
  @Roles('owner', 'manager')
  get(@CurrentTenant() ctx: TenantContext) {
    return this.service.settings(ctx);
  }

  @Put('whatsapp')
  @Roles('owner')
  save(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.save(ctx, validate(settingsSchema, body));
  }

  @Patch('whatsapp')
  @Roles('owner')
  enabled(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.setEnabled(
      ctx,
      validate(z.object({ enabled: z.boolean() }).strict(), body).enabled,
    );
  }

  @Delete('whatsapp')
  @Roles('owner')
  remove(@CurrentTenant() ctx: TenantContext) {
    return this.service.remove(ctx);
  }

  @Post('whatsapp/test')
  @HttpCode(200)
  @Roles('owner')
  test(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.test(
      ctx,
      validate(z.object({ phone: z.string().max(40) }).strict(), body).phone,
    );
  }

  @Get('appointments/:id/messages')
  messages(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.messages(ctx, validate(z.string().uuid('Identificador inválido'), id));
  }
}
