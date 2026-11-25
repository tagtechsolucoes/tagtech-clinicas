import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { schema, type TenantTx } from '@tagtech/db';
import {
  addDays,
  daysLeft,
  firstShortages,
  localClock,
  pickFefo,
  q3,
  suggestedPurchase,
  zonedToUtc,
  type MoveKind,
  type Need,
  type PayMethod,
  type ShoppingReason,
} from '@tagtech/domain';
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { TenantContext } from '../auth/auth.guard';
import { inClinic } from '../common/clinic-scope';
import { DbService } from '../db/db.module';
import { clinicTimezone } from '../finance/finance.service';

const {
  appointments,
  expenses,
  patients,
  purchaseOrders,
  serviceMaterials,
  services,
  stockItems,
  stockLots,
  stockMoves,
  stockPurchases,
  supplierPrices,
  suppliers,
} = schema;

type Item = typeof stockItems.$inferSelect;
type Patch<T> = { [K in keyof T]?: T[K] | undefined };
type Supplier = typeof suppliers.$inferSelect;

/** Consultas que ainda vão consumir material. */
const FUTURE_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_progress'] as const;
const HORIZON_DAYS = 60;

export interface SupplierInput {
  name: string;
  contact: string;
  whatsapp: string;
  email: string;
  leadTimeDays: number;
  notes: string;
  active?: boolean | undefined;
}

export interface ItemInput {
  name: string;
  category: string;
  unit: string;
  purchaseUnit: string;
  unitsPerPurchase: number;
  minQty: number;
  supplierId: string | null;
  openValidityDays: number | null;
  costCents?: number | undefined;
  active?: boolean | undefined;
}

export interface PurchaseInput {
  supplierId: string | null;
  invoice: string;
  receivedOn: string;
  items: Array<{
    itemId: string;
    purchaseQty: number;
    unitPriceCents: number;
    lot: string;
    expiresOn: string | null;
  }>;
  expense?: { dueDate: string; paid?: { method: PayMethod } | undefined } | undefined;
  orderId?: string | undefined;
}

// ------------------------------------------------------------ baixa pela agenda

async function lotsOf(tx: TenantTx, itemId: string) {
  return tx
    .select()
    .from(stockLots)
    .where(and(eq(stockLots.itemId, itemId), sql`${stockLots.qty} > 0`))
    .for('update');
}

/** Saída de material pelo lote que vence primeiro. Registra o que faltou sem lote. */
async function takeOut(
  tx: TenantTx,
  tenantId: string,
  itemId: string,
  qty: number,
  move: { kind: MoveKind; reason?: string; appointmentId?: string | null; userId?: string | null },
) {
  const lots = await lotsOf(tx, itemId);
  const { take, missing } = pickFefo(lots, qty);
  const [item] = await tx.select().from(stockItems).where(eq(stockItems.id, itemId));
  for (const t of take) {
    const lot = lots.find((l) => l.id === t.lotId)!;
    await tx
      .update(stockLots)
      .set({ qty: q3(lot.qty - t.qty), ...(lot.openedAt ? {} : { openedAt: new Date() }) })
      .where(eq(stockLots.id, lot.id));
    await tx.insert(stockMoves).values({
      tenantId,
      itemId,
      lotId: lot.id,
      kind: move.kind,
      qty: -t.qty,
      costCents: Math.round(t.qty * lot.costCents),
      reason: move.reason ?? '',
      appointmentId: move.appointmentId ?? null,
      userId: move.userId ?? null,
    });
  }
  if (missing > 0) {
    // Usou sem ter no sistema: fica registrado para a contagem acertar depois.
    await tx.insert(stockMoves).values({
      tenantId,
      itemId,
      kind: move.kind,
      qty: -missing,
      costCents: Math.round(missing * (item?.costCents ?? 0)),
      reason: move.reason || 'Sem saldo no sistema',
      appointmentId: move.appointmentId ?? null,
      userId: move.userId ?? null,
    });
  }
  return { missing };
}

/** O que já saiu (líquido) por material e lote numa consulta. */
async function netForAppointment(tx: TenantTx, appointmentId: string) {
  return tx
    .select({
      itemId: stockMoves.itemId,
      lotId: stockMoves.lotId,
      qty: sql<number>`sum(${stockMoves.qty})::float8`,
    })
    .from(stockMoves)
    .where(
      and(
        eq(stockMoves.appointmentId, appointmentId),
        inArray(stockMoves.kind, ['consume', 'return']),
      ),
    )
    .groupBy(stockMoves.itemId, stockMoves.lotId);
}

/**
 * Consulta finalizada: tira os materiais da ficha do serviço (só o que ainda não saiu,
 * então finalizar de novo não tira em dobro).
 */
