import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL } from '../../../packages/db/test/urls';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let appDb: DbHandle;
let a: Account;
const extra: Account[] = [];

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  appDb = createDb(APP_URL, { max: 1 });
  app = await createTestApp();
  a = await signupAccount(app, 'A');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, ...extra]);
  await app?.close();
  await appDb.close();
  await owner.close();
});

describe('cadastro', () => {
  it('cria conta, clínica, unidade e papel de dono, e já entra logado', async () => {
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: a.cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email: a.email,
      name: 'Dono A',
      memberships: [{ tenantId: a.tenantId, tenantName: 'Clínica A', role: 'owner', unitId: null }],
    });
    expect(me.body).not.toContain('password');
  });

  it('o cookie de sessão é httpOnly e SameSite=Lax', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: a.email, password: a.password },
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^tt_session=[A-Za-z0-9_-]{43}; /);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('a senha é guardada como hash Argon2id e o token de sessão só como hash', async () => {
    const [user] = await owner.db.execute<{ password_hash: string }>(
      sql`select password_hash from users where id = ${a.userId}`,
    );
    expect(user!.password_hash).toMatch(/^\$argon2id\$/);
    expect(user!.password_hash).not.toContain(a.password);

    const token = a.cookie.split('=')[1]!;
    const sessions = await owner.db.execute<{ token_hash: string }>(
      sql`select token_hash from sessions where user_id = ${a.userId}`,
    );
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.map((s) => s.token_hash)).not.toContain(token);
  });

  it('recusa e-mail repetido, mesmo com maiúsculas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: a.email.toUpperCase(),
        password: 'outra-senha-comprida',
        name: 'X',
        clinicName: 'Y',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('duas clínicas com o mesmo nome ganham endereços diferentes', async () => {
    const one = await signupAccount(app, 'Gemeo');
    const two = await signupAccount(app, 'Gemeo');
    extra.push(one, two);
    const slugs = await owner.db.execute<{ slug: string }>(
      sql`select slug from tenants where id in (${one.tenantId}, ${two.tenantId})`,
    );
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(2);
    expect(slugs.every((s) => s.slug.startsWith('clinica-gemeo'))).toBe(true);
  });

  it.each([
    ['senha curta', { password: 'curta' }],
    ['e-mail inválido', { email: 'nao-e-email' }],
    ['sem nome da clínica', { clinicName: '  ' }],
  ])('recusa %s', async (_, override) => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: 'novo@teste.tagtech',
        password: 'senha-bem-comprida-123',
        name: 'Fulano',
        clinicName: 'Bar',
        ...override,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cadastro que falha não deixa clínica pela metade', async () => {
    const name = `Fantasma ${Date.now()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: a.email,
        password: 'outra-senha-comprida',
        name: 'X',
        clinicName: name,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(await owner.db.execute(sql`select 1 from tenants where name = ${name}`)).toHaveLength(0);
  });
});

describe('login e logout', () => {
  it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: a.email, password: 'senha-errada-000' },
    });
    const noUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ninguem@teste.tagtech', password: 'senha-errada-000' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(noUser.json().message);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('sem cookie, com cookie inventado ou malformado: 401', async () => {
    for (const cookie of [undefined, `tt_session=${'A'.repeat(43)}`, 'tt_session=x', 'outro=1']) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: cookie ? { cookie } : {},
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('logout invalida a sessão no servidor, não só apaga o cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: a.email, password: a.password },
    });
    const cookie = cookieFrom(login.headers['set-cookie']);
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode,
    ).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    // o mesmo cookie, guardado por alguém, não vale mais
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401);
    // e a outra sessão da mesma pessoa continua valendo
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: a.cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it('sessão vencida não vale', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: a.email, password: a.password },
    });
    const cookie = cookieFrom(login.headers['set-cookie']);
    await owner.db.execute(
      sql`update sessions set expires_at = now() - interval '1 minute'
          where user_id = ${a.userId} and created_at = (select max(created_at) from sessions where user_id = ${a.userId})`,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  it('bloqueia depois de 5 senhas erradas seguidas, mesmo acertando na sexta', async () => {
    const victim = await signupAccount(app, 'Alvo');
    extra.push(victim);
    const attempt = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: victim.email, password },
      });
    for (let i = 0; i < 5; i++) expect((await attempt(`errada-${i}-000000`)).statusCode).toBe(401);
    expect((await attempt('errada-5-000000')).statusCode).toBe(429);
    expect((await attempt(victim.password)).statusCode).toBe(429);
  });
});

describe('usuário do banco da aplicação', () => {
  it('não lê nem escreve direto em users e sessions', async () => {
    await expect(appDb.db.execute(sql`select * from users`)).rejects.toThrow();
    await expect(appDb.db.execute(sql`select * from sessions`)).rejects.toThrow();
    await expect(
      appDb.db.execute(sql`update users set password_hash = 'x' where id = ${a.userId}`),
    ).rejects.toThrow();
  });

  it('não enxerga vínculos sem clínica definida', async () => {
    expect(await appDb.db.execute(sql`select * from memberships`)).toHaveLength(0);
  });
});
