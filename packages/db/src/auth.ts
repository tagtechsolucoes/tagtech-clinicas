import { sql } from 'drizzle-orm';
import type { Db } from './client';

// Acesso a contas e sessões. O usuário do app não enxerga as tabelas users e sessions;
// estas funções chamam as funções auth_* do banco (ver migrations/0002_auth.sql).

export const MEMBER_ROLES = ['owner', 'manager', 'reception', 'professional'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface SignupInput {
  email: string;
  name: string;
  passwordHash: string;
  tenantName: string;
  tenantSlug: string;
  unitName: string;
}

export interface SignupResult {
  userId: string;
  tenantId: string;
  unitId: string;
}

export async function signup(db: Db, input: SignupInput): Promise<SignupResult> {
  const rows = await db.execute<{
    new_user_id: string;
    new_tenant_id: string;
    new_unit_id: string;
  }>(
    sql`select * from auth_signup(${input.email}, ${input.name}, ${input.passwordHash},
                                  ${input.tenantName}, ${input.tenantSlug}, ${input.unitName})`,
  );
  const row = rows[0]!;
  return { userId: row.new_user_id, tenantId: row.new_tenant_id, unitId: row.new_unit_id };
}

export async function findUserForLogin(
  db: Db,
  email: string,
): Promise<{ userId: string; passwordHash: string } | null> {
  const rows = await db.execute<{ user_id: string; password_hash: string }>(
    sql`select * from auth_user_for_login(${email})`,
  );
  const row = rows[0];
  return row ? { userId: row.user_id, passwordHash: row.password_hash } : null;
}

export async function createSession(
  db: Db,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await db.execute(
    sql`select auth_create_session(${input.userId}, ${input.tokenHash}, ${input.expiresAt.toISOString()})`,
  );
}

export interface Membership {
  tenantId: string;
  tenantName: string;
  role: MemberRole;
  /** null = todas as unidades da clínica. */
  unitId: string | null;
}

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  memberships: Membership[];
}

/** Sessão válida -> pessoa e suas clínicas. Vencida, revogada ou inexistente -> null. */
export async function findSession(db: Db, tokenHash: string): Promise<SessionUser | null> {
  const rows = await db.execute<{
    user_id: string;
    email: string;
    name: string;
    tenant_id: string | null;
    tenant_name: string | null;
    role: MemberRole | null;
    unit_id: string | null;
  }>(sql`select * from auth_session(${tokenHash})`);
  const first = rows[0];
  if (!first) return null;
  return {
    userId: first.user_id,
    email: first.email,
    name: first.name,
    memberships: rows.flatMap((r) =>
      r.tenant_id && r.tenant_name && r.role
        ? [{ tenantId: r.tenant_id, tenantName: r.tenant_name, role: r.role, unitId: r.unit_id }]
        : [],
    ),
  };
}

export async function revokeSession(db: Db, tokenHash: string): Promise<void> {
  await db.execute(sql`select auth_revoke_session(${tokenHash})`);
}

/** Código e nome da restrição de um erro do Postgres, mesmo embrulhado pelo Drizzle. */
export function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        ...(typeof e.constraint_name === 'string' ? { constraint: e.constraint_name } : {}),
      };
    }
    current = e.cause;
  }
  return {};
}

// ---------------------------------------------------------------- equipe

/** Qualquer coisa que execute SQL: o banco ou uma transação com a clínica em contexto. */
type Runner = Pick<Db, 'execute'>;

export interface TeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  unitId: string | null;
  joinedAt: string;
}

/** Equipe da clínica em contexto (chamar dentro de withTenant). */
export async function listTeam(tx: Runner): Promise<TeamMember[]> {
  const rows = await tx.execute<{
    membership_id: string;
    user_id: string;
    name: string;
    email: string;
    role: MemberRole;
    unit_id: string | null;
    created_at: string | Date;
  }>(sql`select * from auth_team()`);
  return rows.map((r) => ({
    membershipId: r.membership_id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    unitId: r.unit_id,
    joinedAt: new Date(r.created_at).toISOString(),
  }));
}

export interface InviteInfo {
  clinicName: string;
  unitName: string | null;
  role: MemberRole;
  name: string;
}

export async function findInvite(db: Runner, tokenHash: string): Promise<InviteInfo | null> {
  const rows = await db.execute<{
    tenant_name: string;
    unit_name: string | null;
    role: MemberRole;
    name: string;
  }>(sql`select * from auth_invite(${tokenHash})`);
  const r = rows[0];
  return r
    ? { clinicName: r.tenant_name, unitName: r.unit_name, role: r.role, name: r.name }
    : null;
}

export async function acceptInvite(
  db: Runner,
  tokenHash: string,
  userId: string,
): Promise<{ tenantId: string; membershipId: string }> {
  const rows = await db.execute<{ tenant_id: string; membership_id: string }>(
    sql`select * from auth_accept_invite(${tokenHash}, ${userId})`,
  );
  return { tenantId: rows[0]!.tenant_id, membershipId: rows[0]!.membership_id };
}

export async function acceptInviteNewUser(
  db: Runner,
  input: { tokenHash: string; email: string; name: string; passwordHash: string },
): Promise<{ userId: string; tenantId: string; membershipId: string }> {
  const rows = await db.execute<{ user_id: string; tenant_id: string; membership_id: string }>(
    sql`select * from auth_accept_invite_new(${input.tokenHash}, ${input.email}, ${input.name}, ${input.passwordHash})`,
  );
  const r = rows[0]!;
  return { userId: r.user_id, tenantId: r.tenant_id, membershipId: r.membership_id };
}

/** Mensagem de erro levantada por uma função auth_* (RAISE EXCEPTION 'invite_invalid'). */
export function pgMessage(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === 'P0001' && typeof e.message === 'string') return e.message;
    current = e.cause;
  }
  return undefined;
}

// ---------------------------------------------------------------- troca de senha

export async function requestPasswordReset(
  db: Runner,
  input: { email: string; tokenHash: string; expiresAt: Date },
): Promise<{ email: string; name: string } | null> {
  const rows = await db.execute<{ email: string; name: string }>(
    sql`select * from auth_request_password_reset(${input.email}, ${input.tokenHash}, ${input.expiresAt.toISOString()})`,
  );
  return rows[0] ?? null;
}

export async function passwordResetEmail(db: Runner, tokenHash: string): Promise<string | null> {
  const rows = await db.execute<{ email: string | null }>(
    sql`select auth_password_reset_email(${tokenHash}) as email`,
  );
  return rows[0]?.email ?? null;
}

export async function resetPassword(
  db: Runner,
  tokenHash: string,
  passwordHash: string,
): Promise<string | null> {
  const rows = await db.execute<{ user_id: string | null }>(
    sql`select auth_reset_password(${tokenHash}, ${passwordHash}) as user_id`,
  );
  return rows[0]?.user_id ?? null;
}

/** Nomes de quem aparece no histórico da clínica em contexto. */
export async function memberNames(tx: Runner, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.execute<{ user_id: string; name: string }>(
    sql`select * from auth_member_names(${`{${userIds.join(',')}}`}::uuid[])`,
  );
  return new Map(rows.map((r) => [r.user_id, r.name]));
}
