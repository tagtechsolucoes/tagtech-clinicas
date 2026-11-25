import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateToken, resolvePlanToken, schema, withTenant, type TenantTx } from '@tagtech/db';
import { localClock, monthlyDueDates, planTotals, splitInstallments } from '@tagtech/domain';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { clinicView } from '../clinic/clinic.service';
import { inClinic } from '../common/clinic-scope';
import { hashToken } from '../common/token';
import { DbService } from '../db/db.module';
import { chargeView, clinicTimezone } from './finance.service';

const {
  appointments,
  charges,
  patients,
  professionals,
  services,
  tenants,
  treatmentPlanItems,
  treatmentPlans,
} = schema;

type Plan = typeof treatmentPlans.$inferSelect;
type Item = typeof treatmentPlanItems.$inferSelect;

export interface PlanItemInput {
  serviceId?: string | undefined;
  description: string;
  tooth?: number | null | undefined;
  quantity: number;
  unitPriceCents: number;
}

export interface PlanInput {
  title: string;
  professionalId?: string | null | undefined;
  discountCents: number;
  cashDiscountPct: number;
  maxInstallments: number;
  notes: string;
  validUntil?: string | null | undefined;
  items: PlanItemInput[];
}

function itemView(i: Item) {
  return {
    id: i.id,
    serviceId: i.serviceId,
    description: i.description,
    tooth: i.tooth,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    appointmentId: i.appointmentId,
  };
}

function planView(p: Plan, items: Item[], extra: { professionalName?: string | null } = {}) {
  const totals = planTotals(
    items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    p.discountCents,
    p.cashDiscountPct,
  );
  return {
    id: p.id,
    patientId: p.patientId,
    professionalId: p.professionalId,
    professionalName: extra.professionalName ?? null,
    title: p.title,
    status: p.status,
    discountCents: p.discountCents,
    cashDiscountPct: p.cashDiscountPct,
    maxInstallments: p.maxInstallments,
    notes: p.notes,
    validUntil: p.validUntil,
    chosenInstallments: p.chosenInstallments,
    sentAt: p.sentAt?.toISOString() ?? null,
    decidedAt: p.decidedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    ...totals,
    items: items.map(itemView),
  };
}

/**
 * Orçamento (plano de tratamento): a clínica monta, manda o link, o paciente aprova e
 * escolhe as parcelas. Ao aprovar, as parcelas viram contas a receber.
 */
