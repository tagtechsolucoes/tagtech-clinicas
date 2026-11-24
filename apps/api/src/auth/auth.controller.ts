import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@tagtech/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { validate } from '../common/validate';
import { CurrentAuth, SessionGuard, type AuthContext } from './auth.guard';
import { AuthService } from './auth.service';
import { clearedSessionCookie, sessionCookie } from './session-token';

const email = z.string().trim().toLowerCase().email('E-mail inválido').max(254);

const signupSchema = z.object({
  email,
  password: z
    .string()
    .min(10, 'A senha precisa de pelo menos 10 caracteres')
    .max(128, 'A senha pode ter no máximo 128 caracteres'),
  name: z.string().trim().min(1, 'Informe seu nome').max(120),
  clinicName: z.string().trim().min(1, 'Informe o nome da clínica').max(120),
  unitName: z.string().trim().min(1).max(120).optional(),
});

const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const password = z
  .string()
  .min(10, 'A senha precisa de pelo menos 10 caracteres')
  .max(128, 'A senha pode ter no máximo 128 caracteres');
const forgotSchema = z.object({ email });
const resetSchema = z.object({ password });
const resetToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Link inválido');

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('signup')
  async signup(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const { token, user } = await this.auth.signup(validate(signupSchema, body), request.ip);
    reply.header('set-cookie', sessionCookie(token));
    return user;
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const data = validate(loginSchema, body);
    const { token, user } = await this.auth.login(data.email, data.password, request.ip);
    reply.header('set-cookie', sessionCookie(token));
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(auth.sessionToken);
    reply.header('set-cookie', clearedSessionCookie());
  }

  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    await this.auth.forgotPassword(validate(forgotSchema, body).email, request.ip);
  }

  @Get('reset-password/:token')
  resetInfo(@Param('token') token: string) {
    return this.auth.resetInfo(validate(resetToken, token));
  }

  @Post('reset-password/:token')
  @HttpCode(200)
  async reset(
    @Param('token') token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionUser> {
    const result = await this.auth.resetPassword(
      validate(resetToken, token),
      validate(resetSchema, body).password,
    );
    reply.header('set-cookie', sessionCookie(result.token));
    return result.user;
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentAuth() auth: AuthContext): SessionUser {
    return auth.user;
  }
}
