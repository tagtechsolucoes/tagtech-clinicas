import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, weekdayOf, zonedToUtc } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { NfseService } from '../src/nfse/nfse.service';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (who: Account, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: who.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const TZ = 'America/Recife';
const today = localClock(new Date(), TZ).ymd;
const base = addDays(today, 2);
const tuesday = addDays(base, (9 - weekdayOf(base)) % 7);
const at = (day: string, hhmm: string) =>
  zonedToUtc(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ).toISOString();

// Focus falsa: guarda o que recebeu e responde conforme o caminho.
const focus: Array<{ url: string; method: string; body: unknown }> = [];
const focusHttp = (async (url: string, init?: RequestInit) => {
  focus.push({
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  if (init?.method === 'DELETE') return Response.json({ status: 'cancelado' });
  if (init?.method === 'POST') return Response.json({ status: 'processando_autorizacao' });
  return Response.json({
    status: 'autorizado',
    numero: '123',
    codigo_verificacao: 'ABC',
    url: 'https://nfse.exemplo/123',
  });
}) as unknown as typeof fetch;

let pro: { id: string };
let fisio: { id: string };
let plano: { id: string };
let pat: { id: string };
let slug: string;

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp({ focusHttp });
  a = await signupAccount(app, 'Conv');
  b = await signupAccount(app, 'OutraConv');
  slug = (await as(a, 'GET', '/clinic')).json().slug;
  await as(a, 'PATCH', '/clinic', {
    slotStepMinutes: 60,
    insuranceEnabled: true,
    legalName: 'Clínica Conv Ltda',
    document: '12.345.678/0001-90',
  });
  pro = (
    await as(a, 'POST', '/professionals', { name: 'Dra. Fisio', council: 'CREFITO-PE 4321' })
  ).json();
  await as(a, 'PUT', `/professionals/${pro.id}/hours`, [
    { unitId: a.unitId, weekday: 2, start: 8 * 60, end: 12 * 60 },
  ]);
  fisio = (
    await as(a, 'POST', '/services', {
      name: 'Fisioterapia',
      durationMinutes: 60,
      priceCents: 15000,
    })
  ).json();
  pat = (
    await as(a, 'POST', '/patients', {
      name: 'Lucas Prado',
      phone: '81988887766',
      cpf: '529.982.247-25',
    })
  ).json();
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('convênio', () => {
  let consultas: Array<{ id: string }> = [];
  let guia: { id: string };

  it('cadastro com tabela de preço, coparticipação e TUSS', async () => {
    plano = (
      await as(a, 'POST', '/insurers', {
        name: 'Saúde Bem',
        ansCode: '123456',
        providerCode: 'PREST01',
        paymentDays: 30,
      })
    ).json();
    expect((await as(a, 'POST', '/insurers', { name: 'x', ansCode: '12' })).statusCode).toBe(400);
    const r = await as(a, 'PUT', `/insurers/${plano.id}/prices`, [
      {
        serviceId: fisio.id,
        priceCents: 6000,
        copayCents: 1500,
        tussCode: '50000470',
        needsAuthorization: true,
      },
    ]);
    expect(r.statusCode).toBe(204);
    expect((await as(b, 'PUT', `/insurers/${plano.id}/prices`, [])).statusCode).toBe(404);
    const site = (await app.inject({ method: 'GET', url: `/public/clinics/${slug}` })).json();
    expect(site.insurers).toEqual([{ id: plano.id, name: 'Saúde Bem' }]);
    expect(JSON.stringify(site)).not.toMatch(/12345678000190|Conv Ltda/);
  });

  it('consulta pelo convênio usa o preço do plano e controla as sessões da guia', async () => {
    const c1 = (
      await as(a, 'POST', '/appointments', {
        patientId: pat.id,
        serviceId: fisio.id,
        professionalId: pro.id,
        startsAt: at(tuesday, '08:00'),
      })
    ).json();
    const sem = await as(a, 'PUT', `/appointments/${c1.id}/insurance`, { insurerId: plano.id });
    expect(sem.statusCode).toBe(400);
    expect(sem.json().message).toMatch(/carteirinha/);
    await as(a, 'PUT', `/patients/${pat.id}/insurance/${plano.id}`, {
      cardNumber: '0001234500',
      planName: 'Ouro',
    });
    const r = await as(a, 'PUT', `/appointments/${c1.id}/insurance`, { insurerId: plano.id });
    expect(r.json().warnings).toEqual(['Este procedimento precisa de guia autorizada']);

    const g = await as(a, 'POST', `/patients/${pat.id}/authorizations`, {
      insurerId: plano.id,
      serviceId: fisio.id,
      guideNumber: 'G-998877',
      password: 'S3NHA',
      sessions: 2,
      validUntil: addDays(tuesday, 30),
    });
    guia = g.json().authorizations[0];
    expect(guia).toMatchObject({ sessions: 2, used: 0 });
    await as(a, 'PUT', `/appointments/${c1.id}/insurance`, {
      insurerId: plano.id,
      authorizationId: guia.id,
    });
    const c2 = (
      await as(a, 'POST', '/appointments', {
        patientId: pat.id,
        serviceId: fisio.id,
        professionalId: pro.id,
        startsAt: at(tuesday, '09:00'),
      })
    ).json();
    await as(a, 'PUT', `/appointments/${c2.id}/insurance`, {
      insurerId: plano.id,
      authorizationId: guia.id,
    });
    const c3 = (
      await as(a, 'POST', '/appointments', {
        patientId: pat.id,
        serviceId: fisio.id,
        professionalId: pro.id,
        startsAt: at(tuesday, '10:00'),
      })
    ).json();
    const cheia = await as(a, 'PUT', `/appointments/${c3.id}/insurance`, {
      insurerId: plano.id,
      authorizationId: guia.id,
    });
    expect(cheia.statusCode).toBe(409);
    const agenda = (
      await as(
        a,
        'GET',
        `/agenda?from=${at(tuesday, '00:00')}&to=${at(addDays(tuesday, 1), '00:00')}`,
      )
    ).json();
    void agenda;
    consultas = [c1, c2];
    const cards = (await as(a, 'GET', `/patients/${pat.id}/insurance`)).json();
    expect(cards.authorizations[0].used).toBe(2);
  });

  it('lote do mês, XML TISS, envio, glosa e reapresentação', async () => {
    for (const c of consultas) {
      await as(a, 'POST', `/appointments/${c.id}/status`, { status: 'arrived' });
      await as(a, 'POST', `/appointments/${c.id}/status`, { status: 'done' });
    }
    const comp = tuesday.slice(0, 7);
    const fat = (await as(a, 'GET', `/insurance/billing?competence=${comp}`)).json();
    expect(fat.pending).toEqual([
      expect.objectContaining({ insurerId: plano.id, count: 2, totalCents: 12000 }),
    ]);
    const lote = (
      await as(a, 'POST', '/insurance/batches', { insurerId: plano.id, competence: comp })
    ).json();
    expect(lote).toMatchObject({ number: 1, status: 'open', billedCents: 12000 });
    expect(lote.claims[0]).toMatchObject({
      cardNumber: '0001234500',
      guideNumber: 'G-998877',
      tussCode: '50000470',
    });
    expect(
      (await as(a, 'POST', '/insurance/batches', { insurerId: plano.id, competence: comp }))
        .statusCode,
    ).toBe(409);

    const xml = await as(a, 'GET', `/insurance/batches/${lote.id}/tiss`);
    expect(xml.headers['content-type']).toContain('xml');
    const corpo = xml.rawPayload.toString('latin1');
    expect(corpo).toContain('<ans:registroANS>123456</ans:registroANS>');
    expect(corpo).toContain('<ans:numeroCarteira>0001234500</ans:numeroCarteira>');
    expect(corpo).toContain('<ans:conselhoProfissional>05</ans:conselhoProfissional>');
    expect(corpo).toMatch(/<ans:hash>[0-9a-f]{32}<\/ans:hash>/);

    const enviado = (await as(a, 'POST', `/insurance/batches/${lote.id}/send`)).json();
    expect(enviado.status).toBe('sent');
    const aReceber = (await as(a, 'GET', '/finance/charges?status=open')).json();
    expect(aReceber).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: `Saúde Bem · lote 1 (${comp})`,
          amountCents: 12000,
          patientId: null,
        }),
      ]),
    );

    const [g1, g2] = enviado.claims;
    expect(
      (
        await as(a, 'POST', `/insurance/batches/${lote.id}/receive`, {
          items: [{ claimId: g1.id, paidCents: 3000 }],
        })
      ).statusCode,
    ).toBe(400);
    const pago = (
      await as(a, 'POST', `/insurance/batches/${lote.id}/receive`, {
        items: [
          { claimId: g1.id, paidCents: 3000, glosaReason: 'Valor acima da tabela' },
          { claimId: g2.id, paidCents: 6000 },
        ],
      })
    ).json();
    expect(pago.status).toBe('paid');
    const recebidos = (await as(a, 'GET', '/finance/charges?status=paid')).json();
    expect(
      recebidos.find((c: { description: string }) => c.description.startsWith('Saúde Bem')),
    ).toMatchObject({ amountCents: 9000, method: 'transfer' });

    const novo = (await as(a, 'POST', `/insurance/claims/${g1.id}/rebill`)).json();
    expect(novo).toMatchObject({ number: 2, status: 'open', billedCents: 3000 });
    expect((await as(a, 'POST', `/insurance/claims/${g1.id}/rebill`)).statusCode).toBe(409);
    const rel = (await as(a, 'GET', '/insurance/report')).json();
    expect(rel).toEqual([
      expect.objectContaining({ billedCents: 15000, paidCents: 9000, glosaCents: 3000 }),
    ]);
  });

  it('paciente escolhe o plano no site e informa a carteirinha', async () => {
    await as(a, 'PUT', `/insurers/${plano.id}/prices`, [
      { serviceId: fisio.id, priceCents: 6000, copayCents: 0 },
    ]);
    const r = await app.inject({
      method: 'POST',
      url: `/public/clinics/${slug}/appointments`,
      payload: {
        serviceId: fisio.id,
        date: tuesday,
        time: '11:00',
        name: 'Rita Online',
        phone: '81977776655',
        consent: true,
        insurance: { insurerId: plano.id, cardNumber: '999888777' },
      },
    });
    expect(r.statusCode).toBe(201);
    const [linha] = await owner.db.execute<{ insurer_id: string; price_cents: number }>(
      sql`select insurer_id, price_cents from appointments where id = (select appointment_id from appointment_events where appointment_id in (select id from appointments where patient_id in (select id from patients where name = 'Rita Online')) limit 1)`,
    );
    expect(linha).toMatchObject({ insurer_id: plano.id, price_cents: 6000 });
  });
});

