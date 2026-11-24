import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { memberNames, schema, type TenantTx } from '@tagtech/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { validate } from '../common/validate';
import { DbService } from '../db/db.module';

const { auditEvents } = schema;

/** Registra uma ação sensível no histórico, na mesma transação da ação. */
export async function recordAudit(
  tx: TenantTx,
  ctx: Pick<TenantContext, 'tenantId' | 'user'>,
  event: {
    unitId: string | null;
    action: string;
    summary: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: ctx.tenantId,
    unitId: event.unitId,
    actorUserId: ctx.user.userId,
    action: event.action,
    summary: event.summary.slice(0, 300),
    details: event.details ?? {},
  });
}

const querySchema = z.object({
  kind: z.enum(['all', 'cancel']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Histórico de ações da clínica, para o dono e o gerente. */
@Controller('activity')
@UseGuards(TenantGuard)
@Roles('owner', 'manager')
export class AuditController {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  @Get()
  list(@CurrentTenant() ctx: TenantContext, @Query() query: unknown) {
    const { kind, limit } = validate(querySchema, query);
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(kind === 'cancel' ? eq(auditEvents.action, 'appointment.cancelled') : undefined)
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit);
      const names = await memberNames(tx, [
        ...new Set(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : []))),
      ]);
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        summary: r.summary,
        details: r.details,
        actor: r.actorUserId ? (names.get(r.actorUserId) ?? 'Pessoa removida') : 'Sistema',
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }
}
