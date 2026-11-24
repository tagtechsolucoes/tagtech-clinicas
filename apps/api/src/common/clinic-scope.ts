import { withTenant, type Db, type TenantTx } from '@tagtech/db';
import type { TenantContext } from '../auth/auth.guard';

/** Roda `fn` dentro da clínica da sessão. Dados de outra clínica nem aparecem (RLS). */
export function inClinic<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(db, ctx.tenantId, fn);
}
