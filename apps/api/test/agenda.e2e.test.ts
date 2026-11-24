import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, weekdayOf, zonedToUtc } from '@tagtech/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let a: Account;
let b: Account;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (who: Account, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });

const TZ = 'America/Recife';
// Uma segunda-feira entre 7 e 13 dias à frente: sempre no futuro e dentro do prazo.
const base = addDays(localClock(new Date(), TZ).ymd, 7);
const monday = addDays(base, (8 - weekdayOf(base)) % 7);
const at = (hhmm: string, day = monday) =>
  zonedToUtc(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ).toISOString();
const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

let ana: { id: string };
let limpeza: { id: string };
let first: { id: string; patient: { id: string } };

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp();
  a = await signupAccount(app, 'A');
  b = await signupAccount(app, 'B');
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

describe('cadastro da clínica', () => {
  it('ajusta marca e agendamento', async () => {
    const res = await call(a, 'PATCH', '/clinic', {
      tagline: 'Odontologia com hora marcada',
      primaryColor: '#1D4E5F',
      whatsapp: '(81) 99999-0000',
      instagram: '@clinica.a',
      slotStepMinutes: 30,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tagline: 'Odontologia com hora marcada',
      whatsapp: '5581999990000',
      instagram: 'clinica.a',
      theme: { primaryColor: '#1d4e5f' },
      booking: { slotStepMinutes: 30 },
    });
    expect((await call(a, 'PATCH', '/clinic', { slotStepMinutes: 7 })).statusCode).toBe(400);
    expect((await call(a, 'PATCH', '/clinic', { whatsapp: '123' })).statusCode).toBe(400);
  });

  it('cadastra profissional com semana de trabalho e serviço ligado a ele', async () => {
    ana = (
      await call(a, 'POST', '/professionals', {
        name: 'Dra. Ana Lima',
        specialty: 'Dentista',
        council: 'CRO-PE 12.345',
      })
    ).json();
    const hours = await call(a, 'PUT', `/professionals/${ana.id}/hours`, [
      { unitId: a.unitId, weekday: 1, start: h('08:00'), end: h('12:00') },
      { unitId: a.unitId, weekday: 1, start: h('14:00'), end: h('18:00') },
    ]);
    expect(hours.statusCode).toBe(200);
    expect(hours.json().hours).toHaveLength(2);
    const overlap = await call(a, 'PUT', `/professionals/${ana.id}/hours`, [
      { unitId: a.unitId, weekday: 1, start: h('08:00'), end: h('12:00') },
      { unitId: a.unitId, weekday: 1, start: h('11:00'), end: h('13:00') },
    ]);
    expect(overlap.statusCode).toBe(409);

    limpeza = (
      await call(a, 'POST', '/services', {
        name: 'Limpeza',
        durationMinutes: 30,
        priceCents: 15000,
        professionalIds: [ana.id],
      })
    ).json();
    expect(limpeza).toMatchObject({
      name: 'Limpeza',
      priceCents: 15000,
      professionalIds: [ana.id],
    });
  });

  it('outra clínica não usa o profissional daqui', async () => {
    expect((await call(b, 'PATCH', `/professionals/${ana.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect((await call(b, 'GET', '/professionals')).json()).toEqual([]);
  });
});

describe('agenda', () => {
  const slots = async () => {
    const res = await call(a, 'GET', `/agenda/slots?serviceId=${limpeza.id}&date=${monday}`);
    return res.json()[0]?.times ?? [];
  };

  it('mostra os horários livres na grade da clínica', async () => {
    expect(await slots()).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
      '17:00',
      '17:30',
    ]);
  });

  it('marca com paciente novo e tira o horário da lista', async () => {
    const res = await call(a, 'POST', '/appointments', {
      patient: { name: 'Bruno Souza', phone: '(81) 98888-1111' },
      serviceId: limpeza.id,
      professionalId: ana.id,
      startsAt: at('09:00'),
    });
    expect(res.statusCode).toBe(201);
    first = res.json();
    expect(res.json()).toMatchObject({
      status: 'scheduled',
      priceCents: 15000,
      unitId: a.unitId,
      patient: { name: 'Bruno Souza', phone: '5581988881111' },
    });
    expect(res.json().manageToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await slots()).not.toContain('09:00');
  });

  it('não marca duas consultas no mesmo horário, nem como encaixe', async () => {
    const res = await call(a, 'POST', '/appointments', {
      patient: { name: 'Carla Dias', phone: '81977772222' },
      serviceId: limpeza.id,
      professionalId: ana.id,
      startsAt: at('09:15'),
      allowOutsideHours: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/já tem consulta/);
  });

  it('fora da semana de trabalho só vai como encaixe', async () => {
    const payload = {
      patientId: first.patient.id,
      serviceId: limpeza.id,
      professionalId: ana.id,
      startsAt: at('12:30'),
    };
    const refused = await call(a, 'POST', '/appointments', payload);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().reason).toBe('outside_hours');
    expect(
      (await call(a, 'POST', '/appointments', { ...payload, allowOutsideHours: true })).statusCode,
    ).toBe(201);
  });

  it('bloqueio tira os horários e impede marcar', async () => {
    const block = await call(a, 'POST', '/time-off', {
      professionalId: ana.id,
      startsAt: at('10:00'),
      endsAt: at('11:00'),
      reason: 'Curso',
    });
    expect(block.statusCode).toBe(201);
    const free = await slots();
    expect(free).not.toContain('10:00');
    expect(free).not.toContain('10:30');
    const res = await call(a, 'POST', '/appointments', {
      patientId: first.patient.id,
      serviceId: limpeza.id,
      professionalId: ana.id,
      startsAt: at('10:00'),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('time_off');
  });

  it('segue o fluxo do atendimento e recusa pulos', async () => {
    const go = (status: string, reason?: string) =>
      call(a, 'POST', `/appointments/${first.id}/status`, {
        status,
        ...(reason ? { reason } : {}),
      });
    expect((await go('confirmed')).json().status).toBe('confirmed');
    expect((await go('arrived')).json().status).toBe('arrived');
    expect((await go('in_progress')).json().status).toBe('in_progress');
    expect((await go('done')).json().status).toBe('done');
    expect((await go('cancelled', 'teste')).statusCode).toBe(409);
    const history = (await call(a, 'GET', `/appointments/${first.id}/history`)).json();
    expect(history.map((e: { to: string }) => e.to)).toEqual([
      'scheduled',
      'confirmed',
      'arrived',
      'in_progress',
      'done',
    ]);
    expect(history[1].actor).toBe('Dono A');
  });

  it('remarca, volta a "agendado" e libera o horário antigo', async () => {
    const booked = (
      await call(a, 'POST', '/appointments', {
        patientId: first.patient.id,
        serviceId: limpeza.id,
        professionalId: ana.id,
        startsAt: at('14:00'),
      })
    ).json();
    await call(a, 'POST', `/appointments/${booked.id}/status`, { status: 'confirmed' });
    const moved = await call(a, 'PATCH', `/appointments/${booked.id}`, { startsAt: at('15:00') });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      status: 'scheduled',
      startsAt: at('15:00'),
      endsAt: at('15:30'),
    });
    const free = await slots();
    expect(free).toContain('14:00');
    expect(free).not.toContain('15:00');
    const history = (await call(a, 'GET', `/appointments/${booked.id}/history`)).json();
    expect(history.at(-1)).toMatchObject({ reason: 'Remarcada', fromStartsAt: at('14:00') });
  });

  it('cancelar exige motivo e oferece o horário a quem está na lista de espera', async () => {
    const carla = (
      await call(a, 'POST', '/patients', { name: 'Carla Dias', phone: '81977772222' })
    ).json();
    const wait = await call(a, 'POST', '/waitlist', {
      patientId: carla.id,
      serviceId: limpeza.id,
      fromDate: monday,
      toDate: addDays(monday, 3),
      period: 'afternoon',
    });
    expect(wait.statusCode).toBe(201);
    const booked = (
      await call(a, 'POST', '/appointments', {
        patientId: first.patient.id,
        serviceId: limpeza.id,
        professionalId: ana.id,
        startsAt: at('16:00'),
      })
    ).json();
    expect(
      (await call(a, 'POST', `/appointments/${booked.id}/status`, { status: 'cancelled' }))
        .statusCode,
    ).toBe(400);
    const cancelled = await call(a, 'POST', `/appointments/${booked.id}/status`, {
      status: 'cancelled',
      reason: 'Paciente viajou',
    });
    expect(cancelled.json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Paciente viajou',
    });
    const matches = (await call(a, 'GET', `/appointments/${booked.id}/waitlist`)).json();
    expect(matches.map((m: { patient: { name: string } }) => m.patient.name)).toEqual([
      'Carla Dias',
    ]);
    // Manhã não combina com quem pediu tarde.
    const morning = (await call(a, 'GET', `/appointments/${first.id}/waitlist`)).json();
    expect(morning).toEqual([]);
  });

  it('a grade da agenda traz consultas e bloqueios do período', async () => {
    const res = await call(a, 'GET', `/agenda?from=${at('00:00')}&to=${at('23:59')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().appointments.length).toBeGreaterThanOrEqual(4);
    expect(res.json().timeOff).toHaveLength(1);
    expect(
      (await call(b, 'GET', `/agenda?from=${at('00:00')}&to=${at('23:59')}`)).json().appointments,
    ).toEqual([]);
  });
});

describe('pacientes', () => {
  it('busca por nome e telefone, e registra quem abriu a ficha', async () => {
    expect((await call(a, 'GET', '/patients?q=bruno')).json()[0].name).toBe('Bruno Souza');
    expect((await call(a, 'GET', '/patients?q=8888-1111')).json()[0].name).toBe('Bruno Souza');
    await call(a, 'PATCH', `/patients/${first.patient.id}`, { allergies: 'Dipirona' });
    const ficha = (await call(a, 'GET', `/patients/${first.patient.id}`)).json();
    expect(ficha).toMatchObject({ allergies: 'Dipirona', hasAlerts: true });
    expect(ficha.appointments.length).toBeGreaterThanOrEqual(3);
    const log = (await call(a, 'GET', `/patients/${first.patient.id}/access-log`)).json();
    expect(log.map((l: { action: string }) => l.action)).toEqual(['view', 'update']);
  });

  it('CPF inválido ou repetido é recusado', async () => {
    expect(
      (await call(a, 'POST', '/patients', { name: 'Davi Reis', cpf: '111.111.111-11' })).statusCode,
    ).toBe(400);
    expect(
      (await call(a, 'POST', '/patients', { name: 'Davi Reis', cpf: '529.982.247-25' })).statusCode,
    ).toBe(201);
    expect(
      (await call(a, 'POST', '/patients', { name: 'Davi R.', cpf: '52998224725' })).statusCode,
    ).toBe(409);
  });

  it('importa planilha pulando quem já existe', async () => {
    const res = await call(a, 'POST', '/patients/import', {
      rows: [
        { name: 'Bruno Souza', phone: '81 98888-1111' },
        { name: 'Elisa Costa', phone: '81 96666-3333', birthDate: '1990-05-02', cpf: 'xx' },
        { name: 'Fábio Nunes' },
      ],
    });
    expect(res.json()).toEqual({
      created: 2,
      skipped: [{ line: 1, name: 'Bruno Souza', reason: 'Já cadastrado' }],
    });
  });

  it('outra clínica não acha nem abre o paciente', async () => {
    expect((await call(b, 'GET', '/patients?q=bruno')).json()).toEqual([]);
    expect((await call(b, 'GET', `/patients/${first.patient.id}`)).statusCode).toBe(404);
    expect(
      (
        await call(b, 'POST', '/appointments', {
          patientId: first.patient.id,
          serviceId: limpeza.id,
          professionalId: ana.id,
          startsAt: at('08:00'),
        })
      ).statusCode,
    ).toBe(404);
  });
});
