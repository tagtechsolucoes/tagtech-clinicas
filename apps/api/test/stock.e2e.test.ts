import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, weekdayOf, zonedToUtc } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;
let rec: string;
const extraUsers: string[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (cookie: string, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const TZ = 'America/Recife';
const today = localClock(new Date(), TZ).ymd;
const base = addDays(today, 3);
const tuesday = addDays(base, (9 - weekdayOf(base)) % 7);
const at = (day: string, hhmm: string) =>
  zonedToUtc(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ).toISOString();

let pro: { id: string };
let implante: { id: string };
let toxina: { id: string };
let dental: { id: string };
let item: { id: string };
let frasco: { id: string };

async function book(day: string, hhmm: string, serviceId: string, name = 'Paciente Estoque') {
  const r = await as(a.cookie, 'POST', '/appointments', {
    patient: { name, phone: '81988880000' },
    serviceId,
    professionalId: pro.id,
    startsAt: at(day, hhmm),
    allowOutsideHours: true,
  });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string };
}
const status = (id: string, s: string) =>
  as(a.cookie, 'POST', `/appointments/${id}/status`, { status: s });
const overview = async () =>
  (await as(a.cookie, 'GET', '/stock')).json() as Array<{
    id: string;
    qty: number;
    shortage: { appointmentId: string } | null;
    expiring: unknown[];
    daysLeft: number | null;
  }>;

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Estoque');
  b = await signupAccount(app, 'OutraEst');
  const invite = (
    await as(a.cookie, 'POST', '/team/invites', { name: 'Rita', role: 'reception' })
  ).json();
  const res = await app.inject({
    method: 'POST',
    url: `/invites/${invite.token}/accept`,
    payload: {
      name: 'Rita',
      email: `rita-est-${Date.now()}@teste.tagtech`,
      password: 'senha-bem-comprida-123',
    },
  });
  extraUsers.push(res.json().userId);
  rec = cookieFrom(res.headers['set-cookie']);
  pro = (await as(a.cookie, 'POST', '/professionals', { name: 'Dr. Paulo' })).json();
  implante = (
    await as(a.cookie, 'POST', '/services', {
      name: 'Implante',
      durationMinutes: 60,
      priceCents: 300000,
    })
  ).json();
  toxina = (
    await as(a.cookie, 'POST', '/services', {
      name: 'Toxina',
      durationMinutes: 30,
      priceCents: 120000,
    })
  ).json();
});