export async function consumeForAppointment(
  tx: TenantTx,
  tenantId: string,
  appointmentId: string,
  userId: string | null,
) {
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return;
  const ficha = await tx
    .select()
    .from(serviceMaterials)
    .where(eq(serviceMaterials.serviceId, a.serviceId));
  if (!ficha.length) return;
  const net = await netForAppointment(tx, appointmentId);
  for (const m of ficha) {
    const jaSaiu = -net.filter((n) => n.itemId === m.itemId).reduce((s, n) => s + n.qty, 0);
    const falta = q3(m.qty - jaSaiu);
    if (falta > 0)
      await takeOut(tx, tenantId, m.itemId, falta, { kind: 'consume', appointmentId, userId });
  }
}

/** Atendimento desfeito: o material volta para os mesmos lotes. */
export async function returnForAppointment(
  tx: TenantTx,
  tenantId: string,
  appointmentId: string,
  userId: string | null,
) {
  const net = await netForAppointment(tx, appointmentId);
  for (const n of net) {
    if (n.qty >= 0) continue;
    const volta = q3(-n.qty);
    let costCents = 0;
    if (n.lotId) {
      const [lot] = await tx
        .select()
        .from(stockLots)
        .where(eq(stockLots.id, n.lotId))
        .for('update');
      if (lot) {
        await tx
          .update(stockLots)
          .set({ qty: q3(lot.qty + volta) })
          .where(eq(stockLots.id, lot.id));
        costCents = Math.round(volta * lot.costCents);
      }
    }
    await tx.insert(stockMoves).values({
      tenantId,
      itemId: n.itemId,
      lotId: n.lotId,
      kind: 'return',
      qty: volta,
      costCents,
      reason: 'Atendimento desfeito',
      appointmentId,
      userId,
    });
  }
}

function supplierView(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    contact: s.contact,
    whatsapp: s.whatsapp,
    email: s.email,
    leadTimeDays: s.leadTimeDays,
    notes: s.notes,
    active: s.active,
  };
}

/** Estoque e fornecedores. */
@Injectable()
export class StockService {
  constructor(@Inject(DbService) private readonly dbService: DbService) {}

