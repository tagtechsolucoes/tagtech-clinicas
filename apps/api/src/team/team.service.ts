import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  acceptInvite,
  acceptInviteNewUser,
  findInvite,
  listTeam,
  pgError,
  pgMessage,
  schema,
  type SessionUser,
} from '@tagtech/db';
import { canManage, ROLE_LABELS, type InvitableRole } from '@tagtech/domain';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { hashSessionToken, newSessionToken } from '../auth/session-token';
import { inClinic } from '../common/clinic-scope';
import { recordAudit } from '../audit/audit';
import { DbService } from '../db/db.module';

const { invites, memberships } = schema;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteRow = typeof invites.$inferSelect;
const inviteView = (i: InviteRow) => ({
  id: i.id,
  name: i.name,
  role: i.role,
  createdAt: i.createdAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
});

@Injectable()
export class TeamService {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  // ------------------------------------------------------------ equipe

  team(ctx: TenantContext) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const members = await listTeam(tx);
      const pending = await tx
        .select()
        .from(invites)
        .where(
          and(
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invites.createdAt));
      return {
        you: ctx.user.userId,
        members: members.map(({ userId, ...m }) => ({ ...m, isYou: userId === ctx.user.userId })),
        invites: pending.map(inviteView),
      };
    });
  }

  private assertCanManage(ctx: TenantContext, role: string): void {
    if (!canManage(ctx.membership.role, role)) {
      throw new ForbiddenException('Seu papel não permite cuidar deste papel');
    }
  }

  invite(ctx: TenantContext, input: { name: string; role: InvitableRole }) {
    this.assertCanManage(ctx, input.role);
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const token = newSessionToken();
      const [row] = await tx
        .insert(invites)
        .values({
          tenantId: ctx.tenantId,
          // Quem só cuida de uma unidade convida para aquela unidade.
          unitId: ctx.membership.unitId,
          role: input.role,
          name: input.name,
          tokenHash: hashSessionToken(token),
          createdBy: ctx.user.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning();
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'team.invited',
        summary: `Convite para ${input.name} como ${ROLE_LABELS[input.role].toLowerCase()}`,
        details: { inviteId: row!.id, role: input.role },
      });
      return { ...inviteView(row!), token };
    });
  }

  /** Gera um link novo (o antigo deixa de valer). O link só aparece na hora de gerar. */
  renewInvite(ctx: TenantContext, inviteId: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [current] = await tx.select().from(invites).where(eq(invites.id, inviteId));
      if (!current || current.acceptedAt || current.revokedAt) {
        throw new NotFoundException('Convite não encontrado');
      }
      this.assertCanManage(ctx, current.role);
      const token = newSessionToken();
      const [row] = await tx
        .update(invites)
        .set({
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .where(eq(invites.id, inviteId))
        .returning();
      return { ...inviteView(row!), token };
    });
  }

  revokeInvite(ctx: TenantContext, inviteId: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const [current] = await tx.select().from(invites).where(eq(invites.id, inviteId));
      if (!current || current.acceptedAt || current.revokedAt) {
        throw new NotFoundException('Convite não encontrado');
      }
      this.assertCanManage(ctx, current.role);
      await tx.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, inviteId));
    });
  }

  private async target(
    tx: Parameters<Parameters<typeof inClinic>[2]>[0],
    ctx: TenantContext,
    membershipId: string,
  ) {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!m) throw new NotFoundException('Pessoa não encontrada na equipe');
    if (m.userId === ctx.user.userId) {
      throw new ForbiddenException('Você não pode mudar o seu próprio papel');
    }
    this.assertCanManage(ctx, m.role);
    return m;
  }

  changeRole(ctx: TenantContext, membershipId: string, role: InvitableRole) {
    this.assertCanManage(ctx, role);
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const alvo = await this.target(tx, ctx, membershipId);
      await tx.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
      const nome = (await listTeam(tx)).find((m) => m.membershipId === membershipId)?.name ?? '';
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'team.role_changed',
        summary: `${nome}: ${ROLE_LABELS[alvo.role].toLowerCase()} para ${ROLE_LABELS[role].toLowerCase()}`,
        details: { membershipId, from: alvo.role, to: role },
      });
    });
  }

  remove(ctx: TenantContext, membershipId: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const alvo = await this.target(tx, ctx, membershipId);
      const nome = (await listTeam(tx)).find((m) => m.membershipId === membershipId)?.name ?? '';
      await recordAudit(tx, ctx, {
        unitId: null,
        action: 'team.removed',
        summary: `${nome} saiu da equipe (${ROLE_LABELS[alvo.role].toLowerCase()})`,
        details: { userId: alvo.userId, role: alvo.role },
      });
      // Sem vínculo, a sessão da pessoa deixa de abrir qualquer tela desta clínica.
      await tx.delete(memberships).where(eq(memberships.id, membershipId));
    });
  }

  // ------------------------------------------------------------ convite (público)

  async inviteInfo(token: string) {
    const info = await findInvite(this.dbService.db, hashSessionToken(token));
    if (!info) throw new GoneException('Este convite não vale mais. Peça um link novo.');
    return info;
  }

  async acceptAsNewUser(
    token: string,
    input: { name: string; email: string; password: string },
  ): Promise<{ token: string; user: SessionUser }> {
    const passwordHash = await hashPassword(input.password);
    let joined: { userId: string; tenantId: string };
    try {
      joined = await acceptInviteNewUser(this.dbService.db, {
        tokenHash: hashSessionToken(token),
        email: input.email,
        name: input.name,
        passwordHash,
      });
    } catch (error) {
      this.mapAcceptError(error);
    }
    return this.auth.startSession(joined.userId);
  }

  async acceptAsUser(token: string, userId: string): Promise<void> {
    try {
      await acceptInvite(this.dbService.db, hashSessionToken(token), userId);
    } catch (error) {
      this.mapAcceptError(error);
    }
  }

  private mapAcceptError(error: unknown): never {
    const message = pgMessage(error);
    if (message === 'invite_invalid') {
      throw new GoneException('Este convite não vale mais. Peça um link novo.');
    }
    if (message === 'already_member') {
      throw new ConflictException('Você já faz parte desta equipe');
    }
    const { code, constraint } = pgError(error);
    if (code === '23505' && constraint === 'users_email_key') {
      throw new ConflictException({
        message: 'Já existe uma conta com este e-mail. Entre com sua senha para aceitar.',
        reason: 'email_in_use',
      });
    }
    throw error;
  }
}
