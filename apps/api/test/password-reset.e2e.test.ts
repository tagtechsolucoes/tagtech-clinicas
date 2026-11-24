import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { Mailer } from '../src/mail/mailer';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let mailer: Mailer;

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const lastToken = () => {
  const text = mailer.outbox.at(-1)?.text ?? '';
  return /\/redefinir\/([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
};

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  mailer = app.get(Mailer);
  a = await signupAccount(app, 'A');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a]);
  await app?.close();
  await owner.close();
});

describe('esqueci minha senha', () => {
  it('e-mail sem conta recebe a mesma resposta e nenhum e-mail sai', async () => {
    const before = mailer.outbox.length;
    const res = await post('/auth/forgot-password', { email: 'ninguem@teste.tagtech' });
    expect(res.statusCode).toBe(204);
    expect(mailer.outbox.length).toBe(before);
  });

  it('link troca a senha, derruba sessões antigas, entra e não vale de novo', async () => {
    const res = await post('/auth/forgot-password', { email: a.email.toUpperCase() });
    expect(res.statusCode).toBe(204);
    expect(mailer.outbox.at(-1)?.to).toBe(a.email);
    const token = lastToken();
    expect(token).not.toBe('');

    const info = await app.inject({ method: 'GET', url: `/auth/reset-password/${token}` });
    expect(info.json()).toEqual({ email: a.email });

    const weak = await post(`/auth/reset-password/${token}`, { password: 'curta' });
    expect(weak.statusCode).toBe(400);

    const ok = await post(`/auth/reset-password/${token}`, { password: 'senha-nova-bem-longa' });
    expect(ok.statusCode).toBe(200);
    const fresh = cookieFrom(ok.headers['set-cookie']);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: fresh } })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: a.cookie } }))
        .statusCode,
    ).toBe(401);

    expect((await post('/auth/login', { email: a.email, password: a.password })).statusCode).toBe(
      401,
    );
    expect(
      (await post('/auth/login', { email: a.email, password: 'senha-nova-bem-longa' })).statusCode,
    ).toBe(200);

    expect(
      (await post(`/auth/reset-password/${token}`, { password: 'outra-senha-longa' })).statusCode,
    ).toBe(410);
    expect(
      (await app.inject({ method: 'GET', url: `/auth/reset-password/${token}` })).statusCode,
    ).toBe(410);
  });

  it('no máximo 3 links por hora para a mesma conta', async () => {
    const before = mailer.outbox.length;
    for (let i = 0; i < 4; i++) await post('/auth/forgot-password', { email: a.email });
    // Um já foi pedido no teste anterior: sobram 2 nesta hora.
    expect(mailer.outbox.length - before).toBe(2);
  });

  it('link inventado não vale', async () => {
    const res = await post(`/auth/reset-password/${'x'.repeat(43)}`, {
      password: 'senha-nova-bem-longa',
    });
    expect(res.statusCode).toBe(410);
  });
});
