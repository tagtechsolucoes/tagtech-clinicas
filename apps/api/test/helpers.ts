import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Db } from '@tagtech/db';
import { APP_URL } from '../../../packages/db/test/urls';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { MEDIA_DIR } from '../src/media/media.service';
import { SignupLimiter } from '../src/auth/login-limiter';
import { AttemptLimiter } from '../src/common/attempt-limiter';
import { DATABASE_URL } from '../src/db/db.module';

/** Pasta temporária para as imagens enviadas nos testes. */
export const TEST_MEDIA_DIR = join(tmpdir(), `tagtech-media-${process.pid}`);

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_URL)
    .useValue(APP_URL)
    .overrideProvider(MEDIA_DIR)
    .useValue(TEST_MEDIA_DIR)
    // Os testes cadastram dezenas de clínicas do mesmo IP.
    .overrideProvider(SignupLimiter)
    .useValue(new AttemptLimiter({ maxFailures: 1_000_000, windowMs: 1000, message: '' }))
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface Account {
  email: string;
  password: string;
  cookie: string;
  userId: string;
  tenantId: string;
  unitId: string;
}

/** Valor "tt_session=..." do cabeçalho Set-Cookie, pronto para mandar de volta. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return header?.split(';')[0] ?? '';
}

/** Cria uma conta com clínica pelo próprio endpoint de cadastro. */
export async function signupAccount(app: NestFastifyApplication, label: string): Promise<Account> {
  const email = `dono-${label.toLowerCase()}-${randomBytes(4).toString('hex')}@teste.tagtech`;
  const password = 'senha-bem-comprida-123';
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password, name: `Dono ${label}`, clinicName: `Clínica ${label}` },
  });
  if (res.statusCode !== 201) throw new Error(`cadastro falhou: ${res.statusCode} ${res.body}`);
  const cookie = cookieFrom(res.headers['set-cookie']);
  const clinic = await app.inject({ method: 'GET', url: '/clinic', headers: { cookie } });
  const body = res.json();
  return {
    email,
    password,
    cookie,
    userId: body.userId,
    tenantId: body.memberships[0].tenantId,
    unitId: clinic.json().units[0].id,
  };
}

/** Apaga contas e clínicas criadas pelos testes. Precisa da conexão do dono do banco. */
export async function deleteAccounts(
  ownerDb: Db,
  accounts: Array<Account | undefined>,
): Promise<void> {
  for (const account of accounts) {
    if (!account) continue;
    await ownerDb.execute(sql`delete from tenants where id = ${account.tenantId}`);
    await ownerDb.execute(sql`delete from users where id = ${account.userId}`);
  }
}
