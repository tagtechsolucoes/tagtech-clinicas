import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
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
});
