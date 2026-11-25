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
let pro: { id: string };
let fisio: { id: string };
let outro: { id: string };
let paciente: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (who: Account, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });

const TZ = 'America/Recife';
const hoje = localClock(new Date(), TZ).ymd;
const em = (dias: number, hhmm = '15:00') =>
  zonedToUtc(addDays(hoje, dias), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'Pac');
  b = await signupAccount(app, 'OutraPac');
  pro = (await call(a, 'POST', '/professionals', { name: 'Dr. Leo' })).json();
  fisio = (
    await call(a, 'POST', '/services', {
      name: 'Fisioterapia',
      durationMinutes: 50,
      priceCents: 15000,
    })
  ).json();
  outro = (await call(a, 'POST', '/services', { name: 'Avaliação', durationMinutes: 30 })).json();
  await call(
    a,
    'PUT',
    `/professionals/${pro.id}/hours`,
    [1, 2, 3, 4, 5].map((weekday) => ({ unitId: a.unitId, weekday, start: 8 * 60, end: 18 * 60 })),
  );
  paciente = (
    await call(a, 'POST', '/patients', { name: 'Marta Dias', phone: '81977776666' })
  ).json().id;
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

// Próxima segunda-feira daqui a pelo menos 7 dias, às 15h.
const base = (() => {
  for (let d = 7; d < 14; d++) {
    const ymd = addDays(hoje, d);
    if (new Date(`${ymd}T12:00:00Z`).getUTCDay() === 1) return d;
  }
  return 7;
})();

describe('pacotes e séries', () => {
  let pacote: { id: string };

  it('cria o pacote e lança as parcelas no financeiro', async () => {
    const res = await call(a, 'POST', `/patients/${paciente}/packages`, {
      serviceId: fisio.id,
      totalSessions: 4,
      priceCents: 48000,
      charge: { installments: 2 },
    });
    expect(res.statusCode).toBe(201);
    pacote = res.json();
    expect(pacote).toMatchObject({
      title: '4 sessões de Fisioterapia',
      used: 0,
      booked: 0,
      free: 4,
      status: 'active',
    });
    const cobr = (await call(a, 'GET', `/finance/charges?patientId=${paciente}`)).json();
    expect(cobr.map((c: { amountCents: number }) => c.amountCents)).toEqual([24000, 24000]);
  });

  it('série semanal no pacote: para quando acabam as sessões e pula conflito', async () => {
    // Ocupa a 2ª semana com outra consulta para forçar um conflito.
    await call(a, 'POST', '/appointments', {
      patient: { name: 'Nina Rocha', phone: '81977775555' },
      serviceId: outro.id,
      professionalId: pro.id,
      startsAt: em(base + 7).toISOString(),
    });
    const res = await call(a, 'POST', '/appointments', {
      patientId: paciente,
      serviceId: fisio.id,
      professionalId: pro.id,
      startsAt: em(base).toISOString(),
      packageId: pacote.id,
      repeat: { everyWeeks: 1, count: 6 },
    });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s.priceCents).toBe(0);
    expect(s.series.created).toBe(4);
    expect(s.series.skipped).toHaveLength(2);
    expect(s.series.skipped[0].reason).toMatch(/consulta neste horário/);
    expect(s.series.skipped[1].reason).toMatch(/pacote/);
    const [p] = (await call(a, 'GET', `/patients/${paciente}/packages`)).json();
    expect(p).toMatchObject({ booked: 4, free: 0, remaining: 4, endingSoon: false });
    const mais = await call(a, 'POST', '/appointments', {
      patientId: paciente,
      serviceId: fisio.id,
      professionalId: pro.id,
      startsAt: em(base + 60).toISOString(),
      packageId: pacote.id,
      allowOutsideHours: true,
    });
    expect(mais.statusCode).toBe(409);
  });

  it('sessões feitas contam; acabou, o pacote fecha; desfazer reabre', async () => {
    const agenda = (
      await call(
        a,
        'GET',
        `/agenda?from=${em(base - 1).toISOString()}&to=${em(base + 60).toISOString()}`,
      )
    ).json().appointments as Array<{ id: string; packageId: string | null }>;
    const sessoes = agenda.filter((x) => x.packageId === pacote.id);
    expect(sessoes).toHaveLength(4);
    for (const x of sessoes) {
      for (const st of ['arrived', 'in_progress', 'done'])
        await call(a, 'POST', `/appointments/${x.id}/status`, { status: st });
    }
    expect((await call(a, 'GET', `/patients/${paciente}/packages`)).json()[0]).toMatchObject({
      used: 4,
      status: 'finished',
    });
    await call(a, 'POST', `/appointments/${sessoes[3]!.id}/status`, { status: 'in_progress' });
    expect((await call(a, 'GET', `/patients/${paciente}/packages`)).json()[0].status).toBe(
      'active',
    );
  });

  it('pacote de outro paciente ou serviço não serve; outra clínica não vê', async () => {
    const res = await call(a, 'POST', '/appointments', {
      patientId: paciente,
      serviceId: outro.id,
      professionalId: pro.id,
      startsAt: em(base + 1, '09:00').toISOString(),
      packageId: pacote.id,
    });
    expect(res.statusCode).toBe(400);
    expect((await call(b, 'GET', `/patients/${paciente}/packages`)).json()).toEqual([]);
  });

  it('série sem pacote e cancelar esta e as próximas', async () => {
    const res = await call(a, 'POST', '/appointments', {
      patient: { name: 'Otto Lins', phone: '81977774444' },
      serviceId: outro.id,
      professionalId: pro.id,
      startsAt: em(base + 2, '10:00').toISOString(),
      repeat: { everyWeeks: 2, count: 4 },
    });
    const s = res.json();
    expect(s.series).toMatchObject({ created: 4, skipped: [] });
    const agenda = (
      await call(
        a,
        'GET',
        `/agenda?from=${em(base).toISOString()}&to=${em(base + 60).toISOString()}`,
      )
    ).json().appointments as Array<{ id: string; seriesId: string | null; startsAt: string }>;
    const serie = agenda.filter((x) => x.seriesId === s.series.id);
    expect(serie).toHaveLength(4);
    const r = await call(a, 'POST', `/appointments/${serie[1]!.id}/cancel-series`, {
      reason: 'Alta do tratamento',
    });
    expect(r.json()).toEqual({ cancelled: 3 });
  });
});
