import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import { addDays, localClock, zonedToUtc } from '@tagtech/domain';
import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';
import { tissXml, type TissClaim } from './tiss';
import { loadAppointments } from '../agenda/agenda.service';

const {
  appointments,
  charges,
  insuranceAuthorizations,
  insuranceBatches,
  insuranceClaims,
  insurerPrices,
  insurerProfessionals,
  insurers,
  patientInsurances,
  patients,
  professionals,
  services,
  tenants,
} = schema;

type Insurer = typeof insurers.$inferSelect;
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

export interface InsurerInput {
  name: string;
  ansCode: string;
  providerCode: string;
  paymentDays: number;
  showOnSite: boolean;
  active?: boolean | undefined;
}

export interface PriceInput {
  serviceId: string;
  priceCents: number;
  copayCents: number;
  tussCode: string;
  needsAuthorization: boolean;
}

const somarMes = (mes: string, n: number) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/**
 * Põe (ou tira) o convênio numa consulta: confere carteirinha, tabela e guia, e troca o
 * preço pelo valor do plano. Devolve avisos que não impedem (guia vencendo, sem guia).
 */
export async function applyInsurance(
  tx: TenantTx,
  appointmentId: string,
  insurerId: string | null,
  authorizationId: string | null,
): Promise<string[]> {
  const [a] = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .for('update');
  if (!a) throw new NotFoundException('Consulta não encontrada');
  if (!insurerId) {
    const [s] = await tx.select().from(services).where(eq(services.id, a.serviceId));
    await tx
      .update(appointments)
      .set({
        insurerId: null,
        authorizationId: null,
        copayCents: null,
        priceCents: s?.priceCents ?? null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, appointmentId));
    return [];
  }
  const [ins] = await tx.select().from(insurers).where(eq(insurers.id, insurerId));
  if (!ins || !ins.active) throw new NotFoundException('Convênio não encontrado');
  const [preco] = await tx
    .select()
    .from(insurerPrices)
    .where(and(eq(insurerPrices.insurerId, insurerId), eq(insurerPrices.serviceId, a.serviceId)));
  if (!preco)
    throw new BadRequestException(`${ins.name} não cobre este serviço na tabela da clínica`);
  const pros = await tx
    .select()
    .from(insurerProfessionals)
    .where(eq(insurerProfessionals.insurerId, insurerId));
  if (pros.length && !pros.some((p) => p.professionalId === a.professionalId))
    throw new BadRequestException(`Este profissional não atende pelo ${ins.name}`);
  const [cart] = await tx
    .select()
    .from(patientInsurances)
    .where(
      and(eq(patientInsurances.patientId, a.patientId), eq(patientInsurances.insurerId, insurerId)),
    );
  if (!cart)
    throw new BadRequestException(`Cadastre a carteirinha do ${ins.name} na ficha do paciente`);

  const avisos: string[] = [];
  const tz = await clinicTimezone(tx);
  const dia = localClock(a.startsAt, tz).ymd;
  if (cart.validUntil && cart.validUntil < dia)
    avisos.push('A carteirinha vence antes da consulta');
  if (authorizationId) {
    const [g] = await tx
      .select()
      .from(insuranceAuthorizations)
      .where(eq(insuranceAuthorizations.id, authorizationId));
    if (
      !g ||
      g.patientId !== a.patientId ||
      g.insurerId !== insurerId ||
      g.serviceId !== a.serviceId
    )
      throw new BadRequestException('A guia não é deste paciente, convênio e serviço');
    const [uso] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.authorizationId, authorizationId),
          ne(appointments.status, 'cancelled'),
          ne(appointments.id, appointmentId),
        ),
      );
    if (uso!.n >= g.sessions)
      throw new ConflictException(`As ${g.sessions} sessões desta guia já foram usadas`);
    if (g.validUntil && g.validUntil < dia) avisos.push('A guia vence antes da consulta');
  } else if (preco.needsAuthorization) {
    avisos.push('Este procedimento precisa de guia autorizada');
  }
  await tx
    .update(appointments)
    .set({
      insurerId,
      authorizationId,
      priceCents: preco.priceCents,
      copayCents: preco.copayCents || null,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, appointmentId));
  return avisos;
}

