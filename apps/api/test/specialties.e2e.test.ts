import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: a.cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Esp');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a]);
  await app?.close();
  await owner.close();
});

describe('teleconsulta', () => {
  it('o link da sala só aparece perto da hora', async () => {
    expect(
      (
        await call('POST', '/professionals', {
          name: 'Psi. Ana',
          telehealthUrl: 'http://meet.x/abc',
        })
      ).statusCode,
    ).toBe(400);
    const pro = (
      await call('POST', '/professionals', {
        name: 'Psi. Ana',
        telehealthUrl: 'https://meet.google.com/abc-defg-hij',
      })
    ).json();
    const svc = (
      await call('POST', '/services', {
        name: 'Sessão online',
        durationMinutes: 50,
        telehealth: true,
      })
    ).json();
    expect(svc.telehealth).toBe(true);
    const marcar = async (min: number) =>
      (
        await call('POST', '/appointments', {
          patient: { name: `Paciente ${min}`, phone: `8197777${String(1000 + min).slice(-4)}` },
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt: new Date(
            Math.ceil((Date.now() + min * 60_000) / 300_000) * 300_000,
          ).toISOString(),
          allowOutsideHours: true,
        })
      ).json() as { manageToken: string };
    const longe = await marcar(24 * 60);
    const perto = await marcar(10);
    const v1 = (
      await app.inject({ method: 'GET', url: `/public/appointments/${longe.manageToken}` })
    ).json();
    expect(v1.telehealth).toMatchObject({ url: null, configured: true });
    const v2 = (
      await app.inject({ method: 'GET', url: `/public/appointments/${perto.manageToken}` })
    ).json();
    expect(v2.telehealth.url).toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('plano alimentar', () => {
  it('vira documento clínico', async () => {
    const pro = (await call('POST', '/professionals', { name: 'Nutri Bia' })).json();
    const p = (await call('POST', '/patients', { name: 'Caio Reis', phone: '81966665555' })).json();
    const res = await call('POST', `/patients/${p.id}/documents`, {
      kind: 'meal_plan',
      professionalId: pro.id,
      content: {
        meals: [
          {
            time: '07:00',
            name: 'Café da manhã',
            items: ['2 ovos mexidos', '1 fatia de pão integral'],
          },
        ],
        water: '2,5 litros',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().content.meals[0].items).toHaveLength(2);
  });
});
