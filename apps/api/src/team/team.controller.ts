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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@tagtech/db';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  Roles,
  SessionGuard,
  TenantGuard,
  type AuthContext,
  type TenantContext,
} from '../auth/auth.guard';
import { sessionCookie } from '../auth/session-token';
import { validate } from '../common/validate';
import { TeamService } from './team.service';

const uuid = z.string().uuid('Identificador inválido');
const role = z.enum(['manager', 'reception', 'professional']);
const inviteSchema = z.object({ name: z.string().trim().min(1, 'Informe o nome').max(120), role });
const roleSchema = z.object({ role });
const acceptNewSchema = z.object({
  name: z.string().trim().min(1, 'Informe seu nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(254),
  password: z
    .string()
    .min(10, 'A senha precisa de pelo menos 10 caracteres')
    .max(128, 'A senha pode ter no máximo 128 caracteres'),
});
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const token = z.string().regex(TOKEN, 'Convite inválido');

/** Dono e gerente cuidam da equipe da clínica. */
@Controller('team')
@UseGuards(TenantGuard)
export class TeamController {
  constructor(@Inject(TeamService) private readonly service: TeamService) {}

  @Get()
  @Roles('owner', 'manager')
  list(@CurrentTenant() ctx: TenantContext) {
    return this.service.team(ctx);
  }

  @Post('invites')
  @Roles('owner', 'manager')
  invite(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.invite(ctx, validate(inviteSchema, body));
  }

  @Post('invites/:inviteId/renew')
  @HttpCode(200)
  @Roles('owner', 'manager')
  renew(@CurrentTenant() ctx: TenantContext, @Param('inviteId') inviteId: string) {
    return this.service.renewInvite(ctx, validate(uuid, inviteId));
  }

  @Delete('invites/:inviteId')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async revoke(@CurrentTenant() ctx: TenantContext, @Param('inviteId') inviteId: string) {
    await this.service.revokeInvite(ctx, validate(uuid, inviteId));
  }

  @Patch('members/:membershipId')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async changeRole(
    @CurrentTenant() ctx: TenantContext,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ) {
    await this.service.changeRole(
      ctx,
      validate(uuid, membershipId),
      validate(roleSchema, body).role,
    );
  }

  @Delete('members/:membershipId')
  @HttpCode(204)
  @Roles('owner', 'manager')
  async remove(@CurrentTenant() ctx: TenantContext, @Param('membershipId') membershipId: string) {
    await this.service.remove(ctx, validate(uuid, membershipId));
  }
}

/** Página do convite: ver, aceitar criando conta ou aceitar com a conta logada. */
@Controller('invites/:token')
export class InvitesController {
  constructor(@Inject(TeamService) private readonly service: TeamService) {}

  @Get()
  info(@Param('token') value: string) {
    return this.service.inviteInfo(validate(token, value));
  }

  @Post('accept')
  async accept(
    @Param('token') value: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const result = await this.service.acceptAsNewUser(
      validate(token, value),
      validate(acceptNewSchema, body),
    );
    reply.header('set-cookie', sessionCookie(result.token));
    return result.user;
  }

  @Post('join')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async join(@Param('token') value: string, @CurrentAuth() auth: AuthContext) {
    await this.service.acceptAsUser(validate(token, value), auth.user.userId);
  }
}
