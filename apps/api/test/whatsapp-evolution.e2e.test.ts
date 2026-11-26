import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

// Evolution de mentira: guarda as instâncias e o que foi enviado.
const instancias = new Map<string, { state: string; hook: string }>();
const enviados: Array<{ instance: string; number: string; text: string }> = [];
const apagadas: string[] = [];
let seq = 0;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const evolucaoFalsa = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  const h = (init?.headers as Record<string, string> | undefined) ?? {};
  if (h.apikey !== 'chave-evo') return json({ message: 'Unauthorized' }, 401);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const nome = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  const qr = { base64: 'data:image/png;base64,QUFB', code: '2@codigo-do-qr' };
  if (u.pathname === '/instance/create') {
    instancias.set(body.instanceName, { state: 'connecting', hook: body.webhook.url });
    return json({ instance: { instanceName: body.instanceName }, qrcode: qr }, 201);
  }
  if (u.pathname.startsWith('/instance/connect/')) return json(qr);
  if (u.pathname.startsWith('/instance/connectionState/'))
    return json({ instance: { instanceName: nome, state: instancias.get(nome)?.state } });
  if (u.pathname === '/instance/fetchInstances')
    return json([{ ownerJid: '558133334444@s.whatsapp.net' }]);
  if (u.pathname.startsWith('/instance/delete/')) {
    apagadas.push(nome);
    instancias.delete(nome);
    return json({ status: 'SUCCESS' });
  }
  if (u.pathname.startsWith('/instance/logout/') || u.pathname.startsWith('/webhook/set/'))
    return json({ status: 'SUCCESS' });
  if (u.pathname.startsWith('/message/sendText/')) {
    enviados.push({ instance: nome, number: body.number, text: body.text });
    return json({ key: { id: `EVO${++seq}`, fromMe: true }, status: 'PENDING' }, 201);
  }
  return json({ message: 'Not Found' }, 404);
}) as typeof fetch;

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let pro: { id: string };
let svc: { id: string };
let instancia = '';
let segredo = '';
const env = { ...process.env };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: a.cookie }, ...(payload ? { payload } : {}) });
const hook = (payload: object, s = segredo) =>
  app.inject({ method: 'POST', url: `/whatsapp/hook/${s}`, payload });
const recebida = (id: string, texto: string, jid = '558199998888@s.whatsapp.net') =>
  hook({
    event: 'messages.upsert',
    instance: instancia,
    data: {
      key: { remoteJid: jid, fromMe: false, id },
      pushName: 'Bru',
      message: { conversation: texto },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });
const conversas = async () =>
  (await call('GET', '/conversations')).json() as {
    canReply: boolean;
    conversations: Array<{ id: string; phone: string; name: string; unread: number }>;
  };
const slot = (h: number) =>
  new Date(Math.ceil((Date.now() + h * 3600_000) / 1_800_000) * 1_800_000).toISOString();

beforeAll(async () => {
  process.env.EVOLUTION_URL = 'http://evolution.test';
  process.env.EVOLUTION_API_KEY = 'chave-evo';
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp({ whatsappHttp: evolucaoFalsa });
  a = await signupAccount(app, 'EvoClin');
  pro = (await call('POST', '/professionals', { name: 'Dra. Ana' })).json();
  svc = (await call('POST', '/services', { name: 'Limpeza', durationMinutes: 30 })).json();
  await call(
    'PUT',
    `/professionals/${pro.id}/hours`,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ unitId: a.unitId, weekday, start: 0, end: 1440 })),
  );
});
beforeEach(() => {
  enviados.length = 0;
});
afterAll(async () => {
  process.env = env;
  await deleteAccounts(owner.db, [a]);
  await app?.close();
  await owner.close();
});

