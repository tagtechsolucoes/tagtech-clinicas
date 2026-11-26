import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PLANS } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  SessionGuard,
  TenantGuard,
  type AuthContext,
  type TenantContext,
} from '../auth/auth.guard';
import { validate } from '../common/validate';
import { DbService } from '../db/db.module';
import { SubscriptionService } from './subscription.service';

/** A clínica vê o próprio plano (inclusive bloqueada). */
@Controller('subscription')
@UseGuards(TenantGuard)
export class SubscriptionController {
  constructor(@Inject(SubscriptionService) private readonly subs: SubscriptionService) {}

  @Get()
  get(@CurrentTenant() ctx: TenantContext) {
    return this.subs.view(ctx.tenantId);
  }
}

const uuid = z.string().uuid('Identificador inválido');
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const assinatura = z
  .object({
    plan: z.enum(PLANS),
    status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
    priceCents: z.number().int().min(0).max(10_000_000),
    trialEndsAt: dia.nullable(),
    paidUntil: dia.nullable(),
    notes: z.string().trim().max(1000),
  })
  .strict();
const pagamento = z
  .object({
    amountCents: z.number().int().min(0).max(100_000_000),
    paidOn: dia,
    months: z.number().int().min(1).max(24),
    method: z.enum(['pix', 'boleto', 'cartao', 'transferencia', 'outro']),
    note: z.string().trim().max(300),
  })
  .strict();

/** Equipe da TagTech (e-mails em PLATFORM_ADMINS): todas as clínicas, planos e pagamentos. */
@Controller('platform')
@UseGuards(SessionGuard)
export class PlatformController {
  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(SubscriptionService) private readonly subs: SubscriptionService,
  ) {}

  static isAdmin(email: string) {
    const lista = (process.env.PLATFORM_ADMINS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return lista.includes(email.toLowerCase());
  }

  private exigir(auth: AuthContext) {
    if (!PlatformController.isAdmin(auth.user.email))
      throw new ForbiddenException('Área da equipe TagTech');
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return { admin: PlatformController.isAdmin(auth.user.email) };
  }

  @Get('tenants')
  async tenants(@CurrentAuth() auth: AuthContext) {
    this.exigir(auth);
    const rows = await this.dbService.db.execute<Record<string, unknown>>(sql`
      select tenant_id, name, slug, created_at, plan, status, price_cents, trial_ends_at::text,
             paid_until::text, notes, owner_email, professionals::int, patients::int,
             appointments_30d::int, last_payment::text
      from platform_tenants()`);
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at,
      plan: r.plan ?? 'essencial',
      status: r.status ?? 'suspended',
      priceCents: r.price_cents ?? 0,
      trialEndsAt: r.trial_ends_at,
      paidUntil: r.paid_until,
      notes: r.notes ?? '',
      ownerEmail: r.owner_email,
      professionals: r.professionals,
      patients: r.patients,
      appointments30d: r.appointments_30d,
      lastPayment: r.last_payment,
    }));
  }

  @Patch('tenants/:id')
  async set(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    this.exigir(auth);
    const t = validate(uuid, id);
    const a = validate(assinatura, body);
    await this.dbService.db.execute(
      sql`select platform_set_subscription(${t}, ${a.plan}, ${a.status}, ${a.priceCents},
            ${a.trialEndsAt}::date, ${a.paidUntil}::date, ${a.notes})`,
    );
    this.subs.forget(t);
    return { ok: true };
  }

  @Get('tenants/:id/payments')
  async payments(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    this.exigir(auth);
    const rows = await this.dbService.db.execute<Record<string, unknown>>(
      sql`select id, amount_cents, paid_on::text, months, method, note, recorded_by from platform_payments(${validate(uuid, id)})`,
    );
    return rows.map((r) => ({
      id: r.id,
      amountCents: r.amount_cents,
      paidOn: r.paid_on,
      months: r.months,
      method: r.method,
      note: r.note,
      recordedBy: r.recorded_by,
    }));
  }

  @Post('tenants/:id/payments')
  async pay(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    this.exigir(auth);
    const t = validate(uuid, id);
    const p = validate(pagamento, body);
    const [r] = await this.dbService.db.execute<{ ate: string }>(
      sql`select platform_record_payment(${t}, ${p.amountCents}, ${p.paidOn}::date, ${p.months},
            ${p.method}, ${p.note}, ${auth.user.email})::text as ate`,
    );
    this.subs.forget(t);
    return { paidUntil: r!.ate };
  }
}
