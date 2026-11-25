import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { expiredDeposits, resolvePixPayment, schema, withTenant, type TenantTx } from '@tagtech/db';
import { localClock, type PayMethod } from '@tagtech/domain';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { RelationshipService } from '../relationship/relationship.service';
import { NfseService } from '../nfse/nfse.service';
import { fakePixAllowed, FakePix, MercadoPagoPix, PixProviderError, type PixProvider } from './pix';

const {
  appointmentEvents,
  appointments,
  charges,
  clinicPaymentCredentials,
  expenses,
  patients,
  pixPayments,
  tenants,
  units,
} = schema;

/** Fuso da clínica (o da primeira unidade). */
export async function clinicTimezone(tx: TenantTx): Promise<string> {
  const [u] = await tx
    .select({ tz: units.timezone })
    .from(units)
    .orderBy(asc(units.createdAt))
    .limit(1);
  return u?.tz ?? 'America/Sao_Paulo';
}

type Charge = typeof charges.$inferSelect;
export const PIX_MINUTES = 30;
const VARREDURA_MS = 60_000;

export function chargeView(c: Charge, patientName?: string | null) {
  return {
    id: c.id,
    patientId: c.patientId,
    patientName: patientName ?? null,
    planId: c.planId,
    appointmentId: c.appointmentId,
    description: c.description,
    amountCents: c.amountCents,
    dueDate: c.dueDate,
    installment: c.installment,
    installments: c.installments,
    isDeposit: c.isDeposit,
    status: c.status,
    method: c.method,
    paidAt: c.paidAt?.toISOString() ?? null,
  };
}

function expenseView(e: typeof expenses.$inferSelect) {
  return {
    id: e.id,
    description: e.description,
    category: e.category,
    supplier: e.supplier,
    amountCents: e.amountCents,
    dueDate: e.dueDate,
    status: e.status,
    method: e.method,
    paidAt: e.paidAt?.toISOString() ?? null,
  };
}

const apiBase = () => (process.env.TEAM_APP_URL ?? '').replace(/\/+$/, '');

/**
 * Dinheiro da clínica: contas a receber (parcelas, consultas, sinal), contas a pagar e
 * Pix pelo Mercado Pago com a credencial da própria clínica.
 */