describe('WhatsApp da clínica pelo QR code', () => {
  it('gera o QR, conecta e guarda o número', async () => {
    const r = await call('POST', '/whatsapp/qr');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      provider: 'evolution',
      connection: 'connecting',
      qrAvailable: true,
      qr: { code: '2@codigo-do-qr' },
    });
    instancia = [...instancias.keys()][0]!;
    segredo = instancias.get(instancia)!.hook.split('/').pop()!;
    expect(instancia).toMatch(/^tc-/);
    instancias.get(instancia)!.state = 'open';
    expect((await call('GET', '/whatsapp/qr')).json()).toMatchObject({
      connection: 'open',
      displayPhone: '558133334444',
    });
  });

  it('aviso de consulta sai em texto e entra na conversa do paciente', async () => {
    const res = await call('POST', '/appointments', {
      patient: { name: 'Bruna Lopes', phone: '81999998888' },
      serviceId: svc.id,
      professionalId: pro.id,
      startsAt: slot(48),
      allowOutsideHours: true,
    });
    expect(res.statusCode).toBe(201);
    await app.get(WhatsAppService).idle();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ instance: instancia, number: '5581999998888' });
    expect(enviados[0]!.text).toMatch(/^Olá, Bruna!/);
    const { conversations } = await conversas();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ phone: '5581999998888', name: 'Bruna Lopes' });
  });

  it('resposta do paciente: mesma conversa, nome do cadastro, ligada à consulta', async () => {
    await recebida('M1', 'Posso ir 15 min mais cedo?');
    await recebida('M1', 'Posso ir 15 min mais cedo?');
    const { conversations, canReply } = await conversas();
    expect(canReply).toBe(true);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ name: 'Bruna Lopes', unread: 1 });
    const t = (await call('GET', `/conversations/${conversations[0]!.id}`)).json();
    expect(t.messages.map((m: { kind: string }) => m.kind)).toEqual(['auto', 'text']);
    expect(t.patients).toHaveLength(1);
    expect(t.appointments).toHaveLength(1);
    expect(t.appointments[0]).toMatchObject({ service: 'Limpeza', professional: 'Dra. Ana' });
  });

  it('responde pelo painel; o eco não duplica', async () => {
    const [c] = (await conversas()).conversations;
    const r = await call('POST', `/conversations/${c!.id}/messages`, { text: 'Pode sim!' });
    expect(r.statusCode).toBe(201);
    expect(enviados).toEqual([{ instance: instancia, number: '5581999998888', text: 'Pode sim!' }]);
    await hook({
      event: 'messages.upsert',
      instance: instancia,
      data: {
        key: { remoteJid: '558199998888@s.whatsapp.net', fromMe: true, id: `EVO${seq}` },
        message: { conversation: 'Pode sim!' },
      },
    });
    const t = (await call('GET', `/conversations/${c!.id}`)).json();
    expect(t.messages).toHaveLength(3);
    expect(t.conversation.unread).toBe(0);
  });

  it('o lembrete pede 1 ou 2; "1" confirma na agenda e responde sozinho', async () => {
    const wa = app.get(WhatsAppService);
    await wa.sweepReminders(new Date(Date.now() + 30 * 3600_000));
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.text).toMatch(/Podemos contar com você\?/);
    expect(enviados[0]!.text).toMatch(/Responda \*1\* para confirmar ou \*2\*/);
    const antes = (await conversas()).conversations[0]!.unread;
    await recebida('R1', 'Sim 👍');
    expect(enviados).toHaveLength(2);
    expect(enviados[1]!.text).toMatch(/^Confirmado, Bruna! Sua consulta de Limpeza é /);
    const [c] = (await conversas()).conversations;
    // O "sim" foi resolvido sozinho: não fica para a recepção ler.
    expect(c!.unread).toBe(antes);
    const t = (await call('GET', `/conversations/${c!.id}`)).json();
    expect(t.appointments[0].status).toBe('confirmed');
    // Respondeu de novo: não confirma duas vezes, só repete que está confirmada.
    await recebida('R2', '1');
    expect(enviados).toHaveLength(3);
  });

  it('"2" avisa que a recepção vai remarcar; outra mensagem é só conversa', async () => {
    await recebida('R3', '2');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.text).toMatch(/^Sem problema, Bruna! A recepção vai falar com você/);
    const [c] = (await conversas()).conversations;
    expect(c!.unread).toBeGreaterThan(0);
    await recebida('R4', 'Tem estacionamento?');
    expect(enviados).toHaveLength(1);
    // Número sem lembrete recente: "1" é só uma mensagem.
    await recebida('R5', '1', '558177776666@s.whatsapp.net');
    expect(enviados).toHaveLength(1);
  });

  it('segredo errado: ignorado', async () => {
    const antes = (await conversas()).conversations.length;
    const r = await app.inject({
      method: 'POST',
      url: `/whatsapp/hook/${'x'.repeat(43)}`,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect((await conversas()).conversations).toHaveLength(antes);
  });

  it('celular desconectou: não deixa responder', async () => {
    await hook({ event: 'connection.update', instance: instancia, data: { state: 'close' } });
    const [c] = (await conversas()).conversations;
    expect((await conversas()).canReply).toBe(false);
    expect(
      (await call('POST', `/conversations/${c!.id}/messages`, { text: 'oi' })).statusCode,
    ).toBe(409);
  });

  it('desconectar apaga a instância', async () => {
    expect((await call('DELETE', '/whatsapp')).json()).toMatchObject({ configured: false });
    expect(apagadas).toContain(instancia);
  });
});
