import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { localClock, zonedToUtc, weekdayOf, addDays } from '@tagtech/domain';
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const {
  appointments,
  commissionRules,
  professionals,
  services,
  sessionPackages,
  timeOff,
  treatmentPlans,
  charges,
  workingHours,
} = schema;

const proximoMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};

export interface CommissionInput {
  commissionPct: number;
  rules: Array<{
    serviceId: string;
    pct?: number | null | undefined;
    fixedCents?: number | null | undefined;
  }>;
}

/**
 * Relatórios da clínica com equipe: repasse por profissional e os números de gestão
 * (falta, ocupação, orçamentos e faturamento por profissional).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ regras de repasse

  commissions(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const pros = await tx.select().from(professionals);
      const regras = await tx.select().from(commissionRules);
      return pros.map((p) => ({
        professionalId: p.id,
        name: p.name,
        commissionPct: Number(p.commissionPct),
        rules: regras
          .filter((r) => r.professionalId === p.id)
          .map((r) => ({
            serviceId: r.serviceId,
            pct: r.pct === null ? null : Number(r.pct),
            fixedCents: r.fixedCents,
          })),
      }));
    });
  }

  saveCommission(ctx: TenantContext, professionalId: string, input: CommissionInput) {
    return this.run(ctx, async (tx) => {
      const [p] = await tx
        .update(professionals)
        .set({ commissionPct: String(input.commissionPct) })
        .where(eq(professionals.id, professionalId))
        .returning();
      if (!p) throw new NotFoundException('Profissional não encontrado');
      await tx.delete(commissionRules).where(eq(commissionRules.professionalId, professionalId));
      if (input.rules.length)
        await tx.insert(commissionRules).values(
          input.rules.map((r) => ({
            tenantId: ctx.tenantId,
            professionalId,
            serviceId: r.serviceId,
            pct: r.pct == null ? null : String(r.pct),
            fixedCents: r.fixedCents ?? null,
          })),
        );
      return { ok: true };
    });
  }

  // ------------------------------------------------------------ repasse do mês

  /**
   * Repasse do mês: cada atendimento feito no mês vale o preço da consulta (sessão de
   * pacote vale o preço do pacote dividido pelas sessões). Regra do serviço vence a
   * porcentagem padrão do profissional.
   */
  payouts(ctx: TenantContext, month: string) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(`${month}-01`, 0, tz);
      const ate = zonedToUtc(`${proximoMes(month)}-01`, 0, tz);
      const feitos = await tx
        .select({
          id: appointments.id,
          professionalId: appointments.professionalId,
          serviceId: appointments.serviceId,
          serviceName: services.name,
          startsAt: appointments.startsAt,
          price: appointments.priceCents,
          insurerId: appointments.insurerId,
          pkgPrice: sessionPackages.priceCents,
          pkgTotal: sessionPackages.totalSessions,
        })
        .from(appointments)
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .leftJoin(sessionPackages, eq(sessionPackages.id, appointments.packageId))
        .where(
          and(
            eq(appointments.status, 'done'),
            gte(appointments.startsAt, de),
            lt(appointments.startsAt, ate),
          ),
        );
      const pros = await tx.select().from(professionals);
      const regras = await tx.select().from(commissionRules);
      return pros
        .map((p) => {
          const meus = feitos.filter((f) => f.professionalId === p.id);
          const linhas = meus.map((f) => {
            const base =
              f.pkgPrice !== null && f.pkgTotal
                ? Math.round(f.pkgPrice / f.pkgTotal)
                : (f.price ?? 0);
            const r = regras.find((x) => x.professionalId === p.id && x.serviceId === f.serviceId);
            const valor =
              r?.fixedCents != null
                ? r.fixedCents
                : Math.round((base * Number(r?.pct ?? p.commissionPct)) / 100);
            return {
              appointmentId: f.id,
              date: localClock(f.startsAt, tz).ymd,
              serviceName: f.serviceName,
              baseCents: base,
              insurance: Boolean(f.insurerId),
              commissionCents: valor,
            };
          });
          return {
            professionalId: p.id,
            name: p.name,
            commissionPct: Number(p.commissionPct),
            appointments: linhas.length,
            producedCents: linhas.reduce((s, l) => s + l.baseCents, 0),
            payoutCents: linhas.reduce((s, l) => s + l.commissionCents, 0),
            lines: linhas,
          };
        })
        .filter((p) => p.appointments > 0 || p.commissionPct > 0);
    });
  }

  // ------------------------------------------------------------ visão geral

  overview(ctx: TenantContext, month: string) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(`${month}-01`, 0, tz);
      const ate = zonedToUtc(`${proximoMes(month)}-01`, 0, tz);
      const pros = await tx.select().from(professionals);
      const doMes = await tx
        .select({
          professionalId: appointments.professionalId,
          status: appointments.status,
          startsAt: appointments.startsAt,
          endsAt: appointments.endsAt,
          price: appointments.priceCents,
        })
        .from(appointments)
        .where(and(gte(appointments.startsAt, de), lt(appointments.startsAt, ate)));

      // Minutos de trabalho no mês (grade semanal menos bloqueios do profissional).
      const horas = await tx.select().from(workingHours);
      const bloqueios = await tx
        .select()
        .from(timeOff)
        .where(and(lt(timeOff.startsAt, ate), gte(timeOff.endsAt, de)));
      const dias: string[] = [];
      for (let d = `${month}-01`; d < `${proximoMes(month)}-01`; d = addDays(d, 1)) dias.push(d);
      const minutosDe = (proId: string) => {
        let total = 0;
        for (const d of dias) {
          const wd = weekdayOf(d);
          total += horas
            .filter((h) => h.professionalId === proId && h.weekday === wd)
            .reduce((s, h) => s + (h.endMinute - h.startMinute), 0);
        }
        const bloq = bloqueios
          .filter((b) => b.professionalId === proId || b.professionalId === null)
          .reduce((s, b) => {
            const ini = Math.max(b.startsAt.getTime(), de.getTime());
            const fim = Math.min(b.endsAt.getTime(), ate.getTime());
            return s + Math.max(0, fim - ini) / 60_000;
          }, 0);
        return Math.max(0, total - Math.min(bloq, total));
      };

      const porPro = pros
        .map((p) => {
          const meus = doMes.filter((a) => a.professionalId === p.id);
          const passadas = meus.filter((a) => a.status === 'done' || a.status === 'no_show');
          const faltas = meus.filter((a) => a.status === 'no_show').length;
          const ocupados = meus
            .filter((a) => a.status !== 'cancelled')
            .reduce((s, a) => s + (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000, 0);
          const disponivel = minutosDe(p.id);
          return {
            professionalId: p.id,
            name: p.name,
            appointments: meus.filter((a) => a.status !== 'cancelled').length,
            done: meus.filter((a) => a.status === 'done').length,
            noShows: faltas,
            noShowRate: passadas.length ? faltas / passadas.length : null,
            occupancy: disponivel ? Math.min(1, ocupados / disponivel) : null,
            revenueCents: meus
              .filter((a) => a.status === 'done')
              .reduce((s, a) => s + (a.price ?? 0), 0),
          };
        })
        .filter((p) => p.appointments > 0);

      const planos = await tx
        .select({ status: treatmentPlans.status, id: treatmentPlans.id })
        .from(treatmentPlans)
        .where(
          and(
            isNotNull(treatmentPlans.sentAt),
            gte(treatmentPlans.sentAt, de),
            lt(treatmentPlans.sentAt, ate),
          ),
        );
      const aprovados = planos.filter((p) => p.status === 'approved').map((p) => p.id);
      const [valor] = aprovados.length
        ? await tx
            .select({ s: sql<number>`coalesce(sum(${charges.amountCents}), 0)::int` })
            .from(charges)
            .where(inArray(charges.planId, aprovados))
        : [{ s: 0 }];

      const total = porPro.reduce(
        (acc, p) => ({
          appointments: acc.appointments + p.appointments,
          done: acc.done + p.done,
          noShows: acc.noShows + p.noShows,
          revenueCents: acc.revenueCents + p.revenueCents,
        }),
        { appointments: 0, done: 0, noShows: 0, revenueCents: 0 },
      );
      const passadas = total.done + total.noShows;
      return {
        month,
        totals: { ...total, noShowRate: passadas ? total.noShows / passadas : null },
        professionals: porPro,
        plans: {
          sent: planos.length,
          approved: aprovados.length,
          declined: planos.filter((p) => p.status === 'declined').length,
          open: planos.filter((p) => p.status === 'sent').length,
          approvedCents: valor!.s,
        },
      };
    });
  }
}
