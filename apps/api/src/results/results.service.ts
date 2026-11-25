import { Inject, Injectable } from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { zonedToUtc } from '@tagtech/domain';
import { and, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const { appointmentEvents, appointmentMessages, appointments, charges, treatmentPlans, waitlist } =
  schema;

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

    // Agendamentos que o paciente fez sozinho pelo site (feitos no mês, não cancelados).
    const online = await tx
      .select({ price: appointments.priceCents })
      .from(appointments)
      .where(
        and(
          eq(appointments.source, 'online'),
          noMes(appointments.createdAt),
          ne(appointments.status, 'cancelled'),
        ),
      );

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
    return {
      month,
      generatedCents: espera + site + valorAprovado,
      parts: {
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
      whatsappSent: mensagens[0]!.n,
      deposits: { count: sinais[0]!.n, valueCents: sinais[0]!.s },
    };
  }
}
