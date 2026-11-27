import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'ListaA');
  b = await signupAccount(app, 'ListaB');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

const overview = (acc: Account, query = '') =>
  app.inject({ method: 'GET', url: `/patients/overview${query}`, headers: { cookie: acc.cookie } });

describe('lista de pacientes com indicadores', () => {
  it('conta, filtra e não mistura clínicas', async () => {
    const criado = await app.inject({
      method: 'POST',
      url: '/patients',
      headers: { cookie: a.cookie },
      payload: { name: 'Lia Moura', phone: '(81) 99876-5432' },
    });
    expect(criado.statusCode).toBe(201);

    const r = (await overview(a)).json();
    expect(r.stats.total).toBe(1);
    expect(r.stats.newLast30).toBe(1);
    expect(r.rows[0]).toMatchObject({
      name: 'Lia Moura',
      lastVisit: null,
      nextAppointment: null,
      totalSpentCents: 0,
      situation: 'new',
    });
    expect(r.rows[0]).not.toHaveProperty('cpf');

    expect((await overview(a, '?q=98765')).json().count).toBe(1);
    expect((await overview(a, '?filter=recall')).json().count).toBe(0);
    expect((await overview(a, '?filter=xyz')).statusCode).toBe(400);

    const outra = (await overview(b)).json();
    expect(outra.stats.total).toBe(0);
    expect(outra.rows).toEqual([]);
  });

  it('quem está na clínica hoje aparece como "Na clínica"; quem marcou pelo site conta como site', async () => {
    const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
      app.inject({ method, url, headers: { cookie: a.cookie }, ...(payload ? { payload } : {}) });
    const pro = (await call('POST', '/professionals', { name: 'Dra. Teste' })).json();
    const svc = (await call('POST', '/services', { name: 'Consulta', durationMinutes: 30 })).json();
    // Começou há pouco e o paciente já chegou.
    const inicio = new Date(Math.floor((Date.now() - 20 * 60_000) / 1_800_000) * 1_800_000);
    const c = (
      await call('POST', '/appointments', {
        patient: { name: 'Rui Chegou', phone: '(81) 99111-2233' },
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: inicio.toISOString(),
        allowOutsideHours: true,
      })
    ).json();
    expect(
      (await call('POST', `/appointments/${c.id}/status`, { status: 'arrived' })).statusCode,
    ).toBe(200);
    const r = (await overview(a, '?q=Rui')).json();
    expect(r.rows[0]).toMatchObject({ situation: 'here', nextAppointment: expect.any(String) });

    // Consulta marcada pelo site: o paciente passa a contar em "Vieram pelo site".
    await owner.db.execute(sql`update appointments set source = 'online' where id = ${c.id}`);
    const site = (await overview(a, '?filter=site')).json();
    expect(site.stats.fromSite).toBe(1);
    expect(site.rows.map((x: { name: string }) => x.name)).toEqual(['Rui Chegou']);
  });
});
