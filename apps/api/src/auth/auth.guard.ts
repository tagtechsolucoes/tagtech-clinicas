import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole, Membership, SessionUser } from '@tagtech/db';
import type { FastifyRequest } from 'fastify';
import { PLAN_INFO, planFor, type Feature } from '@tagtech/domain';
import { ALWAYS_KEY, FEATURE_KEY } from '../subscription/feature.decorator';
import { SubscriptionService } from '../subscription/subscription.service';
import { AuthService } from './auth.service';
import { readSessionCookie } from './session-token';

export interface AuthContext {
  user: SessionUser;
  sessionToken: string;
}

/** Pessoa logada agindo dentro de UMA clínica, com o papel que tem nele. */
export interface TenantContext extends AuthContext {
  tenantId: string;
  membership: Membership;
}

type AuthedRequest = FastifyRequest & { auth?: AuthContext; tenant?: TenantContext };

const ROLES_KEY = 'tagtech:roles';
/** Papéis que podem chamar a rota. Usado junto com TenantGuard. */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);

/** Exige sessão válida (cookie). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionCookie(request.headers.cookie);
    const user = token ? await this.auth.userFromToken(token) : null;
    if (!token || !user) throw new UnauthorizedException('Faça login para continuar');
    request.auth = { user, sessionToken: token };
    return true;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exige sessão válida E um papel na clínica da requisição.
 * A clínica nunca vem de um parâmetro em que a API confia às cegas: ele sai dos
 * vínculos da própria sessão. Quem trabalha em mais de uma clínica escolhe qual
 * com o cabeçalho x-tenant-id, que só vale se a pessoa tiver vínculo com ele.
 */
@Injectable()
export class TenantGuard extends SessionGuard {
  constructor(
    @Inject(AuthService) auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {
    super(auth);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = request.auth!;
    const memberships = auth.user.memberships;

    const header = request.headers['x-tenant-id'];
    let membership: Membership | undefined;
    if (typeof header === 'string' && header !== '') {
      if (!UUID.test(header)) throw new BadRequestException('x-tenant-id inválido');
      membership = memberships.find((m) => m.tenantId === header.toLowerCase());
      if (!membership) throw new ForbiddenException('Você não tem acesso a esta clínica');
    } else if (memberships.length === 1) {
      membership = memberships[0];
    } else if (memberships.length === 0) {
      throw new ForbiddenException('Sua conta não está ligada a nenhuma clínica');
    } else {
      throw new BadRequestException('Informe a clínica no cabeçalho x-tenant-id');
    }

    const allowed = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(membership!.role)) {
      throw new ForbiddenException('Seu papel não permite esta ação');
    }

    // Assinatura: bloqueada só lê; recurso fora do plano não abre.
    const alvo = [context.getHandler(), context.getClass()];
    const sub = await this.subscriptions.state(membership!.tenantId);
    const sempre = this.reflector.getAllAndOverride<boolean | undefined>(ALWAYS_KEY, alvo);
    if (sub.blocked && !sempre && !['GET', 'HEAD'].includes(request.method)) {
      throw new HttpException(
        'A assinatura desta clínica está suspensa. Os dados continuam aqui para consulta; fale com a TagTech para reativar.',
        402,
      );
    }
    const recurso = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, alvo);
    if (recurso && !sub.features.includes(recurso)) {
      throw new ForbiddenException(
        `Este recurso faz parte do plano ${PLAN_INFO[planFor(recurso)].name}. Fale com a TagTech para mudar de plano.`,
      );
    }

    request.tenant = { ...auth, tenantId: membership!.tenantId, membership: membership! };
    return true;
  }
}

export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException();
  return auth;
});

export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const tenant = context.switchToHttp().getRequest<AuthedRequest>().tenant;
  if (!tenant) throw new UnauthorizedException();
  return tenant;
});