@Injectable()
export class FinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Financeiro');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DbService) private readonly dbService: DbService,
    @Inject(NfseService) private readonly nfse: NfseService,
    @Inject(RelationshipService) private readonly relationship: RelationshipService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.sweepDeposits(new Date()).catch((e: unknown) => this.log.error(e));
    }, VARREDURA_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ a receber

  listCharges(
    ctx: TenantContext,
    q: {
      status?: 'open' | 'paid' | 'cancelled' | undefined;
      from?: string | undefined;
      to?: string | undefined;
      patientId?: string | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({ c: charges, patientName: patients.name })
        .from(charges)
        .leftJoin(patients, eq(patients.id, charges.patientId))
        .where(
          and(
            q.status ? eq(charges.status, q.status) : undefined,
            q.from ? gte(charges.dueDate, q.from) : undefined,
            q.to ? lte(charges.dueDate, q.to) : undefined,
            q.patientId ? eq(charges.patientId, q.patientId) : undefined,
          ),
        )
        .orderBy(asc(charges.dueDate), asc(charges.installment))
        .limit(500);
      return rows.map((r) => chargeView(r.c, r.patientName));
    });
  }

  createCharge(
    ctx: TenantContext,
    input: {
      patientId?: string | undefined;
      appointmentId?: string | undefined;
      description: string;
      amountCents: number;
      dueDate: string;
    },
  ) {
    return this.run(ctx, async (tx) => {
      if (input.patientId) {
        const [p] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(eq(patients.id, input.patientId));
        if (!p) throw new NotFoundException('Paciente não encontrado');
      }
      let patientId = input.patientId ?? null;
      if (input.appointmentId) {
        const [a] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, input.appointmentId));
        if (!a) throw new NotFoundException('Consulta não encontrada');
        patientId = a.patientId;
      }
      const [c] = await tx
        .insert(charges)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          appointmentId: input.appointmentId ?? null,
          description: input.description,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          createdBy: ctx.user.userId,
        })
        .returning();
      return chargeView(c!);
    });
  }

  /** Recebe (baixa) uma cobrança. */
  async payCharge(ctx: TenantContext, id: string, method: PayMethod, paidAt?: Date) {
    const view = await this.run(ctx, async (tx) => {
      const [c] = await tx.select().from(charges).where(eq(charges.id, id)).for('update');
      if (!c) throw new NotFoundException('Cobrança não encontrada');
      if (c.status !== 'open') throw new ConflictException('Esta cobrança não está em aberto');
      const [row] = await tx
        .update(charges)
        .set({ status: 'paid', method, paidAt: paidAt ?? new Date() })
        .where(eq(charges.id, id))
        .returning();
      return chargeView(row!);
    });
    this.nfse.autoEmit(ctx.tenantId, id);
    return view;
  }

  cancelCharge(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(charges)
        .set({ status: 'cancelled' })
        .where(and(eq(charges.id, id), eq(charges.status, 'open')))
        .returning();
      if (!row) throw new ConflictException('Só dá para cancelar cobrança em aberto');
      return chargeView(row);
    });
  }

  /** Estorna um recebimento lançado por engano (volta a ficar em aberto). */
  reopenCharge(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(charges)
        .set({ status: 'open', method: null, paidAt: null })
        .where(and(eq(charges.id, id), eq(charges.status, 'paid')))
        .returning();
      if (!row) throw new ConflictException('Só dá para estornar cobrança recebida');
      return chargeView(row);
    });
  }

  /** Recibo de um recebimento (o paciente usa para pedir reembolso ao plano). */
  receipt(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const [c] = await tx.select().from(charges).where(eq(charges.id, id));
      if (!c) throw new NotFoundException('Cobrança não encontrada');
      if (c.status !== 'paid') throw new ConflictException('Recibo só de valor recebido');
      const [t] = await tx.select().from(tenants);
      const [u] = await tx.select().from(units).orderBy(asc(units.createdAt)).limit(1);
      const [p] = c.patientId
        ? await tx.select().from(patients).where(eq(patients.id, c.patientId))
        : [undefined];
      let atendimento: {
        date: string;
        serviceName: string;
        professionalName: string;
        council: string;
      } | null = null;
      if (c.appointmentId) {
        const [a] = await tx
          .select({ a: appointments, s: schema.services.name, pr: schema.professionals })
          .from(appointments)
          .innerJoin(schema.services, eq(schema.services.id, appointments.serviceId))
          .innerJoin(schema.professionals, eq(schema.professionals.id, appointments.professionalId))
          .where(eq(appointments.id, c.appointmentId));
        if (a)
          atendimento = {
            date: localClock(a.a.startsAt, u?.timezone ?? 'America/Sao_Paulo').ymd,
            serviceName: a.s,
            professionalName: a.pr.name,
            council: a.pr.council,
          };
      }
      return {
        number: c.id.slice(0, 8).toUpperCase(),
        clinic: {
          name: t!.name,
          legalName: t!.legalName,
          document: t!.document,
          address: u?.address ?? '',
          phone: u?.phone ?? '',
        },
        patient: p ? { name: p.name, cpf: p.cpf } : null,
        description: c.description,
        amountCents: c.amountCents,
        method: c.method,
        paidAt: c.paidAt!.toISOString(),
        appointment: atendimento,
      };
    });
  }

  // ------------------------------------------------------------ a pagar

  listExpenses(ctx: TenantContext, q: { from?: string | undefined; to?: string | undefined }) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(expenses)
        .where(
          and(
            q.from ? gte(expenses.dueDate, q.from) : undefined,
            q.to ? lte(expenses.dueDate, q.to) : undefined,
          ),
        )
        .orderBy(asc(expenses.dueDate))
        .limit(500);
      return rows.map(expenseView);
    });
  }

  createExpense(
    ctx: TenantContext,
    input: {
      description: string;
      category: string;
      supplier: string;
      amountCents: number;
      dueDate: string;
      paid?: { method: PayMethod } | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const { paid, ...rest } = input;
      const [row] = await tx
        .insert(expenses)
        .values({
          tenantId: ctx.tenantId,
          ...rest,
          createdBy: ctx.user.userId,
          ...(paid ? { status: 'paid' as const, method: paid.method, paidAt: new Date() } : {}),
        })
        .returning();
      return expenseView(row!);
    });
  }

  payExpense(ctx: TenantContext, id: string, method: PayMethod) {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .update(expenses)
        .set({ status: 'paid', method, paidAt: new Date() })
        .where(and(eq(expenses.id, id), eq(expenses.status, 'open')))
        .returning();
      if (!row) throw new ConflictException('Esta conta não está em aberto');
      return expenseView(row);
    });
  }

  deleteExpense(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.delete(expenses).where(eq(expenses.id, id)).returning();
      if (!rows.length) throw new NotFoundException('Conta não encontrada');
    });
  }

  // ------------------------------------------------------------ resumo

  /** Resumo de um mês (YYYY-MM): recebido, a receber, pago, a pagar e o resultado. */
  summary(ctx: TenantContext, month: string) {
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return this.run(ctx, async (tx) => {
      const timezone = await clinicTimezone(tx);
      // "Recebido no mês" conta pela data em que entrou o dinheiro, no fuso da clínica.
      const pagos = await tx.select().from(charges).where(eq(charges.status, 'paid'));
      const noMes = (d: Date | null) => {
        if (!d) return false;
        const ymd = localClock(d, timezone).ymd;
        return ymd >= from && ymd <= to;
      };
      const recebidos = pagos.filter((c) => noMes(c.paidAt));
      const [aReceber] = await tx
        .select({ s: sql<number>`coalesce(sum(${charges.amountCents}), 0)::int` })
        .from(charges)
        .where(
          and(eq(charges.status, 'open'), gte(charges.dueDate, from), lte(charges.dueDate, to)),
        );
      const [vencido] = await tx
        .select({ s: sql<number>`coalesce(sum(${charges.amountCents}), 0)::int` })
        .from(charges)
        .where(
          and(
            eq(charges.status, 'open'),
            lt(charges.dueDate, localClock(new Date(), timezone).ymd),
          ),
        );
      const contas = await tx
        .select()
        .from(expenses)
        .where(and(gte(expenses.dueDate, from), lte(expenses.dueDate, to)));
      const porMetodo: Record<string, number> = {};
      for (const c of recebidos) porMetodo[c.method!] = (porMetodo[c.method!] ?? 0) + c.amountCents;
      const recebido = recebidos.reduce((s, c) => s + c.amountCents, 0);
      const pago = contas.filter((e) => e.status === 'paid').reduce((s, e) => s + e.amountCents, 0);
      const aPagar = contas
        .filter((e) => e.status === 'open')
        .reduce((s, e) => s + e.amountCents, 0);
      const porCategoria: Record<string, number> = {};
      for (const e of contas.filter((x) => x.status !== 'cancelled'))
        porCategoria[e.category || 'Sem categoria'] =
          (porCategoria[e.category || 'Sem categoria'] ?? 0) + e.amountCents;
      // Dia a dia do mês, para o gráfico de receitas x despesas.
      const dias = new Map<string, { receivedCents: number; paidCents: number }>();
      for (let d = 1; d <= Number(to.slice(8)); d++)
        dias.set(`${month}-${String(d).padStart(2, '0')}`, { receivedCents: 0, paidCents: 0 });
      for (const c of recebidos)
        dias.get(localClock(c.paidAt!, timezone).ymd)!.receivedCents += c.amountCents;
      for (const e of contas.filter((x) => x.status === 'paid')) {
        const dia =
          dias.get(e.paidAt ? localClock(e.paidAt, timezone).ymd : e.dueDate) ??
          dias.get(e.dueDate);
        if (dia) dia.paidCents += e.amountCents;
      }
      return {
        month,
        daily: [...dias.entries()].map(([date, v]) => ({ date, ...v })),
        receivedCents: recebido,
        toReceiveCents: aReceber!.s,
        overdueCents: vencido!.s,
        paidCents: pago,
        toPayCents: aPagar,
        resultCents: recebido - pago,
        byMethod: porMetodo,
        byCategory: porCategoria,
      };
    });
  }

  /** Caixa de um dia: o que entrou, por forma de pagamento, e cada recebimento. */
  cashbox(ctx: TenantContext, day: string) {
    return this.run(ctx, async (tx) => {
      const timezone = await clinicTimezone(tx);
      const rows = await tx
        .select({ c: charges, patientName: patients.name })
        .from(charges)
        .leftJoin(patients, eq(patients.id, charges.patientId))
        .where(eq(charges.status, 'paid'))
        .orderBy(desc(charges.paidAt));
      const doDia = rows.filter((r) => r.c.paidAt && localClock(r.c.paidAt, timezone).ymd === day);
      const porMetodo: Record<string, number> = {};
      for (const r of doDia)
        porMetodo[r.c.method!] = (porMetodo[r.c.method!] ?? 0) + r.c.amountCents;
      return {
        day,
        totalCents: doDia.reduce((s, r) => s + r.c.amountCents, 0),
        byMethod: porMetodo,
        items: doDia.map((r) => chargeView(r.c, r.patientName)),
      };
    });
  }

  // ------------------------------------------------------------ Pix

  async pixSettings(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const [c] = await tx.select().from(clinicPaymentCredentials);
      const [t] = await tx.select().from(tenants);
      return {
        configured: Boolean(c),
        depositCents: t!.bookingDepositCents,
        testMode: !c && fakePixAllowed(),
      };
    });
  }

  async savePix(
    ctx: TenantContext,
    input: { accessToken?: string | undefined; depositCents?: number | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      if (input.accessToken) {
        const values = { accessToken: input.accessToken, updatedAt: new Date() };
        await tx
          .insert(clinicPaymentCredentials)
          .values({ tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({ target: clinicPaymentCredentials.tenantId, set: values });
      }
      if (input.depositCents !== undefined) {
        await tx
          .update(tenants)
          .set({ bookingDepositCents: input.depositCents })
          .where(eq(tenants.id, ctx.tenantId));
      }
      const [c] = await tx.select().from(clinicPaymentCredentials);
      const [t] = await tx.select().from(tenants);
      return {
        configured: Boolean(c),
        depositCents: t!.bookingDepositCents,
        testMode: !c && fakePixAllowed(),
      };
    });
  }

  async removePix(ctx: TenantContext) {
    await this.run(ctx, (tx) => tx.delete(clinicPaymentCredentials));
    return this.pixSettings(ctx);
  }

  /** Provedor da clínica; sem credencial, o Pix de teste (só fora de produção). */
  async provider(tx: TenantTx): Promise<PixProvider | null> {
    const [c] = await tx.select().from(clinicPaymentCredentials);
    if (c) return new MercadoPagoPix(c.accessToken);
    return fakePixAllowed() ? new FakePix() : null;
  }

  /** Gera (ou devolve o que ainda vale) o Pix de uma cobrança em aberto. */
  async pixForCharge(tenantId: string, chargeId: string) {
    return withTenant(this.dbService.db, tenantId, async (tx) => {
      const [c] = await tx.select().from(charges).where(eq(charges.id, chargeId)).for('update');
      if (!c) throw new NotFoundException('Cobrança não encontrada');
      if (c.status !== 'open') throw new ConflictException('Esta cobrança não está em aberto');
      const [vivo] = await tx
        .select()
        .from(pixPayments)
        .where(
          and(
            eq(pixPayments.chargeId, chargeId),
            eq(pixPayments.status, 'pending'),
            gte(pixPayments.expiresAt, new Date(Date.now() + 60_000)),
          ),
        )
        .orderBy(desc(pixPayments.createdAt))
        .limit(1);
      if (vivo) return pixView(vivo);
      const provider = await this.provider(tx);
      if (!provider)
        throw new ServiceUnavailableException(
          'Configure o Mercado Pago da clínica para cobrar no Pix',
        );
      const [tenant] = await tx.select().from(tenants);
      const id = crypto.randomUUID();
      const base = apiBase();
      let charge;
      try {
        charge = await provider.create({
          amountCents: c.amountCents,
          description: `${tenant!.name}: ${c.description}`.slice(0, 120),
          chargeId: c.id,
          notificationUrl: base ? `${base}/api/public/pix/${id}` : null,
          expiresAt: new Date(Date.now() + PIX_MINUTES * 60_000),
          idempotencyKey: id,
        });
      } catch (e) {
        if (e instanceof PixProviderError) throw new ServiceUnavailableException(e.message);
        throw e;
      }
      const [row] = await tx
        .insert(pixPayments)
        .values({
          id,
          tenantId,
          chargeId,
          provider: provider.name,
          providerPaymentId: charge.providerPaymentId,
          amountCents: c.amountCents,
          pixCode: charge.pixCode,
          pixQrBase64: charge.qrBase64,
          expiresAt: charge.expiresAt,
        })
        .returning();
      return pixView(row!);
    });
  }

  chargePix(ctx: TenantContext, chargeId: string) {
    return this.pixForCharge(ctx.tenantId, chargeId);
  }

  /**
   * Aviso do Mercado Pago (ou conferência manual). Sempre pergunta a situação ao provedor:
   * o aviso sozinho não prova pagamento.
   */
  async checkPix(pixId: string): Promise<{ status: string }> {
    const tenantId = await resolvePixPayment(this.dbService.db, pixId);
    if (!tenantId) throw new NotFoundException();
    let emitir = null as string | null;
    const out = await withTenant(this.dbService.db, tenantId, async (tx) => {
      const [p] = await tx
        .select()
        .from(pixPayments)
        .where(eq(pixPayments.id, pixId))
        .for('update');
      if (!p || p.status !== 'pending') return { status: p?.status ?? 'unknown' };
      const provider = await this.provider(tx);
      if (!provider || provider.name !== p.provider) return { status: p.status };
      const r = await provider.status(p.providerPaymentId);
      if (r.status === 'pending') return { status: 'pending' };
      if (r.status === 'approved' && r.amountCents !== null && r.amountCents < p.amountCents) {
        this.log.warn(`Pix ${pixId} pago com valor menor (${r.amountCents} < ${p.amountCents})`);
        return { status: 'pending' };
      }
      await tx
        .update(pixPayments)
        .set({ status: r.status, updatedAt: new Date() })
        .where(eq(pixPayments.id, pixId));
      if (r.status === 'approved') {
        const baixou = await tx
          .update(charges)
          .set({ status: 'paid', method: 'pix', paidAt: new Date() })
          .where(and(eq(charges.id, p.chargeId), eq(charges.status, 'open')))
          .returning({ id: charges.id });
        if (baixou.length) emitir = p.chargeId;
      }
      return { status: r.status };
    });
    if (emitir) this.nfse.autoEmit(tenantId, emitir);
    return out;
  }

  /** Pix de teste: aprova na hora (só fora de produção). */
  async approveFake(pixId: string) {
    if (!fakePixAllowed()) throw new NotFoundException();
    const tenantId = await resolvePixPayment(this.dbService.db, pixId);
    if (!tenantId) throw new NotFoundException();
    const p = await withTenant(
      this.dbService.db,
      tenantId,
      async (tx) => (await tx.select().from(pixPayments).where(eq(pixPayments.id, pixId)))[0],
    );
    if (!p || p.provider !== 'fake')
      throw new BadRequestException('Só o Pix de teste aprova por aqui');
    FakePix.approved.add(p.providerPaymentId);
    return this.checkPix(pixId);
  }

  /**
   * Sinais do site que venceram sem pagamento: confere uma última vez com o provedor e,
   * sem pagamento, cancela a consulta para liberar o horário.
   */
  async sweepDeposits(now: Date): Promise<number> {
    const due = await expiredDeposits(this.dbService.db, now);
    let canceladas = 0;
    for (const d of due) {
      const pendentes = await withTenant(this.dbService.db, d.tenantId, (tx) =>
        tx
          .select({ id: pixPayments.id })
          .from(pixPayments)
          .where(and(eq(pixPayments.chargeId, d.chargeId), eq(pixPayments.status, 'pending'))),
      );
      for (const p of pendentes) await this.checkPix(p.id).catch(() => undefined);
      const feito = await withTenant(this.dbService.db, d.tenantId, async (tx) => {
        const [c] = await tx.select().from(charges).where(eq(charges.id, d.chargeId)).for('update');
        if (!c || c.status !== 'open') return false;
        await tx.update(charges).set({ status: 'cancelled' }).where(eq(charges.id, c.id));
        await tx
          .update(pixPayments)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(and(eq(pixPayments.chargeId, c.id), eq(pixPayments.status, 'pending')));
        if (!c.appointmentId) return true;
        const [a] = await tx
          .update(appointments)
          .set({ status: 'cancelled', cancelReason: 'Sinal não pago', updatedAt: new Date() })
          .where(
            and(
              eq(appointments.id, c.appointmentId),
              inArray(appointments.status, ['scheduled', 'confirmed']),
            ),
          )
          .returning();
        if (a) {
          await tx.insert(appointmentEvents).values({
            tenantId: d.tenantId,
            appointmentId: a.id,
            fromStatus: 'scheduled',
            toStatus: 'cancelled',
            actorKind: 'system',
            reason: 'Sinal não pago',
          });
          return a.id;
        }
        return true;
      });
      if (feito) canceladas++;
      if (typeof feito === 'string') this.relationship.slotFreed(d.tenantId, feito);
    }
    return canceladas;
  }
}

export function pixView(p: typeof pixPayments.$inferSelect) {
  return {
    id: p.id,
    status: p.status,
    amountCents: p.amountCents,
    pixCode: p.pixCode,
    qrBase64: p.pixQrBase64,
    expiresAt: p.expiresAt.toISOString(),
    test: p.provider === 'fake',
  };
}
