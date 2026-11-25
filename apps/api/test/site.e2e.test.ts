import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { EMPTY_SITE } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;

const png = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#88aacc' } })
    .png()
    .toBuffer();

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'SiteA');
  b = await signupAccount(app, 'SiteB');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

const slugDe = async (acc: Account) =>
  (
    await owner.db.execute<{ slug: string }>(
      sql`select slug from tenants where id = ${acc.tenantId}`,
    )
  )[0]!.slug;

describe('conteúdo do site', () => {
  it('grava o conteúdo, recusa formato errado e mostra no site público', async () => {
    const conteudo = {
      ...EMPTY_SITE,
      stats: [{ value: '12 anos', label: 'de consultório' }],
      faq: [{ question: 'Atendem crianças?', answer: 'Sim, a partir de 4 anos.' }],
      payments: { ...EMPTY_SITE.payments, pix: true, pixDiscountPct: 5 },
    };
    const ok = await app.inject({
      method: 'PUT',
      url: '/clinic/site',
      headers: { cookie: a.cookie },
      payload: conteudo,
    });
    expect(ok.statusCode).toBe(200);

    const ruim = await app.inject({
      method: 'PUT',
      url: '/clinic/site',
      headers: { cookie: a.cookie },
      payload: { ...conteudo, faq: [{ question: 'Sem resposta' }], extra: 1 },
    });
    expect(ruim.statusCode).toBe(400);

    const pub = (
      await app.inject({ method: 'GET', url: `/public/clinics/${await slugDe(a)}` })
    ).json();
    expect(pub.site.stats).toEqual(conteudo.stats);
    expect(pub.site.payments.pixDiscountPct).toBe(5);
    expect(pub.photos).toEqual([]);
  });

  it('fotos do espaço: envia, legenda, aparece no site e outra clínica não mexe', async () => {
    const envio = await app.inject({
      method: 'POST',
      url: '/clinic/site-photos',
      headers: { cookie: a.cookie, 'content-type': 'image/png' },
      payload: await png(),
    });
    expect(envio.statusCode).toBe(201);
    const [foto] = envio.json() as Array<{ id: string; url: string }>;
    expect(foto!.url).toMatch(/^\/media\/[0-9a-f]{32}\.webp$/);

    const legenda = await app.inject({
      method: 'PATCH',
      url: `/clinic/site-photos/${foto!.id}`,
      headers: { cookie: a.cookie },
      payload: { title: 'Recepção' },
    });
    expect(legenda.json()[0].title).toBe('Recepção');

    for (const method of ['PATCH', 'DELETE'] as const) {
      const alheio = await app.inject({
        method,
        url: `/clinic/site-photos/${foto!.id}`,
        headers: { cookie: b.cookie },
        ...(method === 'PATCH' ? { payload: { title: 'x' } } : {}),
      });
      expect(alheio.statusCode).toBe(404);
    }

    const pub = (
      await app.inject({ method: 'GET', url: `/public/clinics/${await slugDe(a)}` })
    ).json();
    expect(pub.photos).toEqual([{ id: foto!.id, url: foto!.url, title: 'Recepção', caption: '' }]);

    const fora = await app.inject({
      method: 'DELETE',
      url: `/clinic/site-photos/${foto!.id}`,
      headers: { cookie: a.cookie },
    });
    expect(fora.json()).toEqual([]);
  });
});
