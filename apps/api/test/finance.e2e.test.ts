import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, weekdayOf } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { FinanceService } from '../src/finance/finance.service';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;
let rec: string;
let patientId: string;
let slug: string;
let serviceId: string;
const extraUsers: string[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const pub = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/public${url}`, ...(payload ? { payload } : {}) });

const TZ = 'America/Recife';
const today = localClock(new Date(), TZ).ymd;
const month = today.slice(0, 7);
const base = addDays(today, 7);
const tuesday = addDays(base, (9 - weekdayOf(base)) % 7);

const plan = (over: object = {}) => ({
  title: 'Clareamento + restaurações',
  discountCents: 10000,
  cashDiscountPct: 10,
  maxInstallments: 3,
  items: [
    { description: 'Clareamento a laser', quantity: 1, unitPriceCents: 80000 },
    { description: 'Restauração em resina', tooth: 16, quantity: 2, unitPriceCents: 25000 },
  ],
  ...over,
});

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Fin');
  b = await signupAccount(app, 'OutraFin');
  const invite = (
    await as(a.cookie, 'POST', '/team/invites', { name: 'Rita', role: 'reception' })
  ).json();
  const res = await app.inject({
    method: 'POST',
    url: `/invites/${invite.token}/accept`,
    payload: {
      name: 'Rita',
      email: `rita-${Date.now()}@teste.tagtech`,
      password: 'senha-bem-comprida-123',
    },
  });
  extraUsers.push(res.json().userId);
  rec = cookieFrom(res.headers['set-cookie']);
  patientId = (
    await as(a.cookie, 'POST', '/patients', { name: 'Beatriz Lima', phone: '81988887777' })
  ).json().id;
  slug = (await as(a.cookie, 'GET', '/clinic')).json().slug;
  await as(a.cookie, 'PATCH', '/clinic', { slotStepMinutes: 60 });
  const pro = (await as(a.cookie, 'POST', '/professionals', { name: 'Dra. Ana' })).json();
  await as(a.cookie, 'PUT', `/professionals/${pro.id}/hours`, [
    { unitId: a.unitId, weekday: 2, start: 8 * 60, end: 11 * 60 },
  ]);
  serviceId = (
    await as(a.cookie, 'POST', '/services', {
      name: 'Avaliação',
      durationMinutes: 60,
      priceCents: 15000,
    })
  ).json().id;
});

afterAll(async () => {
  for (const id of extraUsers) await owner.db.execute(sql`delete from users where id = ${id}`);
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('orçamento', () => {
  it('calcula total, desconto e à vista', async () => {
    const res = await as(a.cookie, 'POST', `/patients/${patientId}/plans`, plan());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'draft',
      subtotal: 130000,
      total: 120000,
      cashTotal: 108000,
      items: [expect.objectContaining({ tooth: null }), expect.objectContaining({ tooth: 16 })],
    });
    expect(
      (await as(a.cookie, 'POST', `/patients/${patientId}/plans`, plan({ discountCents: 999999 })))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await as(
          a.cookie,
          'POST',
          `/patients/${patientId}/plans`,
          plan({ items: [{ description: 'X', tooth: 19, unitPriceCents: 1 }] }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('paciente aprova pelo link e as parcelas viram contas a receber', async () => {
    const p = (await as(a.cookie, 'POST', `/patients/${patientId}/plans`, plan())).json();
    expect((await as(a.cookie, 'POST', `/plans/${p.id}/send`)).statusCode).toBe(200);
    const sent = (await as(a.cookie, 'POST', `/plans/${p.id}/send`)).json();
    expect(sent.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const view = (await pub('GET', `/plans/${sent.token}`)).json();
    expect(view).toMatchObject({ patientFirstName: 'Beatriz', total: 120000, maxInstallments: 3 });
    expect(JSON.stringify(view)).not.toMatch(/patientId|phone|cpf/);

    expect(
      (await pub('POST', `/plans/${sent.token}/approve`, { installments: 4 })).statusCode,
    ).toBe(400);
    const ok = await pub('POST', `/plans/${sent.token}/approve`, { installments: 3 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'approved', chosenInstallments: 3 });
    expect(
      (await pub('POST', `/plans/${sent.token}/approve`, { installments: 1 })).statusCode,
    ).toBe(409);

    const full = (await as(a.cookie, 'GET', `/plans/${p.id}`)).json();
    expect(full.charges.map((c: { amountCents: number }) => c.amountCents)).toEqual([
      40000, 40000, 40000,
    ]);
    expect(full.charges[0]).toMatchObject({
      dueDate: today,
      description: 'Clareamento + restaurações (1/3)',
    });
    expect((await as(a.cookie, 'PUT', `/plans/${p.id}`, plan())).statusCode).toBe(409);
  });

  it('à vista na clínica aplica o desconto; cancelar tira as parcelas abertas', async () => {
    const p = (await as(a.cookie, 'POST', `/patients/${patientId}/plans`, plan())).json();
    const ok = (await as(rec, 'POST', `/plans/${p.id}/approve`, { installments: 1 })).json();
    expect(ok.status).toBe('approved');
    const [c] = (await as(a.cookie, 'GET', `/plans/${p.id}`)).json().charges;
    expect(c).toMatchObject({ amountCents: 108000, status: 'open', installments: 1 });
    expect((await as(rec, 'POST', `/plans/${p.id}/cancel`)).statusCode).toBe(403);
    await as(a.cookie, 'POST', `/plans/${p.id}/cancel`);
    expect((await as(a.cookie, 'GET', `/plans/${p.id}`)).json().charges[0].status).toBe(
      'cancelled',
    );
  });

  it('outra clínica não vê o orçamento', async () => {
    const p = (await as(a.cookie, 'POST', `/patients/${patientId}/plans`, plan())).json();
    expect((await as(b.cookie, 'GET', `/plans/${p.id}`)).statusCode).toBe(404);
  });
});

describe('financeiro', () => {
  it('recebe, estorna e soma no caixa do dia e no mês', async () => {
    const c = (
      await as(rec, 'POST', '/finance/charges', {
        patientId,
        description: 'Consulta',
        amountCents: 20000,
        dueDate: today,
      })
    ).json();
    expect(
      (await as(rec, 'POST', `/finance/charges/${c.id}/pay`, { method: 'cash' })).json(),
    ).toMatchObject({
      status: 'paid',
      method: 'cash',
    });
    expect(
      (await as(rec, 'POST', `/finance/charges/${c.id}/pay`, { method: 'cash' })).statusCode,
    ).toBe(409);
    const caixa = (await as(rec, 'GET', `/finance/cashbox?day=${today}`)).json();
    expect(caixa.totalCents).toBe(20000);
    expect(caixa.byMethod).toEqual({ cash: 20000 });
    expect(caixa.items[0].patientName).toBe('Beatriz Lima');

    await as(a.cookie, 'POST', '/finance/expenses', {
      description: 'Resina',
      category: 'Material',
      supplier: 'Dental Sul',
      amountCents: 5000,
      dueDate: today,
      paid: { method: 'pix' },
    });
    await as(a.cookie, 'POST', '/finance/expenses', {
      description: 'Aluguel',
      category: 'Fixo',
      amountCents: 300000,
      dueDate: today,
    });
    const s = (await as(a.cookie, 'GET', `/finance/summary?month=${month}`)).json();
    expect(s).toMatchObject({
      receivedCents: 20000,
      paidCents: 5000,
      toPayCents: 300000,
      resultCents: 15000,
    });
    expect(s.byCategory).toMatchObject({ Material: 5000, Fixo: 300000 });
    expect((await as(rec, 'GET', `/finance/summary?month=${month}`)).statusCode).toBe(403);
    expect((await as(rec, 'GET', '/finance/expenses')).statusCode).toBe(403);

    await as(a.cookie, 'POST', `/finance/charges/${c.id}/reopen`);
    expect((await as(rec, 'GET', `/finance/cashbox?day=${today}`)).json().totalCents).toBe(0);
  });

  it('cobra no Pix e dá baixa só quando o provedor confirma', async () => {
    expect((await as(a.cookie, 'GET', '/finance/pix')).json()).toEqual({
      configured: false,
      depositCents: 0,
      testMode: true,
    });
    const c = (
      await as(rec, 'POST', '/finance/charges', {
        description: 'Limpeza',
        amountCents: 18000,
        dueDate: today,
      })
    ).json();
    const pix = (await as(rec, 'POST', `/finance/charges/${c.id}/pix`)).json();
    expect(pix).toMatchObject({ status: 'pending', amountCents: 18000, test: true });
    expect(pix.pixCode.length).toBeGreaterThan(10);
    // Pedir de novo devolve o mesmo Pix enquanto vale.
    expect((await as(rec, 'POST', `/finance/charges/${c.id}/pix`)).json().id).toBe(pix.id);

    // O aviso sozinho não dá baixa.
    await pub('POST', `/pix/${pix.id}`);
    expect((await pub('GET', `/pix/${pix.id}`)).json().status).toBe('pending');
    expect((await pub('POST', `/pix/${pix.id}/fake-approve`)).json().status).toBe('approved');
    const paid = (await as(rec, 'GET', '/finance/charges?status=paid')).json();
    expect(paid.find((x: { id: string }) => x.id === c.id)).toMatchObject({
      method: 'pix',
      status: 'paid',
    });
  });

  it('a credencial do Mercado Pago nunca volta pela API', async () => {
    expect(
      (await as(rec, 'PUT', '/finance/pix', { accessToken: 'APP_USR-segredo-123' })).statusCode,
    ).toBe(403);
    const res = await as(a.cookie, 'PUT', '/finance/pix', { accessToken: 'APP_USR-segredo-123' });
    expect(res.json()).toEqual({ configured: true, depositCents: 0, testMode: false });
    expect(JSON.stringify((await as(a.cookie, 'GET', '/finance/pix')).json())).not.toContain(
      'segredo',
    );
    await as(a.cookie, 'DELETE', '/finance/pix');
  });
});

describe('sinal no agendamento pelo site', () => {
  it('cobra o sinal no Pix; pago, a consulta fica', async () => {
    await as(a.cookie, 'PUT', '/finance/pix', { depositCents: 5000 });
    const res = await pub('POST', `/clinics/${slug}/appointments`, {
      serviceId,
      date: tuesday,
      time: '08:00',
      name: 'Marina Alves',
      phone: '(81) 95555-4444',
      consent: true,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pix).toMatchObject({ amountCents: 5000, status: 'pending' });
    expect(body.appointment.deposit).toEqual({ amountCents: 5000, status: 'open' });
    expect((await pub('GET', `/appointments/${body.token}/pix`)).json().id).toBe(body.pix.id);
    await pub('POST', `/pix/${body.pix.id}/fake-approve`);
    expect((await pub('GET', `/appointments/${body.token}`)).json().deposit.status).toBe('paid');
  });

  it('sem pagar no prazo, a consulta é cancelada e o horário volta', async () => {
    const res = await pub('POST', `/clinics/${slug}/appointments`, {
      serviceId,
      date: tuesday,
      time: '09:00',
      name: 'Joana Prado',
      phone: '(81) 94444-3333',
      consent: true,
    });
    const { token, pix } = res.json();
    const finance = app.get(FinanceService);
    // Ainda dentro do prazo do Pix: nada acontece.
    expect(await finance.sweepDeposits(new Date())).toBe(0);
    const depois = new Date(new Date(pix.expiresAt).getTime() + 60_000);
    expect(await finance.sweepDeposits(depois)).toBeGreaterThanOrEqual(1);
    const view = (await pub('GET', `/appointments/${token}`)).json();
    expect(view).toMatchObject({ status: 'cancelled', deposit: { status: 'cancelled' } });
    const slots = (
      await pub('GET', `/clinics/${slug}/slots?serviceId=${serviceId}&date=${tuesday}`)
    ).json();
    expect(slots[0].times).toContain('09:00');
    await as(a.cookie, 'PUT', '/finance/pix', { depositCents: 0 });
  });
});
