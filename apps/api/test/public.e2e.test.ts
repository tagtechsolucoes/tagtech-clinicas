import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, weekdayOf, zonedToUtc } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let slug: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (who: Account, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
const pub = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/public${url}`, ...(payload ? { payload } : {}) });

const TZ = 'America/Recife';
const base = addDays(localClock(new Date(), TZ).ymd, 7);
const tuesday = addDays(base, (9 - weekdayOf(base)) % 7);
const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

let ana: { id: string };
let caio: { id: string };
let avaliacao: { id: string };
let interno: { id: string };

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Pub');
  slug = (await call(a, 'GET', '/clinic')).json().slug;
  await call(a, 'PATCH', '/clinic', { slotStepMinutes: 60, about: 'Atendimento sem pressa.' });
  ana = (await call(a, 'POST', '/professionals', { name: 'Dra. Ana' })).json();
  caio = (
    await call(a, 'POST', '/professionals', { name: 'Dr. Caio', onlineBooking: false })
  ).json();
  for (const p of [ana, caio]) {
    await call(a, 'PUT', `/professionals/${p.id}/hours`, [
      { unitId: a.unitId, weekday: 2, start: h('08:00'), end: h('11:00') },
    ]);
  }
  avaliacao = (
    await call(a, 'POST', '/services', { name: 'Avaliação', durationMinutes: 60, priceCents: null })
  ).json();
  interno = (
    await call(a, 'POST', '/services', {
      name: 'Retorno interno',
      durationMinutes: 30,
      onlineBooking: false,
    })
  ).json();
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a]);
  await app?.close();
  await owner.close();
});

const booking = (over: object = {}) => ({
  serviceId: avaliacao.id,
  date: tuesday,
  time: '08:00',
  name: 'Marina Alves',
  phone: '(81) 95555-4444',
  consent: true,
  ...over,
});

describe('site da clínica', () => {
  it('mostra só o que está aberto para agendamento online', async () => {
    const res = await pub('GET', `/clinics/${slug}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      name: 'Clínica Pub',
      about: 'Atendimento sem pressa.',
      booking: { enabled: true },
    });
    expect(body.professionals.map((p: { name: string }) => p.name)).toEqual(['Dra. Ana']);
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(['Avaliação']);
    expect(body.services[0].professionalIds).toEqual([ana.id]);
    expect(JSON.stringify(body)).not.toMatch(/minNotice|membershipId/);
    expect((await pub('GET', '/clinics/nao-existe-999')).statusCode).toBe(404);
  });

  it('lista horários e dias com vaga, sem quem não atende online', async () => {
    const slots = (
      await pub('GET', `/clinics/${slug}/slots?serviceId=${avaliacao.id}&date=${tuesday}`)
    ).json();
    expect(slots).toEqual([
      expect.objectContaining({ professionalId: ana.id, times: ['08:00', '09:00', '10:00'] }),
    ]);
    const days = (
      await pub(
        'GET',
        `/clinics/${slug}/days?serviceId=${avaliacao.id}&from=${addDays(tuesday, -1)}&days=3`,
      )
    ).json();
    expect(days).toEqual([
      { date: addDays(tuesday, -1), count: 0 },
      { date: tuesday, count: 3 },
      { date: addDays(tuesday, 1), count: 0 },
    ]);
    expect(
      (await pub('GET', `/clinics/${slug}/slots?serviceId=${interno.id}&date=${tuesday}`)).json(),
    ).toEqual([]);
  });
});

describe('agendamento online', () => {
  let token: string;

  it('exige aceite dos dados e nome completo', async () => {
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ consent: false }))).statusCode,
    ).toBe(400);
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ name: 'Marina' }))).statusCode,
    ).toBe(400);
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ phone: '' }))).statusCode,
    ).toBe(400);
  });

  it('agenda, cria o paciente com aceite e devolve o link', async () => {
    const res = await pub(
      'POST',
      `/clinics/${slug}/appointments`,
      booking({ notes: 'Primeira vez' }),
    );
    expect(res.statusCode).toBe(201);
    token = res.json().token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.json().appointment).toMatchObject({
      serviceName: 'Avaliação',
      professionalName: 'Dra. Ana',
      patientFirstName: 'Marina',
      status: 'scheduled',
      startsAt: zonedToUtc(tuesday, h('08:00'), TZ).toISOString(),
      canConfirm: true,
      canCancel: true,
    });
    const [p] = await owner.db.execute<{ source: string; consent_at: Date | null }>(
      sql`select source, consent_at from patients where tenant_id = ${a.tenantId} and phone = '5581955554444'`,
    );
    expect(p!.source).toBe('online');
    expect(p!.consent_at).not.toBeNull();
  });

  it('horário ocupado ou fora da grade é recusado', async () => {
    expect((await pub('POST', `/clinics/${slug}/appointments`, booking())).statusCode).toBe(409);
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ time: '08:30' }))).statusCode,
    ).toBe(409);
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ date: addDays(tuesday, 400) })))
        .statusCode,
    ).toBe(400);
  });

  it('mesmo WhatsApp e nome reaproveita o cadastro', async () => {
    const res = await pub(
      'POST',
      `/clinics/${slug}/appointments`,
      booking({ time: '09:00', name: 'marina  alves' }),
    );
    expect(res.statusCode).toBe(201);
    const rows = await owner.db.execute(
      sql`select 1 from patients where tenant_id = ${a.tenantId} and phone = '5581955554444'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('o paciente confirma e desmarca pelo link', async () => {
    expect((await pub('GET', `/appointments/${token}`)).json().status).toBe('scheduled');
    const confirmed = (await pub('POST', `/appointments/${token}/confirm`)).json();
    expect(confirmed).toMatchObject({ status: 'confirmed', canConfirm: false, canCancel: true });
    const cancelled = (await pub('POST', `/appointments/${token}/cancel`, {})).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false });
    // O horário volta para o site.
    const slots = (
      await pub('GET', `/clinics/${slug}/slots?serviceId=${avaliacao.id}&date=${tuesday}`)
    ).json();
    expect(slots[0].times).toContain('08:00');
    // A equipe vê quem desmarcou.
    const agenda = (
      await call(
        a,
        'GET',
        `/agenda?from=${zonedToUtc(tuesday, 0, TZ).toISOString()}&to=${zonedToUtc(tuesday, 1439, TZ).toISOString()}`,
      )
    ).json();
    const mine = agenda.appointments.find((x: { status: string }) => x.status === 'cancelled');
    expect(mine).toMatchObject({ source: 'online', cancelReason: 'Desmarcada pelo paciente' });
    const history = (await call(a, 'GET', `/appointments/${mine.id}/history`)).json();
    expect(history.map((e: { actor: string }) => e.actor)).toEqual([
      'Paciente',
      'Paciente',
      'Paciente',
    ]);
  });

  it('link inválido não abre nada', async () => {
    expect((await pub('GET', '/appointments/AAAAAAAAAAAAAAAAAAAAAA')).statusCode).toBe(410);
    expect((await pub('GET', '/appointments/curto')).statusCode).toBe(400);
  });

  it('com o agendamento online desligado, o site não marca', async () => {
    await call(a, 'PATCH', '/clinic', { bookingEnabled: false });
    expect(
      (await pub('POST', `/clinics/${slug}/appointments`, booking({ time: '10:00' }))).statusCode,
    ).toBe(409);
    expect(
      (await pub('GET', `/clinics/${slug}/slots?serviceId=${avaliacao.id}&date=${tuesday}`)).json(),
    ).toEqual([]);
    await call(a, 'PATCH', '/clinic', { bookingEnabled: true });
  });
});
