import { Inject, Injectable } from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { zonedToUtc } from '@tagtech/domain';
import { and, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const {
  appointmentEvents,
  appointmentMessages,
  appointments,
  charges,
  patientMessages,
  reviewRequests,
  treatmentPlans,
  waitlist,
} = schema;

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * Painel do resultado: o que o sistema trouxe no mês. É o número que vende e renova.
 * Cada parcela do "valor gerado" é contada uma vez só e tem regra explícita.
 */
@Injectable()
export class ResultsService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  month(ctx: TenantContext, month: string) {
    return inClinic(this.dbService.db, ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const atual = await this.compute(tx, month, tz);
      const anterior = await this.compute(tx, somarMes(month, -1), tz);
      return {
        ...atual,
        previous: {
          noShowRate: anterior.agenda.noShowRate,
          generatedCents: anterior.generatedCents,
        },
      };
    });
  }

  private async compute(tx: TenantTx, month: string, tz: string) {
    const de = zonedToUtc(`${month}-01`, 0, tz);
    const ate = zonedToUtc(`${somarMes(month, 1)}-01`, 0, tz);
    const noMes = (col: Parameters<typeof gte>[0]) => and(gte(col, de), lt(col, ate));

    // Agenda do mês (pelo dia da consulta).
    const doMes = await tx
      .select({
        status: appointments.status,
        source: appointments.source,
        price: appointments.priceCents,
        confirmedAt: appointments.confirmedAt,
        createdAt: appointments.createdAt,
        id: appointments.id,
      })
      .from(appointments)
      .where(noMes(appointments.startsAt));
    const passadas = doMes.filter((a) => ['done', 'no_show'].includes(a.status));
    const faltas = doMes.filter((a) => a.status === 'no_show').length;
    const confirmadas = doMes.filter((a) => a.confirmedAt).length;
    const pacienteConfirmou = await tx
      .select({ n: sql<number>`count(distinct ${appointmentEvents.appointmentId})::int` })
      .from(appointmentEvents)
      .innerJoin(appointments, eq(appointments.id, appointmentEvents.appointmentId))
      .where(
        and(
          eq(appointmentEvents.toStatus, 'confirmed'),
          eq(appointmentEvents.actorKind, 'patient'),
          noMes(appointments.startsAt),
        ),
      );
    const mensagens = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointmentMessages)
      .where(and(eq(appointmentMessages.status, 'sent'), noMes(appointmentMessages.createdAt)));

    // Horários vagos preenchidos pela lista de espera (consulta do mês, não cancelada).
    const daEspera = await tx
      .select({ price: appointments.priceCents })
      .from(waitlist)
      .innerJoin(appointments, eq(appointments.id, waitlist.bookedAppointmentId))
      .where(
        and(
          isNotNull(waitlist.bookedAppointmentId),
          noMes(appointments.startsAt),
          ne(appointments.status, 'cancelled'),
        ),
      );

    // Retornos: consulta marcada no mês por quem recebeu lembrete de retorno ou de
    // reativação nos 30 dias antes. Conta aqui e não em "site", para não contar duas vezes.
    const lembrados = await tx
      .selectDistinct({ id: appointments.id, price: appointments.priceCents })
      .from(appointments)
      .innerJoin(
        patientMessages,
        and(
          eq(patientMessages.patientId, appointments.patientId),
          inArray(patientMessages.kind, ['recall', 'reactivation']),
          eq(patientMessages.status, 'sent'),
          lt(patientMessages.createdAt, appointments.createdAt),
          gte(patientMessages.createdAt, sql`${appointments.createdAt} - interval '30 days'`),
        ),
      )
      .where(and(noMes(appointments.createdAt), ne(appointments.status, 'cancelled')));
    const idsLembrados = new Set(lembrados.map((r) => r.id));
    const lembretes = await tx
      .select({ kind: patientMessages.kind, n: sql<number>`count(*)::int` })
      .from(patientMessages)
      .where(and(eq(patientMessages.status, 'sent'), noMes(patientMessages.createdAt)))
      .groupBy(patientMessages.kind);
    const enviadas = (k: string) => lembretes.find((l) => l.kind === k)?.n ?? 0;

    // Avaliações pedidas no mês.
    const avaliacoes = await tx
      .select({ rating: reviewRequests.rating, google: reviewRequests.sentToGoogle })
      .from(reviewRequests)
      .where(noMes(reviewRequests.createdAt));
    const notas = avaliacoes.flatMap((a) => (a.rating ? [a.rating] : []));

    // Agendamentos que o paciente fez sozinho pelo site (feitos no mês, não cancelados).
    const onlineTodos = await tx
      .select({ id: appointments.id, price: appointments.priceCents })
      .from(appointments)
      .where(
        and(
          eq(appointments.source, 'online'),
          noMes(appointments.createdAt),
          ne(appointments.status, 'cancelled'),
        ),
      );
    const online = onlineTodos.filter((a) => !idsLembrados.has(a.id));

    // Orçamentos enviados pelo link e aprovados no mês.
    const aprovados = await tx
      .select({ id: treatmentPlans.id })
      .from(treatmentPlans)
      .where(
        and(
          eq(treatmentPlans.status, 'approved'),
          isNotNull(treatmentPlans.sentAt),
          noMes(treatmentPlans.decidedAt),
        ),
      );
    const valorAprovado = aprovados.length
      ? (
          await tx
            .select({ s: sql<number>`coalesce(sum(${charges.amountCents}), 0)::int` })
            .from(charges)
            .where(
              and(
                inArray(
                  charges.planId,
                  aprovados.map((p) => p.id),
                ),
                ne(charges.status, 'cancelled'),
              ),
            )
        )[0]!.s
      : 0;
    const enviados = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(treatmentPlans)
      .where(and(isNotNull(treatmentPlans.sentAt), noMes(treatmentPlans.sentAt)));

    // Sinais pagos no Pix no mês.
    const sinais = await tx
      .select({
        n: sql<number>`count(*)::int`,
        s: sql<number>`coalesce(sum(${charges.amountCents}), 0)::int`,
      })
      .from(charges)
      .where(and(eq(charges.isDeposit, true), eq(charges.status, 'paid'), noMes(charges.paidAt)));

    const soma = (r: Array<{ price: number | null }>) => r.reduce((s, x) => s + (x.price ?? 0), 0);
    const espera = soma(daEspera);
    const site = soma(online);
    const retorno = soma(lembrados);
    return {
      month,
      generatedCents: espera + site + valorAprovado + retorno,
      parts: {
        recalls: {
          count: lembrados.length,
          valueCents: retorno,
          sent: enviadas('recall') + enviadas('reactivation'),
        },
        waitlist: { count: daEspera.length, valueCents: espera },
        online: { count: online.length, valueCents: site },
        plans: { count: aprovados.length, sent: enviados[0]!.n, valueCents: valorAprovado },
      },
      agenda: {
        total: doMes.length,
        done: doMes.filter((a) => a.status === 'done').length,
        noShows: faltas,
        cancelled: doMes.filter((a) => a.status === 'cancelled').length,
        noShowRate: passadas.length ? faltas / passadas.length : null,
        confirmed: confirmadas,
        confirmedByPatient: pacienteConfirmou[0]!.n,
      },
      whatsappSent: mensagens[0]!.n + lembretes.reduce((x, l) => x + l.n, 0),
      reviews: {
        requested: avaliacoes.length,
        answered: notas.length,
        average: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null,
        toGoogle: avaliacoes.filter((a) => a.google).length,
        low: notas.filter((n) => n <= 3).length,
      },
      deposits: { count: sinais[0]!.n, valueCents: sinais[0]!.s },
    };
  }
}