afterAll(async () => {
  for (const id of extraUsers) await owner.db.execute(sql`delete from users where id = ${id}`);
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('cadastro e compra', () => {
  it('fornecedor e material com unidade de compra', async () => {
    dental = (
      await as(rec, 'POST', '/suppliers', {
        name: 'Dental Nordeste',
        whatsapp: '(81) 3333-4444',
        leadTimeDays: 2,
      })
    ).json();
    expect(dental).toMatchObject({ whatsapp: '8133334444' });
    const r = await as(rec, 'POST', '/stock/items', {
      name: 'Implante cone morse',
      unit: 'unidade',
      purchaseUnit: 'unidade',
      minQty: 1,
      supplierId: dental.id,
    });
    expect(r.statusCode).toBe(201);
    item = r.json();
    frasco = (
      await as(rec, 'POST', '/stock/items', {
        name: 'Toxina 100U',
        unit: 'U',
        purchaseUnit: 'frasco',
        unitsPerPurchase: 100,
        openValidityDays: 30,
        supplierId: dental.id,
      })
    ).json();
    expect((await as(b.cookie, 'PATCH', `/stock/items/${item.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
  });

  it('entrada de compra converte a unidade, guarda lote e lança a conta a pagar', async () => {
    const r = await as(rec, 'POST', '/stock/purchases', {
      supplierId: dental.id,
      invoice: '1234',
      receivedOn: today,
      items: [
        {
          itemId: item.id,
          purchaseQty: 1,
          unitPriceCents: 45000,
          lot: 'L-A',
          expiresOn: addDays(today, 400),
        },
        {
          itemId: frasco.id,
          purchaseQty: 2,
          unitPriceCents: 90000,
          lot: 'TX-1',
          expiresOn: addDays(today, 20),
        },
      ],
      expense: { dueDate: addDays(today, 10) },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ totalCents: 225000, priceAlerts: [] });
    const v = await overview();
    expect(v.find((i) => i.id === frasco.id)).toMatchObject({ qty: 200, costCents: 900 });
    expect(v.find((i) => i.id === frasco.id)!.expiring).toHaveLength(1);
    const contas = (
      await as(a.cookie, 'GET', `/finance/expenses?from=${today}&to=${addDays(today, 30)}`)
    ).json();
    expect(contas).toEqual([
      expect.objectContaining({
        amountCents: 225000,
        category: 'Material',
        supplier: 'Dental Nordeste',
      }),
    ]);
  });
});

describe('estoque × agenda', () => {
  let c1: { id: string };
  let c2: { id: string };

  it('avisa a primeira consulta que vai ficar sem material', async () => {
    await as(a.cookie, 'PUT', `/services/${implante.id}/materials`, [{ itemId: item.id, qty: 1 }]);
    await as(a.cookie, 'PUT', `/services/${toxina.id}/materials`, [{ itemId: frasco.id, qty: 30 }]);
    c1 = await book(tuesday, '08:00', implante.id);
    c2 = await book(tuesday, '10:00', implante.id, 'Outro Paciente');
    const it = (await overview()).find((i) => i.id === item.id)!;
    expect(it.shortage).toMatchObject({ appointmentId: c2.id });
    const aviso = (
      await as(
        rec,
        'GET',
        `/stock/check?serviceId=${implante.id}&startsAt=${encodeURIComponent(at(addDays(tuesday, 1), '09:00'))}`,
      )
    ).json();
    expect(aviso).toEqual([expect.objectContaining({ itemId: item.id, need: 1, available: 0 })]);
  });

  it('lista de compras: falta para a agenda primeiro, quantidade sugerida e pedido', async () => {
    const lista = (await as(rec, 'GET', '/stock/shopping')).json();
    const grupo = lista.find(
      (g: { supplier: { id: string } | null }) => g.supplier?.id === dental.id,
    );
    const linha = grupo.items.find((i: { itemId: string }) => i.itemId === item.id);
    expect(linha.reasons).toContain('agenda');
    expect(linha.suggestedQty).toBeGreaterThanOrEqual(2);
    await as(rec, 'POST', '/stock/orders', {
      supplierId: dental.id,
      items: [{ itemId: item.id, purchaseQty: 2 }],
    });
    const depois = (await as(rec, 'GET', '/stock/shopping')).json();
    const de = depois
      .flatMap((g: { items: Array<{ itemId: string; suggestedQty: number }> }) => g.items)
      .find((i: { itemId: string }) => i.itemId === item.id);
    expect(de?.suggestedQty ?? 0).toBeLessThanOrEqual(1);
  });

  it('finalizar tira o material pelo lote que vence primeiro; desfazer devolve', async () => {
    const tox = await book(tuesday, '14:00', toxina.id, 'Paciente Toxina');
    await status(tox.id, 'arrived');
    expect((await status(tox.id, 'done')).statusCode).toBe(200);
    const usados = (await as(a.cookie, 'GET', `/appointments/${tox.id}/materials`)).json();
    expect(usados).toEqual([expect.objectContaining({ qty: -30, lot: 'TX-1', kind: 'consume' })]);
    expect((await overview()).find((i) => i.id === frasco.id)!.qty).toBe(170);
    // Finalizar de novo não tira em dobro.
    await status(tox.id, 'in_progress');
    expect((await overview()).find((i) => i.id === frasco.id)!.qty).toBe(200);
    await status(tox.id, 'done');
    expect((await overview()).find((i) => i.id === frasco.id)!.qty).toBe(170);
    // Ajuste na hora: 10 U a mais.
    const mais = await as(a.cookie, 'POST', `/appointments/${tox.id}/materials`, {
      itemId: frasco.id,
      qty: 10,
    });
    expect(mais.statusCode).toBe(201);
    expect((await overview()).find((i) => i.id === frasco.id)!.qty).toBe(160);
    expect(
      (await as(rec, 'POST', `/appointments/${tox.id}/materials`, { itemId: frasco.id, qty: 1 }))
        .statusCode,
    ).toBe(403);
  });

  it('saída manual exige motivo; contagem acerta a diferença', async () => {
    expect(
      (await as(rec, 'POST', `/stock/items/${frasco.id}/out`, { kind: 'loss', qty: 5, reason: '' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await as(rec, 'POST', `/stock/items/${frasco.id}/out`, {
          kind: 'loss',
          qty: 5,
          reason: 'Frasco caiu',
        })
      ).statusCode,
    ).toBe(204);
    const r = (await as(rec, 'POST', `/stock/items/${frasco.id}/count`, { counted: 150 })).json();
    expect(r).toEqual({ difference: -5 });
    const h = (await as(rec, 'GET', `/stock/items/${frasco.id}/moves`)).json();
    expect(h.moves.map((m: { kind: string }) => m.kind).slice(0, 2)).toEqual(['adjust', 'loss']);
  });

  it('relatório: compra por fornecedor, custo por procedimento e perdas', async () => {
    const r = (await as(a.cookie, 'GET', `/stock/report?month=${today.slice(0, 7)}`)).json();
    expect(r.bySupplier).toEqual([
      expect.objectContaining({ name: 'Dental Nordeste', totalCents: 225000 }),
    ]);
    expect(r.lossesCents).toBe(4500);
    expect(r.procedureMargins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Toxina', materialCents: 27000, marginCents: 93000 }),
      ]),
    );
    expect((await as(rec, 'GET', `/stock/report?month=${today.slice(0, 7)}`)).statusCode).toBe(403);
    void c1;
  });
});

describe('painel do resultado', () => {
  it('soma o que veio do site, da lista de espera e dos orçamentos', async () => {
    const pat = (
      await as(a.cookie, 'POST', '/patients', { name: 'Ana Resultado', phone: '81911112222' })
    ).json();
    const plano = (
      await as(a.cookie, 'POST', `/patients/${pat.id}/plans`, {
        title: 'Implante',
        items: [{ description: 'Implante', unitPriceCents: 300000 }],
      })
    ).json();
    const { token } = (await as(a.cookie, 'POST', `/plans/${plano.id}/send`)).json();
    await app.inject({
      method: 'POST',
      url: `/public/plans/${token}/approve`,
      payload: { installments: 1 },
    });
    // Aprovado no balcão sem link enviado não conta como resultado do sistema.
    const balcao = (
      await as(a.cookie, 'POST', `/patients/${pat.id}/plans`, {
        title: 'Balcão',
        items: [{ description: 'X', unitPriceCents: 1000 }],
      })
    ).json();
    await as(a.cookie, 'POST', `/plans/${balcao.id}/approve`, { installments: 1 });
    const r = await as(a.cookie, 'GET', `/results?month=${today.slice(0, 7)}`);
    expect(r.json().parts.plans).toEqual({ count: 1, sent: 1, valueCents: 300000 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      generatedCents: expect.any(Number),
      parts: { waitlist: { count: 0 }, online: { count: 0 } },
      previous: expect.any(Object),
    });
    expect((await as(rec, 'GET', `/results?month=${today.slice(0, 7)}`)).statusCode).toBe(403);
  });
});