describe('nota fiscal de serviço', () => {
  it('o token da Focus nunca volta; emite, atualiza e cancela', async () => {
    const cfg = await as(a, 'PUT', '/nfse/settings', {
      environment: 'homologacao',
      token: 'token-focus-secreto-123',
      cnpj: '12.345.678/0001-90',
      cityCode: '2611606',
      serviceCode: '040301',
      issRate: 2,
      autoEmit: true,
    });
    expect(cfg.statusCode).toBe(200);
    expect(JSON.stringify(cfg.json())).not.toContain('secreto');
    expect(JSON.stringify((await as(a, 'GET', '/nfse/settings')).json())).not.toContain('secreto');

    const c = (
      await as(a, 'POST', '/finance/charges', {
        patientId: pat.id,
        description: 'Sessão de fisioterapia',
        amountCents: 15000,
        dueDate: today,
      })
    ).json();
    expect((await as(a, 'POST', '/nfse', { chargeId: c.id })).statusCode).toBe(409);
    focus.length = 0;
    await as(a, 'POST', `/finance/charges/${c.id}/pay`, { method: 'pix' });
    await app.get(NfseService).idle();
    expect(focus[0]).toMatchObject({ method: 'POST' });
    expect(focus[0]!.url).toMatch(
      /^https:\/\/homologacao\.focusnfe\.com\.br\/v2\/nfsen\?ref=tt[0-9a-f]{18}$/,
    );
    expect(focus[0]!.body).toMatchObject({
      cnpj_prestador: '12345678000190',
      cpf_tomador: '52998224725',
      razao_social_tomador: 'Lucas Prado',
      codigo_tributacao_nacional_iss: '040301',
      valor_servico: 150,
    });
    const [nota] = (await as(a, 'GET', `/nfse?charges=${c.id}`)).json();
    expect(nota).toMatchObject({ status: 'emitting', amountCents: 15000 });
    expect((await as(a, 'POST', '/nfse', { chargeId: c.id })).statusCode).toBe(409);
    const ok = (await as(a, 'POST', `/nfse/${nota.id}/refresh`)).json();
    expect(ok).toMatchObject({
      status: 'authorized',
      number: '123',
      url: 'https://nfse.exemplo/123',
    });
    expect((await as(a, 'POST', `/nfse/${nota.id}/cancel`, { reason: 'curta' })).statusCode).toBe(
      400,
    );
    const cancelada = (
      await as(a, 'POST', `/nfse/${nota.id}/cancel`, { reason: 'Valor lançado errado no caixa' })
    ).json();
    expect(cancelada.status).toBe('cancelled');
    // Cancelada, dá para emitir de novo.
    expect((await as(a, 'POST', '/nfse', { chargeId: c.id })).statusCode).toBe(201);
  });

  it('recibo para reembolso com os dados da clínica e do paciente', async () => {
    const c = (
      await as(a, 'POST', '/finance/charges', {
        patientId: pat.id,
        description: 'Avaliação',
        amountCents: 20000,
        dueDate: today,
      })
    ).json();
    expect((await as(a, 'GET', `/finance/charges/${c.id}/receipt`)).statusCode).toBe(409);
    await as(a, 'POST', `/finance/charges/${c.id}/pay`, { method: 'cash' });
    const r = (await as(a, 'GET', `/finance/charges/${c.id}/receipt`)).json();
    expect(r).toMatchObject({
      clinic: { legalName: 'Clínica Conv Ltda', document: '12345678000190' },
      patient: { name: 'Lucas Prado', cpf: '52998224725' },
      amountCents: 20000,
      method: 'cash',
    });
    expect((await as(b, 'GET', `/finance/charges/${c.id}/receipt`)).statusCode).toBe(404);
  });
});
