import { Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { LgpdService } from './lgpd.service';

const uuid = z.string().uuid('Identificador inválido');

/** Pedidos do titular (exportar e excluir) e exportação completa da clínica. */
@Controller()
@UseGuards(TenantGuard)
export class LgpdController {
  constructor(@Inject(LgpdService) private readonly lgpd: LgpdService) {}

  @Get('patients/:id/export')
  @Roles('owner', 'manager')
  async exportPatient(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const data = await this.lgpd.exportPatient(ctx, validate(uuid, id));
    void reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="dados-do-paciente-${id.slice(0, 8)}.json"`,
      )
      .header('cache-control', 'no-store')
      .send(JSON.stringify(data, null, 2));
  }

  @Post('patients/:id/erase')
  @HttpCode(200)
  @Roles('owner', 'manager')
  erase(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.lgpd.erasePatient(ctx, validate(uuid, id));
  }

  @Get('clinic/export')
  @Roles('owner')
  async exportClinic(@CurrentTenant() ctx: TenantContext, @Res() reply: FastifyReply) {
    const data = await this.lgpd.exportClinic(ctx);
    void reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="tagtech-clinica-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .header('cache-control', 'no-store')
      .send(JSON.stringify(data, null, 2));
  }
}