  private run<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>) {
    return inClinic(this.dbService.db, ctx, fn);
  }

  // ------------------------------------------------------------ fornecedores

  listSuppliers(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.select().from(suppliers).orderBy(asc(suppliers.name));
      const precos = await tx
        .select({ p: supplierPrices, itemName: stockItems.name, unit: stockItems.purchaseUnit })
        .from(supplierPrices)
        .innerJoin(stockItems, eq(stockItems.id, supplierPrices.itemId));
      return rows.map((s) => ({
        ...supplierView(s),
        prices: precos
          .filter((p) => p.p.supplierId === s.id)
          .map((p) => ({
            itemId: p.p.itemId,
            itemName: p.itemName,
            purchaseUnit: p.unit,
            lastPriceCents: p.p.lastPriceCents,
            previousPriceCents: p.p.previousPriceCents,
            updatedAt: p.p.updatedAt.toISOString(),
          })),
      }));
    });
  }

  createSupplier(ctx: TenantContext, input: SupplierInput) {
    return this.run(ctx, async (tx) => {
      const [s] = await tx
        .insert(suppliers)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning();
      return supplierView(s!);
    });
  }

  updateSupplier(ctx: TenantContext, id: string, input: Patch<SupplierInput>) {
    return this.run(ctx, async (tx) => {
      const [s] = await tx.update(suppliers).set(input).where(eq(suppliers.id, id)).returning();
      if (!s) throw new NotFoundException('Fornecedor não encontrado');
      return supplierView(s);
    });
  }

  // ------------------------------------------------------------ materiais

  private async checkSupplier(tx: TenantTx, id: string | null | undefined) {
    if (!id) return;
    const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, id));
    if (!s) throw new NotFoundException('Fornecedor não encontrado');
  }

  createItem(
    ctx: TenantContext,
    input: ItemInput & {
      initialQty?: number | undefined;
      initialExpiresOn?: string | null | undefined;
      initialLot?: string | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      await this.checkSupplier(tx, input.supplierId);
      const { initialQty, initialExpiresOn, initialLot, ...rest } = input;
      const [item] = await tx
        .insert(stockItems)
        .values({ tenantId: ctx.tenantId, ...rest })
        .returning();
      if (initialQty && initialQty > 0) {
        const [lot] = await tx
          .insert(stockLots)
          .values({
            tenantId: ctx.tenantId,
            itemId: item!.id,
            qty: initialQty,
            costCents: item!.costCents,
            lot: initialLot ?? '',
            expiresOn: initialExpiresOn ?? null,
          })
          .returning();
        await tx.insert(stockMoves).values({
          tenantId: ctx.tenantId,
          itemId: item!.id,
          lotId: lot!.id,
          kind: 'adjust',
          qty: initialQty,
          costCents: Math.round(initialQty * item!.costCents),
          reason: 'Saldo inicial',
          userId: ctx.user.userId,
        });
      }
      return item!;
    });
  }

  updateItem(ctx: TenantContext, id: string, input: Patch<ItemInput>) {
    return this.run(ctx, async (tx) => {
      await this.checkSupplier(tx, input.supplierId);
      const [item] = await tx
        .update(stockItems)
        .set(input)
        .where(eq(stockItems.id, id))
        .returning();
      if (!item) throw new NotFoundException('Material não encontrado');
      return item;
    });
  }

  /**
   * Visão geral: saldo, previsão de término (agenda × últimos 30 dias), primeira consulta que
   * fica sem material, lotes vencendo e material parado.
   */
  overview(ctx: TenantContext) {
    return this.run(ctx, (tx) => this.computeOverview(tx));
  }

  private async computeOverview(tx: TenantTx) {
    const tz = await clinicTimezone(tx);
    const now = new Date();
    const hoje = localClock(now, tz).ymd;
    const items = await tx.select().from(stockItems).orderBy(asc(stockItems.name));
    const lots = await tx
      .select()
      .from(stockLots)
      .where(sql`${stockLots.qty} > 0`);
    const saldo = new Map<string, number>();
    for (const l of lots) saldo.set(l.itemId, q3((saldo.get(l.itemId) ?? 0) + l.qty));

    // Agenda dos próximos 60 dias × ficha de materiais.
    const ate = zonedToUtc(addDays(hoje, HORIZON_DAYS), 0, tz);
    const marcadas = await tx
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        serviceId: appointments.serviceId,
      })
      .from(appointments)
      .where(
        and(
          inArray(appointments.status, [...FUTURE_STATUSES]),
          gte(appointments.startsAt, now),
          lt(appointments.startsAt, ate),
        ),
      );
    const fichas = await tx.select().from(serviceMaterials);
    const needs: Need[] = marcadas
      .map((a) => ({
        appointmentId: a.id,
        startsAt: a.startsAt.toISOString(),
        items: fichas
          .filter((f) => f.serviceId === a.serviceId)
          .map((f) => ({ itemId: f.itemId, qty: f.qty })),
      }))
      .filter((n) => n.items.length);
    const faltas = firstShortages(saldo, needs);

    // Consumo dos últimos 30 dias.
    const desde = new Date(now.getTime() - 30 * 86_400_000);
    const consumo = await tx
      .select({
        itemId: stockMoves.itemId,
        qty: sql<number>`sum(${stockMoves.qty})::float8`,
        last: sql<Date>`max(${stockMoves.createdAt})`,
      })
      .from(stockMoves)
      .where(
        and(
          inArray(stockMoves.kind, ['consume', 'return', 'manual']),
          gte(stockMoves.createdAt, desde),
        ),
      )
      .groupBy(stockMoves.itemId);
    const ultimoUso = await tx
      .select({ itemId: stockMoves.itemId, last: sql<string>`max(${stockMoves.createdAt})::text` })
      .from(stockMoves)
      .where(inArray(stockMoves.kind, ['consume', 'manual']))
      .groupBy(stockMoves.itemId);
    const pedidos = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.status, 'open'));

    const em30 = addDays(hoje, 30);
    const fornecedores = await tx.select().from(suppliers);
    return items.map((it) => {
      const atual = saldo.get(it.id) ?? 0;
      const agendado30 = needs
        .filter((n) => n.startsAt < zonedToUtc(addDays(hoje, 30), 0, tz).toISOString())
        .reduce(
          (s, n) => s + n.items.filter((i) => i.itemId === it.id).reduce((x, i) => x + i.qty, 0),
          0,
        );
      const passado = -(consumo.find((c) => c.itemId === it.id)?.qty ?? 0);
      const dias = daysLeft(atual, agendado30 / 30, Math.max(0, passado) / 30);
      const vencendo = lots
        .filter((l) => l.itemId === it.id && l.expiresOn && l.expiresOn <= em30)
        .map((l) => ({
          lotId: l.id,
          lot: l.lot,
          expiresOn: l.expiresOn!,
          qty: l.qty,
          expired: l.expiresOn! < hoje,
        }));
      // Frasco aberto: vence pelo prazo depois de aberto.
      const abertos = it.openValidityDays
        ? lots
            .filter((l) => l.itemId === it.id && l.openedAt)
            .map((l) => {
              const limite = localClock(
                new Date(l.openedAt!.getTime() + it.openValidityDays! * 86_400_000),
                tz,
              ).ymd;
              return {
                lotId: l.id,
                lot: l.lot,
                expiresOn: limite,
                qty: l.qty,
                expired: limite < hoje,
                opened: true,
              };
            })
            .filter((l) => l.expiresOn <= addDays(hoje, 3))
        : [];
      const uso = ultimoUso.find((u) => u.itemId === it.id)?.last ?? null;
      const parado =
        atual > 0 && (!uso || new Date(uso).getTime() < desde.getTime()) && it.createdAt < desde;
      const falta = faltas.get(it.id) ?? null;
      const noPedido = pedidos.reduce(
        (s, p) =>
          s +
          p.items
            .filter((i) => i.itemId === it.id)
            .reduce((x, i) => x + i.purchaseQty * it.unitsPerPurchase, 0),
        0,
      );
      return {
        ...it,
        createdAt: it.createdAt.toISOString(),
        supplierName: fornecedores.find((f) => f.id === it.supplierId)?.name ?? null,
        qty: atual,
        valueCents: Math.round(
          lots.filter((l) => l.itemId === it.id).reduce((s, l) => s + l.qty * l.costCents, 0),
        ),
        scheduled30: q3(agendado30),
        used30: q3(Math.max(0, passado)),
        daysLeft: dias,
        shortage: falta,
        expiring: [...vencendo, ...abertos],
        idle: parado,
        onOrder: q3(noPedido),
        lastUsedAt: uso,
      };
    });
  }

  // ------------------------------------------------------------ lista de compras

  shopping(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const hoje = localClock(new Date(), tz).ymd;
      const visao = await this.computeOverview(tx);
      const fornecedores = await tx.select().from(suppliers);
      const precos = await tx.select().from(supplierPrices);
      const marcadas = await tx
        .select({ startsAt: appointments.startsAt, serviceId: appointments.serviceId })
        .from(appointments)
        .where(
          and(
            inArray(appointments.status, [...FUTURE_STATUSES]),
            gte(appointments.startsAt, new Date()),
          ),
        );
      const fichas = await tx.select().from(serviceMaterials);

      const linhas = visao
        .filter((it) => it.active)
        .flatMap((it) => {
          const motivos: ShoppingReason[] = [];
          if (it.shortage) motivos.push('agenda');
          if (it.qty <= it.minQty && it.minQty > 0) motivos.push('minimum');
          if (it.daysLeft !== null && it.daysLeft <= 15) motivos.push('ending');
          if (it.expiring.some((l) => !l.expired)) motivos.push('expiring');
          if (!motivos.length) return [];
          const forn = fornecedores.find((f) => f.id === it.supplierId);
          // Consumo até a próxima entrega (prazo do fornecedor + 7 dias de folga).
          const ate = zonedToUtc(addDays(hoje, (forn?.leadTimeDays ?? 2) + 7), 0, tz);
          const precisa = marcadas
            .filter((a) => a.startsAt < ate)
            .reduce(
              (s, a) =>
                s +
                fichas
                  .filter((f) => f.serviceId === a.serviceId && f.itemId === it.id)
                  .reduce((x, f) => x + f.qty, 0),
              0,
            );
          const ritmo = Math.max(precisa, (it.used30 / 30) * ((forn?.leadTimeDays ?? 2) + 7));
          let sugestao = suggestedPurchase({
            current: it.qty,
            onOrder: it.onOrder,
            needUntilDelivery: ritmo,
            minQty: it.minQty,
            unitsPerPurchase: it.unitsPerPurchase,
          });
          if (sugestao === 0) {
            // Já pedido: não pede de novo. Só vencendo: aparece com 0, para usar antes ou trocar.
            if (it.onOrder > 0 && !motivos.includes('expiring')) return [];
            if (!motivos.every((m) => m === 'expiring')) sugestao = 1;
          }
          const preco =
            precos.find((p) => p.itemId === it.id && p.supplierId === it.supplierId)
              ?.lastPriceCents ?? Math.round(it.costCents * it.unitsPerPurchase);
          return [
            {
              itemId: it.id,
              name: it.name,
              purchaseUnit: it.purchaseUnit,
              unitsPerPurchase: it.unitsPerPurchase,
              unit: it.unit,
              qty: it.qty,
              reasons: motivos,
              shortage: it.shortage,
              suggestedQty: sugestao,
              priceCents: preco,
              supplierId: it.supplierId,
            },
          ];
        });

      const grupos = new Map<string | null, typeof linhas>();
      for (const l of linhas) grupos.set(l.supplierId, [...(grupos.get(l.supplierId) ?? []), l]);
      return [...grupos.entries()].map(([supplierId, items]) => {
        const f = fornecedores.find((x) => x.id === supplierId);
        return {
          supplier: f ? supplierView(f) : null,
          items: items.sort(
            (a, b) =>
              (a.reasons.includes('agenda') ? -1 : 0) - (b.reasons.includes('agenda') ? -1 : 0),
          ),
          totalCents: items.reduce((s, i) => s + i.suggestedQty * i.priceCents, 0),
        };
      });
    });
  }

  listOrders(ctx: TenantContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.status, 'open'))
        .orderBy(desc(purchaseOrders.createdAt));
      return rows.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }));
    });
  }

  createOrder(
    ctx: TenantContext,
    input: { supplierId: string | null; items: Array<{ itemId: string; purchaseQty: number }> },
  ) {
    return this.run(ctx, async (tx) => {
      await this.checkSupplier(tx, input.supplierId);
      const ids = input.items.map((i) => i.itemId);
      const found = await tx
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(inArray(stockItems.id, ids));
      if (found.length !== new Set(ids).size)
        throw new NotFoundException('Material não encontrado');
      const [o] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: ctx.tenantId,
          supplierId: input.supplierId,
          items: input.items,
          createdBy: ctx.user.userId,
        })
        .returning();
      return { ...o!, createdAt: o!.createdAt.toISOString() };
    });
  }

  cancelOrder(ctx: TenantContext, id: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .update(purchaseOrders)
        .set({ status: 'cancelled' })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, 'open')))
        .returning();
      if (!rows.length) throw new NotFoundException('Pedido não encontrado');
    });
  }

  // ------------------------------------------------------------ entrada de compra

  purchase(ctx: TenantContext, input: PurchaseInput) {
    return this.run(ctx, async (tx) => {
      await this.checkSupplier(tx, input.supplierId);
      const ids = [...new Set(input.items.map((i) => i.itemId))];
      const itens = await tx.select().from(stockItems).where(inArray(stockItems.id, ids));
      if (itens.length !== ids.length) throw new NotFoundException('Material não encontrado');
      const total = input.items.reduce(
        (s, i) => s + Math.round(i.purchaseQty * i.unitPriceCents),
        0,
      );
      const [forn] = input.supplierId
        ? await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId))
        : [undefined];

      let expenseId: string | null = null;
      if (input.expense && total > 0) {
        const [e] = await tx
          .insert(expenses)
          .values({
            tenantId: ctx.tenantId,
            description: `Compra de material${input.invoice ? ` · NF ${input.invoice}` : ''}`.slice(
              0,
              160,
            ),
            category: 'Material',
            supplier: forn?.name ?? '',
            amountCents: total,
            dueDate: input.expense.dueDate,
            createdBy: ctx.user.userId,
            ...(input.expense.paid
              ? { status: 'paid' as const, method: input.expense.paid.method, paidAt: new Date() }
              : {}),
          })
          .returning();
        expenseId = e!.id;
      }
      const [p] = await tx
        .insert(stockPurchases)
        .values({
          tenantId: ctx.tenantId,
          supplierId: input.supplierId,
          invoice: input.invoice,
          totalCents: total,
          receivedOn: input.receivedOn,
          expenseId,
          createdBy: ctx.user.userId,
        })
        .returning();

      const alertas: Array<{ itemId: string; name: string; fromCents: number; toCents: number }> =
        [];
      for (const li of input.items) {
        const it = itens.find((x) => x.id === li.itemId)!;
        const usoQtd = q3(li.purchaseQty * it.unitsPerPurchase);
        const custoUso = Math.round(li.unitPriceCents / it.unitsPerPurchase);
        const [lot] = await tx
          .insert(stockLots)
          .values({
            tenantId: ctx.tenantId,
            itemId: it.id,
            lot: li.lot,
            expiresOn: li.expiresOn,
            qty: usoQtd,
            costCents: custoUso,
            purchaseId: p!.id,
          })
          .returning();
        await tx.insert(stockMoves).values({
          tenantId: ctx.tenantId,
          itemId: it.id,
          lotId: lot!.id,
          kind: 'purchase',
          qty: usoQtd,
          costCents: Math.round(li.purchaseQty * li.unitPriceCents),
          purchaseId: p!.id,
          userId: ctx.user.userId,
        });
        await tx.update(stockItems).set({ costCents: custoUso }).where(eq(stockItems.id, it.id));
        if (input.supplierId) {
          const [antes] = await tx
            .select()
            .from(supplierPrices)
            .where(
              and(
                eq(supplierPrices.supplierId, input.supplierId),
                eq(supplierPrices.itemId, it.id),
              ),
            );
          if (antes && li.unitPriceCents > antes.lastPriceCents * 1.1) {
            alertas.push({
              itemId: it.id,
              name: it.name,
              fromCents: antes.lastPriceCents,
              toCents: li.unitPriceCents,
            });
          }
          await tx
            .insert(supplierPrices)
            .values({
              tenantId: ctx.tenantId,
              supplierId: input.supplierId,
              itemId: it.id,
              lastPriceCents: li.unitPriceCents,
            })
            .onConflictDoUpdate({
              target: [supplierPrices.supplierId, supplierPrices.itemId],
              set: {
                previousPriceCents: antes?.lastPriceCents ?? null,
                lastPriceCents: li.unitPriceCents,
                updatedAt: new Date(),
              },
            });
        }
      }
      if (input.orderId) {
        await tx
          .update(purchaseOrders)
          .set({ status: 'received' })
          .where(eq(purchaseOrders.id, input.orderId));
      }
      return { id: p!.id, totalCents: total, expenseId, priceAlerts: alertas };
    });
  }

  // ------------------------------------------------------------ saídas e contagem

  manualOut(
    ctx: TenantContext,
    itemId: string,
    input: {
      kind: 'loss' | 'expired' | 'manual';
      qty: number;
      reason: string;
      lotId?: string | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const [it] = await tx.select().from(stockItems).where(eq(stockItems.id, itemId));
      if (!it) throw new NotFoundException('Material não encontrado');
      if (input.lotId) {
        const [lot] = await tx
          .select()
          .from(stockLots)
          .where(and(eq(stockLots.id, input.lotId), eq(stockLots.itemId, itemId)))
          .for('update');
        if (!lot) throw new NotFoundException('Lote não encontrado');
        if (lot.qty < input.qty) throw new BadRequestException('O lote não tem essa quantidade');
        await tx
          .update(stockLots)
          .set({ qty: q3(lot.qty - input.qty) })
          .where(eq(stockLots.id, lot.id));
        await tx.insert(stockMoves).values({
          tenantId: ctx.tenantId,
          itemId,
          lotId: lot.id,
          kind: input.kind,
          qty: -input.qty,
          costCents: Math.round(input.qty * lot.costCents),
          reason: input.reason,
          userId: ctx.user.userId,
        });
        return;
      }
      await takeOut(tx, ctx.tenantId, itemId, input.qty, {
        kind: input.kind,
        reason: input.reason,
        userId: ctx.user.userId,
      });
    });
  }

  /** Contagem: lança a diferença entre o que foi contado e o sistema como ajuste. */
  count(ctx: TenantContext, itemId: string, counted: number) {
    return this.run(ctx, async (tx) => {
      const [it] = await tx.select().from(stockItems).where(eq(stockItems.id, itemId));
      if (!it) throw new NotFoundException('Material não encontrado');
      const lots = await lotsOf(tx, itemId);
      const atual = q3(lots.reduce((s, l) => s + l.qty, 0));
      const dif = q3(counted - atual);
      if (dif === 0) return { difference: 0 };
      if (dif < 0) {
        await takeOut(tx, ctx.tenantId, itemId, -dif, {
          kind: 'adjust',
          reason: 'Contagem',
          userId: ctx.user.userId,
        });
      } else {
        const [lot] = await tx
          .insert(stockLots)
          .values({
            tenantId: ctx.tenantId,
            itemId,
            qty: dif,
            costCents: it.costCents,
            lot: 'Contagem',
          })
          .returning();
        await tx.insert(stockMoves).values({
          tenantId: ctx.tenantId,
          itemId,
          lotId: lot!.id,
          kind: 'adjust',
          qty: dif,
          costCents: Math.round(dif * it.costCents),
          reason: 'Contagem',
          userId: ctx.user.userId,
        });
      }
      return { difference: dif };
    });
  }

  moves(ctx: TenantContext, itemId: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          m: stockMoves,
          lot: stockLots.lot,
          expiresOn: stockLots.expiresOn,
          patientName: patients.name,
        })
        .from(stockMoves)
        .leftJoin(stockLots, eq(stockLots.id, stockMoves.lotId))
        .leftJoin(appointments, eq(appointments.id, stockMoves.appointmentId))
        .leftJoin(patients, eq(patients.id, appointments.patientId))
        .where(eq(stockMoves.itemId, itemId))
        .orderBy(desc(stockMoves.createdAt))
        .limit(200);
      const lots = await tx
        .select()
        .from(stockLots)
        .where(and(eq(stockLots.itemId, itemId), sql`${stockLots.qty} > 0`))
        .orderBy(asc(stockLots.expiresOn));
      return {
        lots: lots.map((l) => ({
          id: l.id,
          lot: l.lot,
          expiresOn: l.expiresOn,
          qty: l.qty,
          costCents: l.costCents,
          openedAt: l.openedAt?.toISOString() ?? null,
        })),
        moves: rows.map((r) => ({
          id: r.m.id,
          kind: r.m.kind,
          qty: r.m.qty,
          costCents: r.m.costCents,
          reason: r.m.reason,
          lot: r.lot,
          expiresOn: r.expiresOn,
          appointmentId: r.m.appointmentId,
          purchaseId: r.m.purchaseId,
          patientName: r.patientName,
          createdAt: r.m.createdAt.toISOString(),
        })),
      };
    });
  }

  // ------------------------------------------------------------ ficha de materiais

  serviceMaterials(ctx: TenantContext, serviceId: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          itemId: serviceMaterials.itemId,
          qty: serviceMaterials.qty,
          name: stockItems.name,
          unit: stockItems.unit,
          costCents: stockItems.costCents,
        })
        .from(serviceMaterials)
        .innerJoin(stockItems, eq(stockItems.id, serviceMaterials.itemId))
        .where(eq(serviceMaterials.serviceId, serviceId));
      return rows;
    });
  }

  setServiceMaterials(
    ctx: TenantContext,
    serviceId: string,
    list: Array<{ itemId: string; qty: number }>,
  ) {
    return this.run(ctx, async (tx) => {
      const [s] = await tx
        .select({ id: services.id })
        .from(services)
        .where(eq(services.id, serviceId));
      if (!s) throw new NotFoundException('Serviço não encontrado');
      const ids = [...new Set(list.map((l) => l.itemId))];
      if (ids.length !== list.length) throw new BadRequestException('Material repetido');
      if (ids.length) {
        const found = await tx
          .select({ id: stockItems.id })
          .from(stockItems)
          .where(inArray(stockItems.id, ids));
        if (found.length !== ids.length) throw new NotFoundException('Material não encontrado');
      }
      await tx.delete(serviceMaterials).where(eq(serviceMaterials.serviceId, serviceId));
      if (list.length)
        await tx
          .insert(serviceMaterials)
          .values(list.map((l) => ({ tenantId: ctx.tenantId, serviceId, ...l })));
    }).then(() => this.serviceMaterials(ctx, serviceId));
  }

  // ------------------------------------------------------------ material da consulta

  appointmentMaterials(ctx: TenantContext, appointmentId: string) {
    return this.run(ctx, async (tx) => {
      const rows = await tx
        .select({
          m: stockMoves,
          name: stockItems.name,
          unit: stockItems.unit,
          lot: stockLots.lot,
          expiresOn: stockLots.expiresOn,
        })
        .from(stockMoves)
        .innerJoin(stockItems, eq(stockItems.id, stockMoves.itemId))
        .leftJoin(stockLots, eq(stockLots.id, stockMoves.lotId))
        .where(eq(stockMoves.appointmentId, appointmentId))
        .orderBy(asc(stockMoves.createdAt));
      return rows.map((r) => ({
        id: r.m.id,
        itemId: r.m.itemId,
        name: r.name,
        unit: r.unit,
        kind: r.m.kind,
        qty: r.m.qty,
        lot: r.lot,
        expiresOn: r.expiresOn,
        createdAt: r.m.createdAt.toISOString(),
      }));
    });
  }

  /** Ajuste na hora: material a mais (ou trocado) na consulta. */
  addToAppointment(ctx: TenantContext, appointmentId: string, itemId: string, qty: number) {
    return this.run(ctx, async (tx) => {
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId));
      if (!a) throw new NotFoundException('Consulta não encontrada');
      if (!['arrived', 'in_progress', 'done'].includes(a.status))
        throw new ConflictException('Lance material só em consulta em atendimento ou finalizada');
      const [it] = await tx
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(eq(stockItems.id, itemId));
      if (!it) throw new NotFoundException('Material não encontrado');
      await takeOut(tx, ctx.tenantId, itemId, qty, {
        kind: 'consume',
        appointmentId,
        userId: ctx.user.userId,
        reason: 'Ajuste na consulta',
      });
    }).then(() => this.appointmentMaterials(ctx, appointmentId));
  }

  /** Aviso no agendamento: o procedimento tem material até aquela data? */
  check(ctx: TenantContext, serviceId: string, startsAt: Date) {
    return this.run(ctx, async (tx) => {
      const ficha = await tx
        .select({
          itemId: serviceMaterials.itemId,
          qty: serviceMaterials.qty,
          name: stockItems.name,
          unit: stockItems.unit,
        })
        .from(serviceMaterials)
        .innerJoin(stockItems, eq(stockItems.id, serviceMaterials.itemId))
        .where(eq(serviceMaterials.serviceId, serviceId));
      if (!ficha.length) return [];
      const lots = await tx
        .select()
        .from(stockLots)
        .where(
          and(
            sql`${stockLots.qty} > 0`,
            inArray(
              stockLots.itemId,
              ficha.map((f) => f.itemId),
            ),
          ),
        );
      const marcadas = await tx
        .select({
          id: appointments.id,
          startsAt: appointments.startsAt,
          serviceId: appointments.serviceId,
        })
        .from(appointments)
        .where(
          and(
            inArray(appointments.status, [...FUTURE_STATUSES]),
            gte(appointments.startsAt, new Date()),
            lt(appointments.startsAt, startsAt),
          ),
        );
      const fichas = await tx
        .select()
        .from(serviceMaterials)
        .where(
          inArray(
            serviceMaterials.itemId,
            ficha.map((f) => f.itemId),
          ),
        );
      return ficha.flatMap((f) => {
        const saldo = lots.filter((l) => l.itemId === f.itemId).reduce((s, l) => s + l.qty, 0);
        const antes = marcadas.reduce(
          (s, a) =>
            s +
            fichas
              .filter((x) => x.serviceId === a.serviceId && x.itemId === f.itemId)
              .reduce((y, x) => y + x.qty, 0),
          0,
        );
        const sobra = q3(saldo - antes);
        return sobra < f.qty
          ? [
              {
                itemId: f.itemId,
                name: f.name,
                unit: f.unit,
                need: f.qty,
                available: Math.max(0, sobra),
              },
            ]
          : [];
      });
    });
  }

  // ------------------------------------------------------------ relatórios

  report(ctx: TenantContext, month: string) {
    return this.run(ctx, async (tx) => {
      const tz = await clinicTimezone(tx);
      const de = zonedToUtc(`${month}-01`, 0, tz);
      const [y, m] = month.split('-').map(Number) as [number, number];
      const proximo = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const ate = zonedToUtc(proximo, 0, tz);
      const noMes = and(gte(stockMoves.createdAt, de), lt(stockMoves.createdAt, ate));

      const compras = await tx
        .select({
          supplierId: stockPurchases.supplierId,
          name: suppliers.name,
          total: sql<number>`sum(${stockPurchases.totalCents})::int`,
        })
        .from(stockPurchases)
        .leftJoin(suppliers, eq(suppliers.id, stockPurchases.supplierId))
        .where(
          and(
            gte(stockPurchases.receivedOn, `${month}-01`),
            lt(stockPurchases.receivedOn, proximo),
          ),
        )
        .groupBy(stockPurchases.supplierId, suppliers.name);

      const porProcedimento = await tx
        .select({
          serviceId: appointments.serviceId,
          name: services.name,
          cost: sql<number>`sum(case when ${stockMoves.kind} = 'consume' then ${stockMoves.costCents} else -${stockMoves.costCents} end)::int`,
        })
        .from(stockMoves)
        .innerJoin(appointments, eq(appointments.id, stockMoves.appointmentId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .where(and(noMes, inArray(stockMoves.kind, ['consume', 'return'])))
        .groupBy(appointments.serviceId, services.name);

      const perdas = await tx
        .select({ kind: stockMoves.kind, total: sql<number>`sum(${stockMoves.costCents})::int` })
        .from(stockMoves)
        .where(and(noMes, inArray(stockMoves.kind, ['loss', 'expired'])))
        .groupBy(stockMoves.kind);

      // Custo real por procedimento: ficha × custo atual contra o preço.
      const fichas = await tx
        .select({
          serviceId: serviceMaterials.serviceId,
          qty: serviceMaterials.qty,
          cost: stockItems.costCents,
        })
        .from(serviceMaterials)
        .innerJoin(stockItems, eq(stockItems.id, serviceMaterials.itemId));
      const servs = await tx.select().from(services).where(eq(services.active, true));
      const margem = servs
        .map((s) => {
          const custo = Math.round(
            fichas.filter((f) => f.serviceId === s.id).reduce((x, f) => x + f.qty * f.cost, 0),
          );
          return {
            serviceId: s.id,
            name: s.name,
            priceCents: s.priceCents,
            materialCents: custo,
            marginCents: s.priceCents === null ? null : s.priceCents - custo,
          };
        })
        .filter((s) => s.materialCents > 0);

      const precos = await tx
        .select({ p: supplierPrices, name: stockItems.name, supplier: suppliers.name })
        .from(supplierPrices)
        .innerJoin(stockItems, eq(stockItems.id, supplierPrices.itemId))
        .innerJoin(suppliers, eq(suppliers.id, supplierPrices.supplierId))
        .where(isNotNull(supplierPrices.previousPriceCents));
      const subidas = precos
        .filter((p) => p.p.lastPriceCents > p.p.previousPriceCents! * 1.1)
        .map((p) => ({
          name: p.name,
          supplier: p.supplier,
          fromCents: p.p.previousPriceCents!,
          toCents: p.p.lastPriceCents,
        }));

      return {
        month,
        purchasesCents: compras.reduce((s, c) => s + c.total, 0),
        bySupplier: compras.map((c) => ({
          supplierId: c.supplierId,
          name: c.name ?? 'Sem fornecedor',
          totalCents: c.total,
        })),
        byProcedure: porProcedimento.map((p) => ({
          serviceId: p.serviceId,
          name: p.name,
          costCents: p.cost,
        })),
        lossesCents: perdas.reduce((s, p) => s + p.total, 0),
        losses: Object.fromEntries(perdas.map((p) => [p.kind, p.total])),
        procedureMargins: margem,
        priceIncreases: subidas,
      };
    });
  }
}

export type StockItem = Item;
