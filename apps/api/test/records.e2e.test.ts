import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { cookieFrom, createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;
let dra: string; // cookie da profissional
let rec: string; // cookie da recepção
let patientId: string;
const extraUsers: string[] = [];

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (cookie: string, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const png = (color: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .png()
    .toBuffer();

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
  return {
    cookie: cookieFrom(res.headers['set-cookie']),
    membershipId: undefined as string | undefined,
  };
}

async function upload(cookie: string, stage: string, color: string) {
  const res = await app.inject({
    method: 'PUT',
    url: `/patients/${patientId}/photos?stage=${stage}&region=Sorriso&angle=Frente&takenOn=2026-11-01`,
    headers: { cookie, 'content-type': 'image/png' },
    payload: await png(color),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
}

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Pront');
  b = await signupAccount(app, 'Outra');
  dra = (await join('professional', 'Helena')).cookie;
  rec = (await join('reception', 'Rita')).cookie;
  patientId = (
    await as(a.cookie, 'POST', '/patients', { name: 'Paciente Teste', phone: '81988887777' })
  ).json().id;
});

afterAll(async () => {
  for (const id of extraUsers) await owner.db.execute(sql`delete from users where id = ${id}`);
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('evoluções', () => {
  let noteId: string;

  it('a profissional registra com o modelo da especialidade', async () => {
    const res = await as(dra, 'POST', `/patients/${patientId}/notes`, {
      kind: 'fisio',
      data: { dor: '6', avaliacao: 'Lombar travada', invasor: 'x' },
      text: 'Primeira sessão.',
    });
    expect(res.statusCode).toBe(201);
    noteId = res.json().id;
    expect(res.json()).toMatchObject({
      kind: 'fisio',
      data: { dor: 6, avaliacao: 'Lombar travada' },
      author: 'Helena',
      mine: true,
      locked: false,
    });
    expect(
      (await as(dra, 'POST', `/patients/${patientId}/notes`, { kind: 'fisio', data: { dor: 15 } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await as(dra, 'POST', `/patients/${patientId}/notes`, { kind: 'geral', data: {} }))
        .statusCode,
    ).toBe(400);
  });

  it('a recepção não vê o prontuário', async () => {
    expect((await as(rec, 'GET', `/patients/${patientId}/notes`)).statusCode).toBe(403);
    expect((await as(rec, 'GET', `/patients/${patientId}/photos`)).statusCode).toBe(403);
  });

  it('só quem escreveu altera; finalizada não muda e recebe adendo', async () => {
    expect((await as(a.cookie, 'PATCH', `/notes/${noteId}`, { text: 'mexido' })).statusCode).toBe(
      403,
    );
    expect(
      (
        await as(dra, 'PATCH', `/notes/${noteId}`, { text: 'Primeira sessão, boa resposta.' })
      ).json().text,
    ).toBe('Primeira sessão, boa resposta.');
    expect((await as(dra, 'POST', `/notes/${noteId}/lock`)).json().locked).toBe(true);
    expect((await as(dra, 'PATCH', `/notes/${noteId}`, { text: 'depois' })).statusCode).toBe(409);
    const add = await as(dra, 'POST', `/patients/${patientId}/notes`, {
      kind: 'fisio',
      text: 'Correção: dor 5.',
      addendumOf: noteId,
    });
    expect(add.json().addendumOf).toBe(noteId);
  });

  it('evolução de psicologia nasce sigilosa: o dono vê que existe, sem o conteúdo', async () => {
    await as(dra, 'POST', `/patients/${patientId}/notes`, {
      kind: 'psico',
      data: { registro: 'Conteúdo da sessão' },
    });
    const doDono = (await as(a.cookie, 'GET', `/patients/${patientId}/notes`)).json();
    const sigilosa = doDono.find((n: { kind: string }) => n.kind === 'psico');
    expect(sigilosa).toMatchObject({ private: true, hidden: true, data: {}, text: '' });
    const daAutora = (await as(dra, 'GET', `/patients/${patientId}/notes`)).json();
    expect(daAutora.find((n: { kind: string }) => n.kind === 'psico').data).toEqual({
      registro: 'Conteúdo da sessão',
    });
  });

  it('outra clínica não lê nem escreve', async () => {
    expect((await as(b.cookie, 'GET', `/patients/${patientId}/notes`)).statusCode).toBe(404);
    expect(
      (await as(b.cookie, 'POST', `/patients/${patientId}/notes`, { kind: 'geral', text: 'x' }))
        .statusCode,
    ).toBe(404);
  });
});

describe('odontograma', () => {
  it('marca e limpa dentes pela numeração FDI', async () => {
    expect(
      (
        await as(dra, 'PUT', `/patients/${patientId}/teeth/16`, {
          state: 'caries',
          note: 'oclusal',
        })
      ).statusCode,
    ).toBe(200);
    await as(dra, 'PUT', `/patients/${patientId}/teeth/16`, { state: 'restored' });
    await as(dra, 'PUT', `/patients/${patientId}/teeth/55`, { state: 'missing' });
    expect(
      (await as(dra, 'PUT', `/patients/${patientId}/teeth/19`, { state: 'caries' })).statusCode,
    ).toBe(400);
    let teeth = (await as(dra, 'GET', `/patients/${patientId}/teeth`)).json();
    expect(teeth.map((t: { tooth: number; state: string }) => [t.tooth, t.state])).toEqual([
      [16, 'restored'],
      [55, 'missing'],
    ]);
    await as(dra, 'PUT', `/patients/${patientId}/teeth/55`, { state: null });
    teeth = (await as(dra, 'GET', `/patients/${patientId}/teeth`)).json();
    expect(teeth).toHaveLength(1);
  });
});

describe('fotos e galeria', () => {
  let antes: { id: string };
  let depois: { id: string };

  it('a foto clínica só sai com login e nunca pela rota pública', async () => {
    antes = await upload(dra, 'before', '#996655');
    depois = await upload(dra, 'after', '#ffeedd');
    const file = await as(dra, 'GET', `/photos/${antes.id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toContain('private');
    expect((await app.inject({ method: 'GET', url: `/photos/${antes.id}/file` })).statusCode).toBe(
      401,
    );
    expect((await as(b.cookie, 'GET', `/photos/${antes.id}/file`)).statusCode).toBe(404);
    const list = (await as(dra, 'GET', `/patients/${patientId}/photos`)).json();
    expect(list.map((p: { stage: string }) => p.stage)).toEqual(['before', 'after']);
    expect(JSON.stringify(list)).not.toMatch(/\.webp/);
  });

  it('sem autorização de imagem, não publica no site', async () => {
    const res = await as(a.cookie, 'POST', '/gallery', {
      beforePhotoId: antes.id,
      afterPhotoId: depois.id,
      title: 'Clareamento',
    });
    expect(res.statusCode).toBe(409);
    await as(a.cookie, 'POST', `/patients/${patientId}/image-consent`, {
      scope: 'social',
      signedOn: '2026-11-01',
    });
    expect(
      (
        await as(a.cookie, 'POST', '/gallery', {
          beforePhotoId: antes.id,
          afterPhotoId: depois.id,
          title: 'x',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('com autorização para o site, o par aparece na página da clínica; revogar tira tudo', async () => {
    await as(a.cookie, 'DELETE', `/patients/${patientId}/image-consent`);
    const c = await as(a.cookie, 'POST', `/patients/${patientId}/image-consent`, {
      scope: 'both',
      signedOn: '2026-11-02',
    });
    expect(c.json()).toMatchObject({ active: true, scope: 'both' });
    expect(
      (
        await as(a.cookie, 'POST', `/patients/${patientId}/image-consent`, {
          scope: 'site',
          signedOn: '2026-11-02',
        })
      ).statusCode,
    ).toBe(409);
    const pub = await as(a.cookie, 'POST', '/gallery', {
      beforePhotoId: antes.id,
      afterPhotoId: depois.id,
      title: 'Clareamento',
    });
    expect(pub.statusCode).toBe(201);
    const { beforeUrl } = pub.json();
    expect((await app.inject({ method: 'GET', url: beforeUrl })).statusCode).toBe(200);
    const slug = (await as(a.cookie, 'GET', '/clinic')).json().slug;
    const site = (await app.inject({ method: 'GET', url: `/public/clinics/${slug}` })).json();
    expect(site.gallery).toEqual([expect.objectContaining({ title: 'Clareamento', beforeUrl })]);
    expect(JSON.stringify(site.gallery)).not.toContain('Paciente');

    await as(a.cookie, 'DELETE', `/patients/${patientId}/image-consent`);
    expect(
      (await app.inject({ method: 'GET', url: `/public/clinics/${slug}` })).json().gallery,
    ).toEqual([]);
    expect((await app.inject({ method: 'GET', url: beforeUrl })).statusCode).toBe(404);
    // A foto original continua na ficha.
    expect((await as(dra, 'GET', `/photos/${antes.id}/file`)).statusCode).toBe(200);
  });

  it('esconde o rosto: a área marcada sai borrada no site e a original não muda', async () => {
    await as(a.cookie, 'POST', `/patients/${patientId}/image-consent`, {
      scope: 'site',
      signedOn: '2026-11-03',
    });
    const ruido = await sharp({
      create: {
        width: 240,
        height: 240,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 70 },
      },
    })
      .png()
      .toBuffer();
    const foto = (
      await app.inject({
        method: 'PUT',
        url: `/patients/${patientId}/photos?stage=before&takenOn=2026-11-03`,
        headers: { cookie: dra, 'content-type': 'image/png' },
        payload: ruido,
      })
    ).json() as { id: string };
    const fora = { x: 0, y: 0, w: 0.9, h: 1.2 };
    expect(
      (
        await as(a.cookie, 'POST', '/gallery', {
          beforePhotoId: foto.id,
          afterPhotoId: depois.id,
          title: 'x',
          hideBefore: [fora],
        })
      ).statusCode,
    ).toBe(400);
    const pub = await as(a.cookie, 'POST', '/gallery', {
      beforePhotoId: foto.id,
      afterPhotoId: depois.id,
      title: 'Harmonização',
      hideBefore: [{ x: 0, y: 0, w: 0.5, h: 0.5 }],
    });
    expect(pub.statusCode).toBe(201);
    const publica = (await app.inject({ method: 'GET', url: pub.json().beforeUrl })).rawPayload;
    const original = (await as(dra, 'GET', `/photos/${foto.id}/file`)).rawPayload;
    const desvio = async (img: Buffer, left: number) =>
      (
        await sharp(
          await sharp(img).extract({ left, top: 10, width: 90, height: 90 }).toBuffer(),
        ).stats()
      ).channels[0]!.stdev;
    // Dentro da área: quase liso. Fora dela e na original: o ruído continua.
    expect(await desvio(publica, 10)).toBeLessThan(15);
    expect(await desvio(publica, 140)).toBeGreaterThan(30);
    expect(await desvio(original, 10)).toBeGreaterThan(30);
    await as(a.cookie, 'DELETE', `/gallery/${pub.json().id}`);
  });

  it('apagar a foto remove o arquivo', async () => {
    expect((await as(dra, 'DELETE', `/photos/${antes.id}`)).statusCode).toBe(204);
    expect((await as(dra, 'GET', `/photos/${antes.id}/file`)).statusCode).toBe(404);
  });

  it('a profissional não publica na galeria (só dono e gerente)', async () => {
    expect(
      (
        await as(dra, 'POST', '/gallery', {
          beforePhotoId: depois.id,
          afterPhotoId: depois.id,
          title: 'x',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('o acesso ao prontuário fica registrado', async () => {
    const log = (await as(a.cookie, 'GET', `/patients/${patientId}/access-log`)).json();
    expect(log.filter((l: { action: string }) => l.action === 'view').length).toBe(2);
  });
});
