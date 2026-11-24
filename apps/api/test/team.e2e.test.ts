import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;
const createdUsers: string[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function joinAs(by: Account, role: string, name: string) {
  const invite = (await call(by.cookie, 'POST', '/team/invites', { name, role })).json();
  const email = `${name.toLowerCase()}-${Date.now()}@teste.tagtech`;
  const res = await app.inject({
    method: 'POST',
    url: `/invites/${invite.token}/accept`,
    payload: { name, email, password: 'senha-bem-comprida-123' },
  });
  expect(res.statusCode).toBe(201);
  createdUsers.push(res.json().userId);
  return { cookie: cookieFrom(res.headers['set-cookie']), user: res.json(), email };
}

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'A');
  b = await signupAccount(app, 'B');
});

afterAll(async () => {
  for (const id of createdUsers) await owner.db.execute(sql`delete from users where id = ${id}`);
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('equipe da clínica', () => {
  it('convite vira conta com papel; o link vale uma vez', async () => {
    const invite = (
      await call(a.cookie, 'POST', '/team/invites', { name: 'Rita', role: 'reception' })
    ).json();
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const info = await app.inject({ method: 'GET', url: `/invites/${invite.token}` });
    expect(info.json()).toMatchObject({ clinicName: 'Clínica A', role: 'reception', name: 'Rita' });
    const res = await app.inject({
      method: 'POST',
      url: `/invites/${invite.token}/accept`,
      payload: {
        name: 'Rita',
        email: `rita-${Date.now()}@teste.tagtech`,
        password: 'senha-bem-comprida-123',
      },
    });
    expect(res.statusCode).toBe(201);
    createdUsers.push(res.json().userId);
    const rita = cookieFrom(res.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url: `/invites/${invite.token}` })).statusCode).toBe(
      410,
    );

    // Recepção usa a agenda, mas não mexe na equipe nem no cadastro da clínica.
    expect((await call(rita, 'GET', '/team')).statusCode).toBe(403);
    expect((await call(rita, 'GET', '/clinic')).statusCode).toBe(200);
    expect((await call(rita, 'PATCH', '/clinic', { name: 'Outra' })).statusCode).toBe(403);
    const list = (await call(a.cookie, 'GET', '/team')).json();
    expect(list.members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Dono A', 'owner'],
      ['Rita', 'reception'],
    ]);
  });

  it('gerente não promove a gerente nem mexe no dono', async () => {
    const gerente = await joinAs(a, 'manager', 'Gil');
    const list = (await call(a.cookie, 'GET', '/team')).json();
    const ownerM = list.members.find((m: { role: string }) => m.role === 'owner');
    const rita = list.members.find((m: { name: string }) => m.name === 'Rita');
    expect(
      (await call(gerente.cookie, 'POST', '/team/invites', { name: 'X', role: 'manager' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(gerente.cookie, 'PATCH', `/team/members/${ownerM.membershipId}`, {
          role: 'reception',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(gerente.cookie, 'PATCH', `/team/members/${rita.membershipId}`, {
          role: 'professional',
        })
      ).statusCode,
    ).toBe(204);
  });

  it('outra clínica não vê nem remove gente daqui', async () => {
    const list = (await call(a.cookie, 'GET', '/team')).json();
    const rita = list.members.find((m: { name: string }) => m.name === 'Rita');
    expect((await call(b.cookie, 'DELETE', `/team/members/${rita.membershipId}`)).statusCode).toBe(
      404,
    );
    expect((await call(b.cookie, 'GET', '/team')).json().members).toHaveLength(1);
  });

  it('convite renovado ou revogado: o link antigo deixa de valer', async () => {
    const first = (
      await call(a.cookie, 'POST', '/team/invites', { name: 'Rui', role: 'professional' })
    ).json();
    const renewed = (await call(a.cookie, 'POST', `/team/invites/${first.id}/renew`)).json();
    expect((await app.inject({ method: 'GET', url: `/invites/${first.token}` })).statusCode).toBe(
      410,
    );
    expect((await call(a.cookie, 'DELETE', `/team/invites/${first.id}`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/invites/${renewed.token}` })).statusCode).toBe(
      410,
    );
  });

  it('conta que já existe aceita o convite logada e passa a ter duas clínicas', async () => {
    const pessoa = await joinAs(a, 'professional', 'Lia');
    const invite = (
      await call(b.cookie, 'POST', '/team/invites', { name: 'Lia', role: 'professional' })
    ).json();
    expect((await call(pessoa.cookie, 'POST', `/invites/${invite.token}/join`)).statusCode).toBe(
      204,
    );
    const me = (await call(pessoa.cookie, 'GET', '/auth/me')).json();
    expect(me.memberships).toHaveLength(2);
    // Com duas clínicas, a pessoa diz qual no cabeçalho.
    expect((await call(pessoa.cookie, 'GET', '/clinic')).statusCode).toBe(400);
    const res = await app.inject({
      method: 'GET',
      url: '/clinic',
      headers: { cookie: pessoa.cookie, 'x-tenant-id': b.tenantId },
    });
    expect(res.json().name).toBe('Clínica B');
  });
});
