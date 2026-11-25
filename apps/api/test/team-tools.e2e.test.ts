import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { localClock } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;
let rec: string;
let dra: { cookie: string };
let ana: { id: string };
let leo: { id: string };
let svc: { id: string };
let caro: { id: string };
let paciente: string;
const extraUsers: string[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
// Mês das consultas feitas (até 5 h atrás), para não quebrar na virada do mês.
const mes = localClock(new Date(Date.now() - 5 * 3600_000), 'America/Recife').ymd.slice(0, 7);

async function join(role: string, name: string) {
  const invite = (await as(a.cookie, 'POST', '/team/invites', { name, role })).json();
  const res = await app.inject({
    method: 'POST',
    url: `/invites/${invite.token}/accept`,
    payload: {
      name,
      email: `${name.toLowerCase()}-${Date.now()}@teste.tagtech`,
      password: 'senha-bem-comprida-123',
    },
  });
  extraUsers.push(res.json().userId);
  return { cookie: cookieFrom(res.headers['set-cookie']), userId: res.json().userId as string };
}

/** Consulta feita no mês, direto no banco. */
async function feita(proId: string, serviceId: string, price: number, horasAtras: number) {
  const ini = new Date(Date.now() - horasAtras * 3600_000);
  const fim = new Date(ini.getTime() + 30 * 60_000);
  await owner.db.execute(sql`insert into appointments
    (tenant_id, unit_id, professional_id, service_id, patient_id, starts_at, ends_at, status, price_cents)
    values (${a.tenantId}, ${a.unitId}, ${proId}, ${serviceId}, ${paciente},
            ${ini.toISOString()}::timestamptz, ${fim.toISOString()}::timestamptz, 'done', ${price})`);
}

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Equipe');
  b = await signupAccount(app, 'OutraEquipe');
  rec = (await join('reception', 'Rita')).cookie;
  const h = await join('professional', 'Helena');
  dra = h;
  ana = (
    await as(a.cookie, 'POST', '/professionals', { name: 'Dra. Helena', council: 'CRO-PE 12345' })
  ).json();
  // Liga o cadastro da profissional à conta dela.
  await owner.db.execute(sql`update professionals set membership_id =
    (select id from memberships where user_id = ${h.userId}) where id = ${ana.id}`);
  leo = (await as(a.cookie, 'POST', '/professionals', { name: 'Dr. Leo' })).json();
  svc = (
    await as(a.cookie, 'POST', '/services', {
      name: 'Limpeza',
      durationMinutes: 30,
      priceCents: 20000,
    })
  ).json();
  caro = (
    await as(a.cookie, 'POST', '/services', {
      name: 'Implante',
      durationMinutes: 60,
      priceCents: 300000,
    })
  ).json();
  paciente = (
    await as(a.cookie, 'POST', '/patients', { name: 'Beatriz Albuquerque', phone: '81988887777' })
  ).json().id;
});

