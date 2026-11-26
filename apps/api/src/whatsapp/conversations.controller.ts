import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { ConversationsService } from './conversations.service';

const uuid = z.string().uuid('Identificador inválido');

/** Central de conversas do WhatsApp: quem atende os pacientes (dono, gerente e recepção). */
@Controller('conversations')
@UseGuards(TenantGuard)
@Roles('owner', 'manager', 'reception')
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly service: ConversationsService) {}

  @Get()
  list(@CurrentTenant() ctx: TenantContext, @Query('q') q?: string) {
    return this.service.list(ctx, (q ?? '').slice(0, 80));
  }

  @Get('unread')
  unread(@CurrentTenant() ctx: TenantContext) {
    return this.service.unread(ctx);
  }

  @Post()
  start(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    const { phone, name } = validate(
      z
        .object({ phone: z.string().trim().max(30), name: z.string().max(120).default('') })
        .strict(),
      body,
    );
    return this.service.start(ctx, phone, name);
  }

  @Get(':id')
  thread(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.thread(ctx, validate(uuid, id));
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.markRead(ctx, validate(uuid, id));
  }

  @Post(':id/messages')
  send(@CurrentTenant() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const { text } = validate(z.object({ text: z.string().max(4096) }).strict(), body);
    return this.service.send(ctx, validate(uuid, id), text);
  }
}

/** Webhook da Evolution (rede interna do Docker). Sempre 200: erro só a faria repetir. */
@Controller('whatsapp/hook')
export class WhatsAppHookController {
  constructor(@Inject(ConversationsService) private readonly service: ConversationsService) {}

  @Post(':secret')
  @HttpCode(200)
  async hook(@Param('secret') secret: string, @Body() body: unknown) {
    await this.service.hook(secret, body);
    return { ok: true };
  }
}
