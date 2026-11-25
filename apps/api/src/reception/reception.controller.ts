import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { ReceptionService } from './reception.service';

const uuid = z.string().uuid('Identificador inválido');
const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Link inválido');

@Controller('reception')
@UseGuards(TenantGuard)
export class ReceptionController {
  constructor(@Inject(ReceptionService) private readonly service: ReceptionService) {}

  @Get('queue')
  queue(@CurrentTenant() ctx: TenantContext) {
    return this.service.queue(ctx);
  }

  @Post('call/:appointmentId')
  @HttpCode(200)
  call(
    @CurrentTenant() ctx: TenantContext,
    @Param('appointmentId') id: string,
    @Body() body: unknown,
  ) {
    const b = validate(
      z.object({ destination: z.string().trim().max(80).optional() }).strict(),
      body ?? {},
    );
    return this.service.call(ctx, validate(uuid, id), b.destination);
  }

  @Post('tv-link')
  @HttpCode(200)
  @Roles('owner', 'manager')
  tvLink(@CurrentTenant() ctx: TenantContext) {
    return this.service.newTvLink(ctx);
  }
}

/** Tela da TV da sala de espera. Sem login: quem identifica é o link. */
@Controller('public')
export class PublicTvController {
  constructor(@Inject(ReceptionService) private readonly service: ReceptionService) {}

  @Get('tv/:token')
  tv(@Param('token') value: string) {
    return this.service.tv(validate(token, value));
  }
}