afterAll(async () => {
  for (const id of extraUsers) await owner.db.execute(sql`delete from users where id = ${id}`);
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('documentos clínicos', () => {
  it('a profissional emite receita assinada por ela; a recepção não vê', async () => {
    const res = await as(dra.cookie, 'POST', `/patients/${paciente}/documents`, {
      kind: 'prescription',
      content: {
        items: [
          {
            name: 'Amoxicilina 500 mg',
            dosage: '1 cápsula',
            instructions: 'de 8 em 8 horas por 7 dias',
          },
        ],
      },
      professionalId: leo.id, // ignorado: assina quem está logada
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().professional).toMatchObject({ name: 'Dra. Helena', council: 'CRO-PE 12345' });
    const doc = (await as(a.cookie, 'GET', `/documents/${res.json().id}`)).json();
    expect(doc).toMatchObject({ kind: 'prescription', patient: { name: 'Beatriz Albuquerque' } });
    expect((await as(rec, 'GET', `/patients/${paciente}/documents`)).statusCode).toBe(403);
    expect((await as(b.cookie, 'GET', `/documents/${res.json().id}`)).statusCode).toBe(404);
  });

  it('atestado com CID só com autorização do paciente; conteúdo fechado', async () => {
    const base = { kind: 'certificate' };
    expect(
      (
        await as(dra.cookie, 'POST', `/patients/${paciente}/documents`, {
          ...base,
          content: { days: 2, from: '2026-11-25', cid: 'K08.8' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await as(dra.cookie, 'POST', `/patients/${paciente}/documents`, {
          ...base,
          content: { days: 2, from: '2026-11-25', cid: 'K08.8', patientAllowedCid: true },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await as(dra.cookie, 'POST', `/patients/${paciente}/documents`, {
          ...base,
          content: { days: 2, from: '2026-11-25', html: '<script>' },
        })
      ).statusCode,
    ).toBe(400);
    // Dono sem cadastro de profissional não assina por ninguém.
    const porOutro = await as(a.cookie, 'POST', `/patients/${paciente}/documents`, {
      kind: 'declaration',
      professionalId: ana.id,
      content: { date: '2026-11-25', start: '08:00', end: '09:00' },
    });
    expect(porOutro.statusCode).toBe(400);
    const lista = (await as(a.cookie, 'GET', `/patients/${paciente}/documents`)).json();
    expect(lista.map((d: { kind: string }) => d.kind)).toEqual(['certificate', 'prescription']);
  });
});

describe('repasse e relatórios', () => {
  it('porcentagem padrão, regra por serviço e valor fixo', async () => {
    await feita(ana.id, svc.id, 20000, 5);
    await feita(ana.id, caro.id, 300000, 4);
    await feita(leo.id, svc.id, 20000, 4.5);
    expect(
      (
        await as(a.cookie, 'PUT', `/reports/commissions/${ana.id}`, {
          commissionPct: 40,
          rules: [{ serviceId: caro.id, fixedCents: 50000 }],
        })
      ).statusCode,
    ).toBe(200);
    expect((await as(rec, 'GET', `/reports/payouts?month=${mes}`)).statusCode).toBe(403);
    const r = (await as(a.cookie, 'GET', `/reports/payouts?month=${mes}`)).json();
    const helena = r.find((x: { name: string }) => x.name === 'Dra. Helena');
    expect(helena).toMatchObject({
      appointments: 2,
      producedCents: 320000,
      payoutCents: 8000 + 50000,
    });
    const ov = (await as(a.cookie, 'GET', `/reports/overview?month=${mes}`)).json();
    expect(ov.totals).toMatchObject({ done: 3, revenueCents: 340000 });
    expect(ov.professionals).toHaveLength(2);
  });
});

describe('recepção e TV', () => {
  it('fila do dia, chamada com nome curto e TV só com o link', async () => {
    const quando = new Date(Date.now() + 5 * 60_000);
    const c = (
      await as(a.cookie, 'POST', '/appointments', {
        patientId: paciente,
        serviceId: svc.id,
        professionalId: ana.id,
        startsAt: quando.toISOString(),
        allowOutsideHours: true,
      })
    ).json();
    await as(rec, 'POST', `/appointments/${c.id}/status`, { status: 'arrived' });
    const fila = (await as(rec, 'GET', '/reception/queue')).json();
    expect(fila.waiting.map((x: { id: string }) => x.id)).toContain(c.id);

    const chamada = (await as(rec, 'POST', `/reception/call/${c.id}`, {})).json();
    expect(chamada).toEqual({
      id: expect.any(String),
      displayName: 'Beatriz A.',
      destination: 'Dra. Helena',
    });

    expect((await as(rec, 'POST', '/reception/tv-link')).statusCode).toBe(403);
    const { token } = (await as(a.cookie, 'POST', '/reception/tv-link')).json();
    const tv = (await app.inject({ method: 'GET', url: `/public/tv/${token}` })).json();
    expect(tv.calls[0]).toMatchObject({ displayName: 'Beatriz A.', destination: 'Dra. Helena' });
    expect(JSON.stringify(tv)).not.toMatch(/Albuquerque|81988887777/);
    // Link novo derruba a TV antiga.
    await as(a.cookie, 'POST', '/reception/tv-link');
    expect((await app.inject({ method: 'GET', url: `/public/tv/${token}` })).statusCode).toBe(410);
  });
});
