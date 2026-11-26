import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createSession,
  findSession,
  findUserForLogin,
  passwordResetEmail,
  pgError,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  signup,
  type SessionUser,
} from '@tagtech/db';
import { GoneException } from '@nestjs/common';
import { AttemptLimiter } from '../common/attempt-limiter';
import { Mailer, teamAppUrl } from '../mail/mailer';
import { slugify } from '@tagtech/domain';
import { DbService } from '../db/db.module';
import { LoginLimiter, SignupLimiter } from './login-limiter';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { hashSessionToken, newSessionToken, SESSION_TTL_SECONDS } from './session-token';

export interface SignupData {
  email: string;
  password: string;
  name: string;
  clinicName: string;
  unitName?: string | undefined;
}

@Injectable()
export class AuthService {
  // Pedidos de "esqueci a senha": 10 por hora por IP (o banco ainda limita 3 por conta).
  private readonly forgotLimiter = new AttemptLimiter({
    maxFailures: 10,
    windowMs: 60 * 60 * 1000,
    message: 'Muitos pedidos. Aguarde um pouco e tente de novo.',
  });

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(LoginLimiter) private readonly limiter: LoginLimiter,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(SignupLimiter) private readonly signupLimiter: SignupLimiter,
  ) {}

  /**
   * Manda o link de troca de senha, se o e-mail tiver conta. A resposta é sempre a mesma,
   * para não revelar quais e-mails estão cadastrados.
   */
  async forgotPassword(email: string, ip: string): Promise<void> {
    this.forgotLimiter.assertAllowed(ip, 'forgot');
    this.forgotLimiter.recordFailure(ip, 'forgot');
    const token = newSessionToken();
    const found = await requestPasswordReset(this.dbService.db, {
      email,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!found) return;
    const link = `${teamAppUrl()}/redefinir/${token}`;
    await this.mailer.send({
      to: found.email,
      subject: 'Troque sua senha do TagClin',
      text: [
        `Oi, ${found.name.split(' ')[0]}.`,
        '',
        'Recebemos um pedido para trocar a senha da sua conta. Para criar uma nova, abra:',
        link,
        '',
        'O link vale por 1 hora e funciona uma vez. Se não foi você, ignore este e-mail:',
        'sua senha continua a mesma.',
      ].join('\n'),
    });
  }

  async resetInfo(token: string): Promise<{ email: string }> {
    const email = await passwordResetEmail(this.dbService.db, hashSessionToken(token));
    if (!email) throw new GoneException('Este link não vale mais. Peça um novo.');
    return { email };
  }

  /** Troca a senha, derruba as sessões antigas e já entra com uma nova. */
  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const passwordHash = await hashPassword(password);
    const userId = await resetPassword(this.dbService.db, hashSessionToken(token), passwordHash);
    if (!userId) throw new GoneException('Este link não vale mais. Peça um novo.');
    return this.startSession(userId);
  }

  /** Cria conta, clínica e primeira unidade, e já devolve um token de sessão. */
  async signup(data: SignupData, ip = 'local'): Promise<{ token: string; user: SessionUser }> {
    this.signupLimiter.assertAllowed(ip, 'signup');
    this.signupLimiter.recordFailure(ip, 'signup');
    const passwordHash = await hashPassword(data.password);
    const baseSlug = slugify(data.clinicName) || 'clinica';

    let userId: string | undefined;
    // Se o endereço já estiver em uso por outra clínica, tenta de novo com um sufixo.
    for (let attempt = 0; attempt < 4 && !userId; attempt++) {
      const suffix = attempt === 0 ? '' : `-${randomBytes(2).toString('hex')}`;
      try {
        const created = await signup(this.dbService.db, {
          email: data.email,
          name: data.name,
          passwordHash,
          tenantName: data.clinicName,
          tenantSlug: `${baseSlug}${suffix}`,
          unitName: data.unitName ?? 'Unidade principal',
        });
        userId = created.userId;
      } catch (error) {
        const { code, constraint } = pgError(error);
        if (code === '23505' && constraint === 'users_email_key') {
          throw new ConflictException('Já existe uma conta com este e-mail');
        }
        if (code === '23505' && constraint === 'tenants_slug_key') continue;
        throw error;
      }
    }
    if (!userId) throw new ConflictException('Não foi possível gerar o endereço da clínica');
    return this.startSession(userId);
  }

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{ token: string; user: SessionUser }> {
    this.limiter.assertAllowed(ip, email);
    const found = await findUserForLogin(this.dbService.db, email);
    const ok = found
      ? await verifyPassword(found.passwordHash, password)
      : (await burnPasswordCheck(password), false);
    if (!found || !ok) {
      this.limiter.recordFailure(ip, email);
      // Mesma mensagem para e-mail inexistente e senha errada.
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }
    this.limiter.recordSuccess(ip, email);
    return this.startSession(found.userId);
  }

  async startSession(
    userId: string,
    ttlSeconds = SESSION_TTL_SECONDS,
  ): Promise<{ token: string; user: SessionUser }> {
    const token = newSessionToken();
    await createSession(this.dbService.db, {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
    const user = await this.userFromToken(token);
    if (!user) throw new UnauthorizedException();
    return { token, user };
  }

  userFromToken(token: string): Promise<SessionUser | null> {
    return findSession(this.dbService.db, hashSessionToken(token));
  }

  async logout(token: string): Promise<void> {
    await revokeSession(this.dbService.db, hashSessionToken(token));
  }
}
