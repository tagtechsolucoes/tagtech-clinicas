import { Inject, Injectable } from '@nestjs/common';
import {
  localClock,
  PLAN_INFO,
  PLANS,
  subscriptionState,
  type Feature,
  type Plan,
  type SubscriptionRow,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.module';

const CACHE_MS = 30_000;

/** Assinatura da clínica com a TagTech: plano, recursos e se está bloqueada. */
@Injectable()
export class SubscriptionService {
  private readonly cache = new Map<string, { em: number; estado: SubscriptionState }>();

  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private hoje() {
    return localClock(new Date(), 'America/Sao_Paulo').ymd;
  }

  async row(tenantId: string): Promise<SubscriptionRow | null> {
    const [r] = await this.dbService.db.execute<{
      plan: Plan;
      status: SubscriptionStatus;
      trial_ends_at: string | null;
      paid_until: string | null;
    }>(
      sql`select plan, status, trial_ends_at::text, paid_until::text from subscription_of(${tenantId})`,
    );
    return r
      ? { plan: r.plan, status: r.status, trialEndsAt: r.trial_ends_at, paidUntil: r.paid_until }
      : null;
  }

  /** Estado atual, com cache curto (o guard chama em toda requisição). */
  async state(tenantId: string): Promise<SubscriptionState> {
    const c = this.cache.get(tenantId);
    if (c && Date.now() - c.em < CACHE_MS) return c.estado;
    const estado = subscriptionState(await this.row(tenantId), this.hoje());
    this.cache.set(tenantId, { em: Date.now(), estado });
    return estado;
  }

  forget(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async has(tenantId: string, f: Feature) {
    const s = await this.state(tenantId);
    return !s.blocked && s.features.includes(f);
  }

  /** Para mensagens automáticas: clínica bloqueada não manda nada. */
  async active(tenantId: string) {
    return !(await this.state(tenantId)).blocked;
  }

  /** O que a tela "Plano" mostra para a clínica. */
  async view(tenantId: string) {
    const row = await this.row(tenantId);
    const estado = subscriptionState(row, this.hoje());
    const [extra] = await this.dbService.db.execute<{ price_cents: number }>(
      sql`select price_cents from subscription_of(${tenantId})`,
    );
    return {
      ...estado,
      status: row?.status ?? null,
      priceCents: extra?.price_cents ?? 0,
      plans: PLANS.map((p) => ({ id: p, ...PLAN_INFO[p] })),
      payment: {
        instructions: process.env.PLATFORM_PAYMENT_INFO ?? '',
        whatsapp: (process.env.PLATFORM_WHATSAPP ?? '').replace(/\D/g, ''),
      },
    };
  }
}