/** Convênios: tabela, carteirinhas, guias e faturamento com lote TISS e glosas. */
@Injectable()
export class InsuranceService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ convênios e tabela

  list(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.select().from(insurers).orderBy(asc(insurers.name));
      const precos = await tx.select().from(insurerPrices);
      const pros = await tx.select().from(insurerProfessionals);
      return rows.map((i) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
        prices: precos
          .filter((p) => p.insurerId === i.id)
          .map(({ tenantId: _t, insurerId: _i, ...p }) => p),
        professionalIds: pros.filter((p) => p.insurerId === i.id).map((p) => p.professionalId),
      }));
    });
  }

  create(ctx: TenantContext, input: InsurerInput) {
    return this.run(ctx, async (tx) => {
      const [i] = await tx
        .insert(insurers)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning();
      return i!;
    });
  }

  update(ctx: TenantContext, id: string, input: Patch<InsurerInput>) {
    return this.run(ctx, async (tx) => {
      const [i] = await tx.update(insurers).set(input).where(eq(insurers.id, id)).returning();
      if (!i) throw new NotFoundException('Convênio não encontrado');
      return i;
    });
  }

  setPrices(ctx: TenantContext, id: string, list: PriceInput[]) {
    return this.run(ctx, async (tx) => {
      const [i] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, id));
      if (!i) throw new NotFoundException('Convênio não encontrado');
      const ids = list.map((p) => p.serviceId);
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException('Serviço repetido na tabela');
      if (ids.length) {
        const found = await tx
          .select({ id: services.id })
          .from(services)
          .where(inArray(services.id, ids));
        if (found.length !== ids.length) throw new NotFoundException('Serviço não encontrado');
      }
      await tx.delete(insurerPrices).where(eq(insurerPrices.insurerId, id));
      if (list.length)
        await tx
          .insert(insurerPrices)
          .values(list.map((p) => ({ tenantId: ctx.tenantId, insurerId: id, ...p })));
    });
  }

  setProfessionals(ctx: TenantContext, id: string, ids: string[]) {
    return this.run(ctx, async (tx) => {
      const [i] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, id));
      if (!i) throw new NotFoundException('Convênio não encontrado');
      const unique = [...new Set(ids)];
      if (unique.length) {
        const found = await tx
          .select({ id: professionals.id })
          .from(professionals)
          .where(inArray(professionals.id, unique));
        if (found.length !== unique.length)
          throw new NotFoundException('Profissional não encontrado');
      }
      await tx.delete(insurerProfessionals).where(eq(insurerProfessionals.insurerId, id));
      if (unique.length)
        await tx.insert(insurerProfessionals).values(
          unique.map((professionalId) => ({
            tenantId: ctx.tenantId,
            insurerId: id,
            professionalId,
          })),
        );
    });
  }

  // ------------------------------------------------------------ paciente: carteirinha e guias

  patientCards(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      const cards = await tx
        .select({ c: patientInsurances, name: insurers.name })
        .from(patientInsurances)
        .innerJoin(insurers, eq(insurers.id, patientInsurances.insurerId))
        .where(eq(patientInsurances.patientId, patientId));
      const guias = await tx
        .select({
          g: insuranceAuthorizations,
          insurerName: insurers.name,
          serviceName: services.name,
        })
        .from(insuranceAuthorizations)
        .innerJoin(insurers, eq(insurers.id, insuranceAuthorizations.insurerId))
        .innerJoin(services, eq(services.id, insuranceAuthorizations.serviceId))
        .where(eq(insuranceAuthorizations.patientId, patientId))
        .orderBy(desc(insuranceAuthorizations.createdAt));
      const usos = guias.length
        ? await tx
            .select({ id: appointments.authorizationId, n: sql<number>`count(*)::int` })
            .from(appointments)
            .where(
              and(
                inArray(
                  appointments.authorizationId,
                  guias.map((g) => g.g.id),
                ),
                ne(appointments.status, 'cancelled'),
              ),
            )
            .groupBy(appointments.authorizationId)
        : [];
      return {
        cards: cards.map((c) => ({
          insurerId: c.c.insurerId,
          insurerName: c.name,
          cardNumber: c.c.cardNumber,
          planName: c.c.planName,
          validUntil: c.c.validUntil,
        })),
        authorizations: guias.map((g) => ({
          id: g.g.id,
          insurerId: g.g.insurerId,
          insurerName: g.insurerName,
          serviceId: g.g.serviceId,
          serviceName: g.serviceName,
          guideNumber: g.g.guideNumber,
          password: g.g.password,
          validUntil: g.g.validUntil,
          sessions: g.g.sessions,
          used: usos.find((u) => u.id === g.g.id)?.n ?? 0,
        })),
      };
    });
  }

  setCard(
    ctx: TenantContext,
    patientId: string,
    insurerId: string,
    input: { cardNumber: string; planName: string; validUntil: string | null },
  ) {
    return this.run(ctx, async (tx) => {
      const [p] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.id, patientId));
      if (!p) throw new NotFoundException('Paciente não encontrado');
      const [i] = await tx
        .select({ id: insurers.id })
        .from(insurers)
        .where(eq(insurers.id, insurerId));
      if (!i) throw new NotFoundException('Convênio não encontrado');
      await tx
        .insert(patientInsurances)
        .values({ tenantId: ctx.tenantId, patientId, insurerId, ...input })
        .onConflictDoUpdate({
          target: [patientInsurances.patientId, patientInsurances.insurerId],
          set: input,
        });
    }).then(() => this.patientCards(ctx, patientId));
  }

  removeCard(ctx: TenantContext, patientId: string, insurerId: string) {
    return this.run(ctx, (tx) =>
      tx
        .delete(patientInsurances)
        .where(
          and(
            eq(patientInsurances.patientId, patientId),
            eq(patientInsurances.insurerId, insurerId),
          ),
        ),
    ).then(() => this.patientCards(ctx, patientId));
  }

  addAuthorization(
    ctx: TenantContext,
    patientId: string,
    input: {
      insurerId: string;
      serviceId: string;
      guideNumber: string;
      password: string;
      validUntil: string | null;
      sessions: number;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const [cart] = await tx
        .select()
        .from(patientInsurances)
        .where(
          and(
            eq(patientInsurances.patientId, patientId),
            eq(patientInsurances.insurerId, input.insurerId),
          ),
        );
      if (!cart)
        throw new BadRequestException('Cadastre a carteirinha deste convênio antes da guia');
      const [s] = await tx
        .select({ id: services.id })
        .from(services)
        .where(eq(services.id, input.serviceId));
      if (!s) throw new NotFoundException('Serviço não encontrado');
      await tx
        .insert(insuranceAuthorizations)
        .values({ tenantId: ctx.tenantId, patientId, ...input });
    }).then(() => this.patientCards(ctx, patientId));
  }

  removeAuthorization(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [uso] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(eq(appointments.authorizationId, id), ne(appointments.status, 'cancelled')));
      if (uso!.n > 0)
        throw new ConflictException('Esta guia já tem consultas. Tire a guia delas antes.');
      const rows = await tx
        .delete(insuranceAuthorizations)
        .where(eq(insuranceAuthorizations.id, id))
        .returning();
      if (!rows.length) throw new NotFoundException('Guia não encontrada');
    });
  }

  setAppointmentInsurance(
    ctx: TenantContext,
    appointmentId: string,
    insurerId: string | null,
    authorizationId: string | null,
  ) {
    return this.run(ctx, async (tx) => {
      const [a] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.id, appointmentId));
      if (!a) throw new NotFoundException('Consulta não encontrada');
      const [faturada] = await tx
        .select({ id: insuranceClaims.id })
        .from(insuranceClaims)
        .where(eq(insuranceClaims.appointmentId, appointmentId));
      if (faturada) throw new ConflictException('Esta consulta já está num lote de faturamento');
      const warnings = await applyInsurance(tx, appointmentId, insurerId, authorizationId);
      const [appointment] = await loadAppointments(tx, eq(appointments.id, appointmentId));
      return { warnings, appointment };
    });
  }

  // ------------------------------------------------------------ faturamento

  /** Mês de competência: o que falta faturar por convênio e os lotes. */
  billing(ctx: TenantContext, competence: string) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(`${competence}-01`, 0, tz);
      const ate = zonedToUtc(`${somarMes(competence, 1)}-01`, 0, tz);
      const faturadas = tx.select({ id: insuranceClaims.appointmentId }).from(insuranceClaims);
      const pendentes = await tx
        .select({
          insurerId: appointments.insurerId,
          n: sql<number>`count(*)::int`,
          s: sql<number>`coalesce(sum(${appointments.priceCents}), 0)::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'done'),
            gte(appointments.startsAt, de),
            lt(appointments.startsAt, ate),
            sql`${appointments.insurerId} is not null`,
            notInArray(appointments.id, faturadas),
          ),
        )
        .groupBy(appointments.insurerId);
      const lotes = await tx
        .select({
          b: insuranceBatches,
          insurerName: insurers.name,
          billed: sql<number>`coalesce(sum(${insuranceClaims.billedCents}), 0)::int`,
          paid: sql<number>`coalesce(sum(${insuranceClaims.paidCents}), 0)::int`,
          n: sql<number>`count(${insuranceClaims.id})::int`,
        })
        .from(insuranceBatches)
        .innerJoin(insurers, eq(insurers.id, insuranceBatches.insurerId))
        .leftJoin(insuranceClaims, eq(insuranceClaims.batchId, insuranceBatches.id))
        .where(eq(insuranceBatches.competence, competence))
        .groupBy(insuranceBatches.id, insurers.name)
        .orderBy(asc(insurers.name), asc(insuranceBatches.number));
      const todos = await tx.select().from(insurers).orderBy(asc(insurers.name));
      return {
        competence,
        pending: pendentes.map((p) => ({
          insurerId: p.insurerId!,
          insurerName: todos.find((i) => i.id === p.insurerId)?.name ?? '',
          count: p.n,
          totalCents: p.s,
        })),
        batches: lotes.map((l) => ({
          id: l.b.id,
          insurerId: l.b.insurerId,
          insurerName: l.insurerName,
          number: l.b.number,
          status: l.b.status,
          sentAt: l.b.sentAt?.toISOString() ?? null,
          paidAt: l.b.paidAt?.toISOString() ?? null,
          count: l.n,
          billedCents: l.billed,
          paidCents: l.b.status === 'paid' ? l.paid : null,
          glosaCents: l.b.status === 'paid' ? l.billed - l.paid : null,
        })),
      };
    });
  }

  /** Fecha o lote: todas as consultas finalizadas do convênio no mês que ainda não foram faturadas. */
  createBatch(ctx: TenantContext, insurerId: string, competence: string) {
    return this.run(ctx, async (tx) => {
      const [ins] = await tx.select().from(insurers).where(eq(insurers.id, insurerId));
      if (!ins) throw new NotFoundException('Convênio não encontrado');
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(`${competence}-01`, 0, tz);
      const ate = zonedToUtc(`${somarMes(competence, 1)}-01`, 0, tz);
      const faturadas = tx.select({ id: insuranceClaims.appointmentId }).from(insuranceClaims);
      const consultas = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'done'),
            eq(appointments.insurerId, insurerId),
            gte(appointments.startsAt, de),
            lt(appointments.startsAt, ate),
            notInArray(appointments.id, faturadas),
          ),
        );
      if (!consultas.length)
        throw new ConflictException('Não há consultas finalizadas para faturar neste mês');
      const [ultimo] = await tx
        .select({ n: sql<number>`coalesce(max(${insuranceBatches.number}), 0)::int` })
        .from(insuranceBatches)
        .where(eq(insuranceBatches.insurerId, insurerId));
      const [b] = await tx
        .insert(insuranceBatches)
        .values({ tenantId: ctx.tenantId, insurerId, competence, number: ultimo!.n + 1 })
        .returning();
      await tx.insert(insuranceClaims).values(
        consultas.map((c) => ({
          tenantId: ctx.tenantId,
          batchId: b!.id,
          appointmentId: c.id,
          billedCents: c.priceCents ?? 0,
        })),
      );
      return this.batchView(tx, b!.id);
    });
  }

  getBatch(ctx: TenantContext, id: string) {
    return this.run(ctx, (tx) => this.batchView(tx, id));
  }

  private async batchView(tx: TenantTx, id: string) {
    const [b] = await tx
      .select({ b: insuranceBatches, ins: insurers })
      .from(insuranceBatches)
      .innerJoin(insurers, eq(insurers.id, insuranceBatches.insurerId))
      .where(eq(insuranceBatches.id, id));
    if (!b) throw new NotFoundException('Lote não encontrado');
    const claims = await this.claims(tx, id, b.ins.id);
    return {
      id: b.b.id,
      insurerId: b.ins.id,
      insurerName: b.ins.name,
      number: b.b.number,
      competence: b.b.competence,
      status: b.b.status,
      sentAt: b.b.sentAt?.toISOString() ?? null,
      paidAt: b.b.paidAt?.toISOString() ?? null,
      claims: claims.map((c) => ({
        id: c.id,
        appointmentId: c.appointmentId,
        date: c.date,
        patientName: c.patientName,
        cardNumber: c.cardNumber,
        serviceName: c.serviceName,
        professionalName: c.professionalName,
        guideNumber: c.guideNumber,
        tussCode: c.tussCode,
        billedCents: c.billedCents,
        paidCents: c.paidCents,
        glosaReason: c.glosaReason,
      })),
      billedCents: claims.reduce((s, c) => s + c.billedCents, 0),
    };
  }

  private async claims(tx: TenantTx, batchId: string, insurerId: string) {
    const tz = await clinicTimezone(tx);
    const rows = await tx
      .select({
        c: insuranceClaims,
        a: appointments,
        patientName: patients.name,
        serviceName: services.name,
        pro: professionals,
        guide: insuranceAuthorizations.guideNumber,
        password: insuranceAuthorizations.password,
      })
      .from(insuranceClaims)
      .innerJoin(appointments, eq(appointments.id, insuranceClaims.appointmentId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
      .leftJoin(
        insuranceAuthorizations,
        eq(insuranceAuthorizations.id, appointments.authorizationId),
      )
      .where(eq(insuranceClaims.batchId, batchId))
      .orderBy(asc(appointments.startsAt));
    const cards = await tx
      .select()
      .from(patientInsurances)
      .where(eq(patientInsurances.insurerId, insurerId));
    const precos = await tx
      .select()
      .from(insurerPrices)
      .where(eq(insurerPrices.insurerId, insurerId));
    return rows.map((r) => ({
      id: r.c.id,
      appointmentId: r.a.id,
      date: localClock(r.a.startsAt, tz).ymd,
      patientName: r.patientName,
      cardNumber: cards.find((c) => c.patientId === r.a.patientId)?.cardNumber ?? '',
      serviceName: r.serviceName,
      professionalName: r.pro.name,
      council: r.pro.council,
      guideNumber: r.guide,
      guidePassword: r.password,
      tussCode: precos.find((p) => p.serviceId === r.a.serviceId)?.tussCode ?? '',
      billedCents: r.c.billedCents,
      paidCents: r.c.paidCents,
      glosaReason: r.c.glosaReason,
    }));
  }

  /** Arquivo TISS do lote, para enviar no portal da operadora. */
  tiss(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [b] = await tx
        .select({ b: insuranceBatches, ins: insurers })
        .from(insuranceBatches)
        .innerJoin(insurers, eq(insurers.id, insuranceBatches.insurerId))
        .where(eq(insuranceBatches.id, id));
      if (!b) throw new NotFoundException('Lote não encontrado');
      const [t] = await tx.select().from(tenants);
      const claims: TissClaim[] = (await this.claims(tx, id, b.ins.id)).map((c) => ({
        date: c.date,
        cardNumber: c.cardNumber,
        guideNumber: c.guideNumber,
        professionalName: c.professionalName,
        council: c.council,
        tussCode: c.tussCode,
        valueCents: c.billedCents,
        claimId: c.id,
      }));
      return {
        fileName: `lote-${b.ins.ansCode || 'operadora'}-${b.b.number}.xml`,
        xml: tissXml({
          ansCode: b.ins.ansCode,
          providerCode: b.ins.providerCode || t!.document,
          batchNumber: b.b.number,
          now: new Date(),
          claims,
        }),
      };
    });
  }

  /** Envia o lote: vira conta a receber do convênio, com o prazo de pagamento dele. */
  sendBatch(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [b] = await tx
        .select()
        .from(insuranceBatches)
        .where(eq(insuranceBatches.id, id))
        .for('update');
      if (!b) throw new NotFoundException('Lote não encontrado');
      if (b.status !== 'open') throw new ConflictException('Este lote já foi enviado');
      const [ins] = await tx.select().from(insurers).where(eq(insurers.id, b.insurerId));
      const [{ total }] = (await tx
        .select({ total: sql<number>`coalesce(sum(${insuranceClaims.billedCents}), 0)::int` })
        .from(insuranceClaims)
        .where(eq(insuranceClaims.batchId, id))) as [{ total: number }];
      const tz = await clinicTimezone(tx);
      let chargeId: string | null = null;
      if (total > 0) {
        const [c] = await tx
          .insert(charges)
          .values({
            tenantId: ctx.tenantId,
            description: `${ins!.name} · lote ${b.number} (${b.competence})`.slice(0, 160),
            amountCents: total,
            dueDate: addDays(localClock(new Date(), tz).ymd, ins!.paymentDays),
            createdBy: ctx.user.userId,
          })
          .returning();
        chargeId = c!.id;
      }
      await tx
        .update(insuranceBatches)
        .set({ status: 'sent', sentAt: new Date(), chargeId })
        .where(eq(insuranceBatches.id, id));
      return this.batchView(tx, id);
    });
  }

  /**
   * Retorno do convênio: o que pagou em cada guia e o motivo de cada glosa. A conta a
   * receber passa a valer o que entrou e fica recebida.
   */
  receiveBatch(
    ctx: TenantContext,
    id: string,
    items: Array<{ claimId: string; paidCents: number; glosaReason: string }>,
  ) {
    return this.run(ctx, async (tx) => {
      const [b] = await tx
        .select()
        .from(insuranceBatches)
        .where(eq(insuranceBatches.id, id))
        .for('update');
      if (!b) throw new NotFoundException('Lote não encontrado');
      if (b.status !== 'sent')
        throw new ConflictException('Registre o pagamento de um lote enviado');
      const claims = await tx.select().from(insuranceClaims).where(eq(insuranceClaims.batchId, id));
      for (const c of claims) {
        const it = items.find((x) => x.claimId === c.id);
        const pago = it ? Math.min(it.paidCents, c.billedCents) : c.billedCents;
        if (pago < c.billedCents && !(it?.glosaReason ?? '').trim())
          throw new BadRequestException('Informe o motivo de cada glosa');
        await tx
          .update(insuranceClaims)
          .set({ paidCents: pago, glosaReason: pago < c.billedCents ? it!.glosaReason.trim() : '' })
          .where(eq(insuranceClaims.id, c.id));
      }
      const totalPago = claims.reduce((s, c) => {
        const it = items.find((x) => x.claimId === c.id);
        return s + (it ? Math.min(it.paidCents, c.billedCents) : c.billedCents);
      }, 0);
      if (b.chargeId) {
        if (totalPago > 0)
          await tx
            .update(charges)
            .set({ amountCents: totalPago, status: 'paid', method: 'transfer', paidAt: new Date() })
            .where(and(eq(charges.id, b.chargeId), eq(charges.status, 'open')));
        else
          await tx
            .update(charges)
            .set({ status: 'cancelled' })
            .where(and(eq(charges.id, b.chargeId), eq(charges.status, 'open')));
      }
      await tx
        .update(insuranceBatches)
        .set({ status: 'paid', paidAt: new Date() })
        .where(eq(insuranceBatches.id, id));
      return this.batchView(tx, id);
    });
  }

  /** Recurso de glosa: a guia glosada volta para um lote novo (aberto) do mesmo convênio. */
  rebill(ctx: TenantContext, claimId: string) {
    return this.run(ctx, async (tx) => {
      const [c] = await tx
        .select({ c: insuranceClaims, b: insuranceBatches })
        .from(insuranceClaims)
        .innerJoin(insuranceBatches, eq(insuranceBatches.id, insuranceClaims.batchId))
        .where(eq(insuranceClaims.id, claimId))
        .for('update');
      if (!c) throw new NotFoundException('Guia não encontrada');
      if (c.b.status !== 'paid' || c.c.paidCents === null || c.c.paidCents >= c.c.billedCents)
        throw new ConflictException('Só guia glosada pode ser reapresentada');
      const [ja] = await tx
        .select({ id: insuranceClaims.id })
        .from(insuranceClaims)
        .where(eq(insuranceClaims.rebillOf, claimId));
      if (ja) throw new ConflictException('Esta glosa já foi reapresentada');
      const glosa = c.c.billedCents - c.c.paidCents;
      let [aberto] = await tx
        .select()
        .from(insuranceBatches)
        .where(
          and(eq(insuranceBatches.insurerId, c.b.insurerId), eq(insuranceBatches.status, 'open')),
        )
        .orderBy(desc(insuranceBatches.number))
        .limit(1);
      if (!aberto) {
        const [ultimo] = await tx
          .select({ n: sql<number>`coalesce(max(${insuranceBatches.number}), 0)::int` })
          .from(insuranceBatches)
          .where(eq(insuranceBatches.insurerId, c.b.insurerId));
        const tz = await clinicTimezone(tx);
        [aberto] = await tx
          .insert(insuranceBatches)
          .values({
            tenantId: ctx.tenantId,
            insurerId: c.b.insurerId,
            competence: localClock(new Date(), tz).ymd.slice(0, 7),
            number: ultimo!.n + 1,
          })
          .returning();
      }
      // Guia nova, só com o valor glosado, ligada à original.
      await tx.insert(insuranceClaims).values({
        tenantId: ctx.tenantId,
        batchId: aberto!.id,
        appointmentId: c.c.appointmentId,
        billedCents: glosa,
        glosaReason: `Reapresentação: ${c.c.glosaReason}`.slice(0, 200),
        rebillOf: claimId,
      });
      return this.batchView(tx, aberto!.id);
    });
  }

  /** Faturamento por convênio no ano: faturado, recebido, glosado e a receber. */
  report(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          insurerId: insuranceBatches.insurerId,
          name: insurers.name,
          status: insuranceBatches.status,
          billed: sql<number>`coalesce(sum(${insuranceClaims.billedCents}), 0)::int`,
          paid: sql<number>`coalesce(sum(${insuranceClaims.paidCents}), 0)::int`,
        })
        .from(insuranceBatches)
        .innerJoin(insurers, eq(insurers.id, insuranceBatches.insurerId))
        .leftJoin(insuranceClaims, eq(insuranceClaims.batchId, insuranceBatches.id))
        .groupBy(insuranceBatches.insurerId, insurers.name, insuranceBatches.status);
      const por = new Map<
        string,
        {
          insurerId: string;
          name: string;
          billedCents: number;
          paidCents: number;
          glosaCents: number;
          receivableCents: number;
        }
      >();
      for (const r of rows) {
        const x = por.get(r.insurerId) ?? {
          insurerId: r.insurerId,
          name: r.name,
          billedCents: 0,
          paidCents: 0,
          glosaCents: 0,
          receivableCents: 0,
        };
        x.billedCents += r.billed;
        if (r.status === 'paid') {
          x.paidCents += r.paid;
          x.glosaCents += r.billed - r.paid;
        } else if (r.status === 'sent') x.receivableCents += r.billed;
        por.set(r.insurerId, x);
      }
      return [...por.values()];
    });
  }
}

export type InsurerRow = Insurer;
