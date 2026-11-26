import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let clinica: Account;
let tagtech: Account;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const como = (acc: Account, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: acc.cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  clinica = await signupAccount(app, 'Assina');
  tagtech = await signupAccount(app, 'TagTechAdm');
  process.env.PLATFORM_ADMINS = `outro@x.com, ${tagtech.email.toUpperCase()}`;
});

afterAll(async () => {
  delete process.env.PLATFORM_ADMINS;
  await deleteAccounts(owner.db, [clinica, tagtech]);
  await app?.close();
  await owner.close();
});

const definir = (patch: object) =>
  como(tagtech, 'PATCH', `/platform/tenants/${clinica.tenantId}`, {
    plan: 'clinica',
    status: 'active',
    priceCents: 19900,
    trialEndsAt: null,
    paidUntil: '2099-01-01',
    notes: '',
    ...patch,
  });

describe('assinatura', () => {
  it('clínica nova começa em teste com tudo liberado', async () => {
    const s = (await como(clinica, 'GET', '/subscription')).json();
    expect(s).toMatchObject({
      plan: 'clinica',
      situation: 'trial',
      blocked: false,
      status: 'trial',
    });
    expect(s.daysLeft).toBeGreaterThanOrEqual(13);
  });

  it('só a equipe TagTech mexe nas assinaturas', async () => {
    expect((await como(clinica, 'GET', '/platform/tenants')).statusCode).toBe(403);
    expect((await como(clinica, 'GET', '/platform/me')).json()).toEqual({ admin: false });
    expect((await como(tagtech, 'GET', '/platform/me')).json()).toEqual({ admin: true });
    const lista = (await como(tagtech, 'GET', '/platform/tenants')).json();
    expect(lista.find((t: { tenantId: string }) => t.tenantId === clinica.tenantId)).toMatchObject({
      plan: 'clinica',
      status: 'trial',
    });
  });

  it('plano Essencial: sem convênio e com 1 profissional ativo', async () => {
    expect((await definir({ plan: 'essencial' })).statusCode).toBe(200);
    const convenios = await como(clinica, 'GET', '/insurers');
    expect(convenios.statusCode).toBe(403);
    expect(convenios.json().message).toContain('Clínica');
    const [{ n } = { n: 0 }] = await owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from professionals where tenant_id = ${clinica.tenantId} and active`,
    );
    const pedidos = Array.from({ length: 2 - n }, (_, i) =>
      como(clinica, 'POST', '/professionals', { name: `Dra. Teste ${i}` }),
    );
    const respostas = [];
    for (const p of pedidos) respostas.push((await p).statusCode);
    expect(respostas.at(-1)).toBe(409);
  });

  it('suspensa: lê, não escreve, e o site não agenda', async () => {
    await definir({ status: 'suspended' });
    expect((await como(clinica, 'GET', '/clinic')).statusCode).toBe(200);
    const escrita = await como(clinica, 'PATCH', '/clinic', { tagline: 'Nova frase' });
    expect(escrita.statusCode).toBe(402);
    const [{ slug } = { slug: '' }] = await owner.db.execute<{ slug: string }>(
      sql`select slug from tenants where id = ${clinica.tenantId}`,
    );
    const site = (await app.inject({ method: 'GET', url: `/public/clinics/${slug}` })).json();
    expect(site.booking.enabled).toBe(false);
  });

  it('pagamento registrado reativa e estende o vencimento', async () => {
    await definir({ status: 'suspended', paidUntil: null });
    const r = await como(tagtech, 'POST', `/platform/tenants/${clinica.tenantId}/payments`, {
      amountCents: 19900,
      paidOn: '2026-12-01',
      months: 1,
      method: 'pix',
      note: 'dezembro',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().paidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const s = (await como(clinica, 'GET', '/subscription')).json();
    expect(s).toMatchObject({ status: 'active', blocked: false });
    expect((await como(clinica, 'PATCH', '/clinic', { tagline: 'Nova frase' })).statusCode).toBe(
      200,
    );
    const pagos = (
      await como(tagtech, 'GET', `/platform/tenants/${clinica.tenantId}/payments`)
    ).json();
    expect(pagos[0]).toMatchObject({ amountCents: 19900, months: 1, recordedBy: tagtech.email });
  });
});
