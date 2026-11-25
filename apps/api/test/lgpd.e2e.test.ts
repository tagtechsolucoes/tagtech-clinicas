import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, zonedToUtc } from '@tagtech/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const as = (who: Account, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: who.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const TZ = 'America/Recife';
const amanha = addDays(localClock(new Date(), TZ).ymd, 1);

let pro: { id: string };
let svc: { id: string };

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Lgpd');
  b = await signupAccount(app, 'OutraLgpd');
  pro = (await as(a, 'POST', '/professionals', { name: 'Dra. Lia' })).json();
  svc = (
    await as(a, 'POST', '/services', { name: 'Consulta', durationMinutes: 30, priceCents: 10000 })
  ).json();
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('direitos do titular', () => {
  it('exporta tudo o que a clínica guarda sobre o paciente, e registra', async () => {
    const p = (
      await as(a, 'POST', '/patients', {
        name: 'Clara Nunes',
        phone: '81988880001',
        allergies: 'Dipirona',
      })
    ).json();
    await as(a, 'POST', `/patients/${p.id}/notes`, { kind: 'geral', text: 'Primeira consulta.' });
    const r = await as(a, 'GET', `/patients/${p.id}/export`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    const d = r.json();
    expect(d.paciente).toMatchObject({
      nome: 'Clara Nunes',
      whatsapp: '5581988880001',
      alergias: 'Dipirona',
    });
    expect(d.prontuario).toEqual([expect.objectContaining({ texto: 'Primeira consulta.' })]);
    expect(d.registroDeAcesso.map((x: { acao: string }) => x.acao)).toContain('create');
    const log = (await as(a, 'GET', `/patients/${p.id}/access-log`)).json();
    expect(log.map((l: { action: string }) => l.action)).toContain('export');
    expect((await as(b, 'GET', `/patients/${p.id}/export`)).statusCode).toBe(404);
  });

  it('sem histórico, o pedido de exclusão apaga o cadastro de vez', async () => {
    const p = (
      await as(a, 'POST', '/patients', { name: 'Sem Historico', phone: '81988880002' })
    ).json();
    expect((await as(a, 'POST', `/patients/${p.id}/erase`)).json()).toEqual({ mode: 'deleted' });
    expect((await as(a, 'GET', `/patients/${p.id}`)).statusCode).toBe(404);
  });

  it('com prontuário, apaga o contato, cancela o que vem e guarda o prontuário', async () => {
    const p = (
      await as(a, 'POST', '/patients', {
        name: 'Com Historico',
        phone: '81988880003',
        email: 'x@y.com',
      })
    ).json();
    await as(a, 'POST', `/patients/${p.id}/notes`, { kind: 'geral', text: 'Evolução.' });
    const futura = (
      await as(a, 'POST', '/appointments', {
        patientId: p.id,
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: zonedToUtc(amanha, 10 * 60, TZ).toISOString(),
        allowOutsideHours: true,
      })
    ).json();
    const r = (await as(a, 'POST', `/patients/${p.id}/erase`)).json();
    expect(r).toEqual({ mode: 'contact_erased', cancelledAppointments: 1 });
    const depois = (await as(a, 'GET', `/patients/${p.id}`)).json();
    expect(depois).toMatchObject({ phone: '', email: '', name: 'Com Historico' });
    expect(depois.contactErasedAt).not.toBeNull();
    expect(depois.appointments.find((x: { id: string }) => x.id === futura.id).status).toBe(
      'cancelled',
    );
    expect((await as(a, 'GET', `/patients/${p.id}/notes`)).json()).toHaveLength(1);
  });

  it('a clínica exporta todos os dados, sem credenciais', async () => {
    await as(a, 'PUT', '/finance/pix', { accessToken: 'APP_USR-segredo-lgpd' });
    const r = await as(a, 'GET', '/clinic/export');
    expect(r.statusCode).toBe(200);
    const texto = r.body;
    expect(texto).toContain('Clara Nunes');
    expect(texto).not.toContain('segredo-lgpd');
    expect(texto).not.toMatch(/passwordHash|manageTokenHash|approveTokenHash/);
    const d = r.json();
    expect(d.pacientes.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(d)).not.toContain(b.tenantId);
  });
});