@Injectable()
export class PlansService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  private async load(tx: TenantTx, id: string, lock = false) {
    const q = tx.select().from(treatmentPlans).where(eq(treatmentPlans.id, id));
    const [p] = lock ? await q.for('update') : await q;
    if (!p) throw new NotFoundException('Orçamento não encontrado');
    return p;
  }

  private async view(tx: TenantTx, p: Plan) {
    const items = await tx
      .select()
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.planId, p.id))
      .orderBy(asc(treatmentPlanItems.position));
    let professionalName: string | null = null;
    if (p.professionalId) {
      const [pr] = await tx
        .select({ name: professionals.name })
        .from(professionals)
        .where(eq(professionals.id, p.professionalId));
      professionalName = pr?.name ?? null;
    }
    return planView(p, items, { professionalName });
  }

  private async checkRefs(tx: TenantTx, input: PlanInput) {
    if (input.professionalId) {
      const [pr] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .where(eq(professionals.id, input.professionalId));
      if (!pr) throw new NotFoundException('Profissional não encontrado');
    }
    const ids = [...new Set(input.items.flatMap((i) => (i.serviceId ? [i.serviceId] : [])))];
    if (ids.length) {
      const found = await tx
        .select({ id: services.id })
        .from(services)
        .where(inArray(services.id, ids));
      if (found.length !== ids.length) throw new NotFoundException('Serviço não encontrado');
    }
    const { subtotal } = planTotals(input.items, 0, 0);
    if (input.discountCents > subtotal)
      throw new BadRequestException('O desconto é maior que o total');
  }

  private async writeItems(tx: TenantTx, tenantId: string, planId: string, items: PlanItemInput[]) {
    await tx.delete(treatmentPlanItems).where(eq(treatmentPlanItems.planId, planId));
    if (!items.length) return;
    await tx.insert(treatmentPlanItems).values(
      items.map((i, position) => ({
        tenantId,
        planId,
        serviceId: i.serviceId ?? null,
        description: i.description,
        tooth: i.tooth ?? null,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        position,
      })),
    );
  }

  list(ctx: TenantContext, patientId: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(treatmentPlans)
        .where(eq(treatmentPlans.patientId, patientId))
        .orderBy(desc(treatmentPlans.createdAt));
      return Promise.all(rows.map((p) => this.view(tx, p)));
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id);
      const plan = await this.view(tx, p);
      const parcelas = await tx
        .select()
        .from(charges)
        .where(eq(charges.planId, id))
        .orderBy(asc(charges.installment));
      return { ...plan, charges: parcelas.map((c) => chargeView(c)) };
    });
  }

  create(ctx: TenantContext, patientId: string, input: PlanInput) {
    return this.run(ctx, async (tx) => {
      const [pa] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.id, patientId));
      if (!pa) throw new NotFoundException('Paciente não encontrado');
      await this.checkRefs(tx, input);
      const { items, ...rest } = input;
      const [p] = await tx
        .insert(treatmentPlans)
        .values({
          tenantId: ctx.tenantId,
          patientId,
          ...rest,
          professionalId: rest.professionalId ?? null,
          validUntil: rest.validUntil ?? null,
          createdBy: ctx.user.userId,
        })
        .returning();
      await this.writeItems(tx, ctx.tenantId, p!.id, items);
      return this.view(tx, p!);
    });
  }

  /** Só rascunho e enviado mudam; depois de aprovado o orçamento fica como está. */
  update(ctx: TenantContext, id: string, input: PlanInput) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id, true);
      if (!['draft', 'sent'].includes(p.status))
        throw new ConflictException('Orçamento já decidido não muda. Faça um novo.');
      await this.checkRefs(tx, input);
      const { items, ...rest } = input;
      const [row] = await tx
        .update(treatmentPlans)
        .set({
          ...rest,
          professionalId: rest.professionalId ?? null,
          validUntil: rest.validUntil ?? null,
        })
        .where(eq(treatmentPlans.id, id))
        .returning();
      await this.writeItems(tx, ctx.tenantId, id, items);
      return this.view(tx, row!);
    });
  }

  /** Gera o link de aprovação (um novo a cada envio; o anterior para de valer). */
  send(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id, true);
      if (!['draft', 'sent'].includes(p.status))
        throw new ConflictException('Este orçamento já foi decidido');
      const items = await tx
        .select({ id: treatmentPlanItems.id })
        .from(treatmentPlanItems)
        .where(eq(treatmentPlanItems.planId, id));
      if (!items.length) throw new BadRequestException('Inclua ao menos um item');
      const token = generateToken();
      const [row] = await tx
        .update(treatmentPlans)
        .set({ status: 'sent', sentAt: new Date(), approveTokenHash: hashToken(token) })
        .where(eq(treatmentPlans.id, id))
        .returning();
      const [patient] = await tx.select().from(patients).where(eq(patients.id, p.patientId));
      return { token, plan: await this.view(tx, row!), patientPhone: patient?.phone ?? '' };
    });
  }

  /** Aprovação pela clínica (paciente aprovou no balcão). */
  approve(
    ctx: TenantContext,
    id: string,
    input: { installments: number; firstDueDate?: string | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id, true);
      await this.decide(tx, p, 'approved', input.installments, input.firstDueDate, ctx.user.userId);
      return this.view(tx, await this.load(tx, id));
    });
  }

  decline(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id, true);
      await this.decide(tx, p, 'declined');
      return this.view(tx, await this.load(tx, id));
    });
  }

  /** Cancela um orçamento; parcelas ainda em aberto deixam de ser cobradas. */
  cancel(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, id, true);
      if (p.status === 'cancelled') return this.view(tx, p);
      await tx
        .update(treatmentPlans)
        .set({ status: 'cancelled', approveTokenHash: null, decidedAt: new Date() })
        .where(eq(treatmentPlans.id, id));
      await tx
        .update(charges)
        .set({ status: 'cancelled' })
        .where(and(eq(charges.planId, id), eq(charges.status, 'open')));
      return this.view(tx, await this.load(tx, id));
    });
  }

  /** Liga (ou desliga) um item a uma consulta marcada. */
  linkItem(ctx: TenantContext, planId: string, itemId: string, appointmentId: string | null) {
    return this.run(ctx, async (tx) => {
      const p = await this.load(tx, planId);
      if (appointmentId) {
        const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
        if (!a) throw new NotFoundException('Consulta não encontrada');
        if (a.patientId !== p.patientId)
          throw new BadRequestException('A consulta é de outro paciente');
      }
      const rows = await tx
        .update(treatmentPlanItems)
        .set({ appointmentId })
        .where(and(eq(treatmentPlanItems.id, itemId), eq(treatmentPlanItems.planId, planId)))
        .returning();
      if (!rows.length) throw new NotFoundException('Item não encontrado');
      return this.view(tx, p);
    });
  }

  private async decide(
    tx: TenantTx,
    p: Plan,
    to: 'approved' | 'declined',
    installments = 1,
    firstDueDate?: string,
    actor?: string,
  ) {
    if (p.status !== 'sent' && p.status !== 'draft')
      throw new ConflictException('Este orçamento já foi decidido');
    const tz = await clinicTimezone(tx);
    const today = localClock(new Date(), tz).ymd;
    if (p.validUntil && p.validUntil < today)
      throw new ConflictException('Este orçamento venceu. Peça um novo à clínica.');
    if (to === 'declined') {
      await tx
        .update(treatmentPlans)
        .set({ status: 'declined', decidedAt: new Date() })
        .where(eq(treatmentPlans.id, p.id));
      return;
    }
    if (installments < 1 || installments > p.maxInstallments)
      throw new BadRequestException(`Escolha de 1 a ${p.maxInstallments} parcelas`);
    const items = await tx
      .select()
      .from(treatmentPlanItems)
      .where(eq(treatmentPlanItems.planId, p.id));
    if (!items.length) throw new BadRequestException('Orçamento sem itens');
    const { total, cashTotal } = planTotals(items, p.discountCents, p.cashDiscountPct);
    const valor = installments === 1 ? cashTotal : total;
    await tx
      .update(treatmentPlans)
      .set({
        status: 'approved',
        decidedAt: new Date(),
        chosenInstallments: installments,
      })
      .where(eq(treatmentPlans.id, p.id));
    if (valor <= 0) return;
    const partes = splitInstallments(valor, installments);
    const datas = monthlyDueDates(firstDueDate ?? today, installments);
    await tx.insert(charges).values(
      partes.map((amountCents, i) => ({
        tenantId: p.tenantId,
        patientId: p.patientId,
        planId: p.id,
        description:
          installments === 1 ? p.title : `${p.title} (${i + 1}/${installments})`.slice(0, 160),
        amountCents,
        dueDate: datas[i]!,
        installment: i + 1,
        installments,
        createdBy: actor ?? null,
      })),
    );
  }

  // ------------------------------------------------------------ link do paciente

  private async byToken<T>(token: string, fn: (tx: TenantTx, planId: string) => Promise<T>) {
    const found = await resolvePlanToken(this.dbService.db, hashToken(token));
    if (!found) throw new GoneException('Este link não vale mais. Fale com a clínica.');
    return withTenant(this.dbService.db, found.tenantId, (tx) => fn(tx, found.planId));
  }

  private async publicView(tx: TenantTx, planId: string) {
    const p = await this.load(tx, planId);
    const plan = await this.view(tx, p);
    const [patient] = await tx.select().from(patients).where(eq(patients.id, p.patientId));
    const [tenant] = await tx.select().from(tenants);
    const { booking: _b, about: _a, ...brand } = clinicView(tenant!);
    const { patientId: _p, professionalId: _pr, ...rest } = plan;
    return {
      clinic: brand,
      patientFirstName: patient?.name.split(' ')[0] ?? '',
      ...rest,
      items: rest.items.map(({ appointmentId: _x, serviceId: _s, id: _i, ...i }) => i),
    };
  }

  publicGet(token: string) {
    return this.byToken(token, (tx, id) => this.publicView(tx, id));
  }

  publicApprove(token: string, installments: number) {
    return this.byToken(token, async (tx, id) => {
      const p = await this.load(tx, id, true);
      await this.decide(tx, p, 'approved', installments);
      return this.publicView(tx, id);
    });
  }

  publicDecline(token: string) {
    return this.byToken(token, async (tx, id) => {
      const p = await this.load(tx, id, true);
      await this.decide(tx, p, 'declined');
      return this.publicView(tx, id);
    });
  }
}
