import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock } from '@tagtech/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let wa: WhatsAppService;
let a: Account;
let b: Account;
let slug: string;
let pro: { id: string };
let svc: { id: string };

interface Enviada {
  to: string;
  template: string;
  params: string[];
}
let enviadas: Enviada[] = [];

// Meta falsa: responde à conferência do número e registra cada mensagem.
const meta: typeof fetch = async (input, init) => {
  const url = String(input);
  if (!init?.method || init.method === 'GET') {
    return new Response(JSON.stringify({ display_phone_number: '+55 81 99999-0000' }), {
      status: 200,
    });
  }
  const body = JSON.parse(String(init.body)) as {
    to: string;
    template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> };
  };
  if (!url.endsWith('/messages')) return new Response('{}', { status: 404 });
  enviadas.push({
    to: body.to,
    template: body.template.name,
    params: body.template.components[0]!.parameters.map((p) => p.text),
  });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${enviadas.length}` }] }), {
    status: 200,
  });
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (who: Account, method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });

const hours = (h: number) => new Date(Date.now() + h * 3600_000);
// Arredonda para a meia hora, para cair na grade.
const slot = (d: Date) => new Date(Math.ceil(d.getTime() / 1_800_000) * 1_800_000).toISOString();

async function marcar(who: Account, startsAt: string, phone = '81988887777') {
  const res = await call(who, 'POST', '/appointments', {
    patient: { name: 'Bruna Lopes', phone },
    serviceId: svc.id,
    professionalId: pro.id,
    startsAt,
    allowOutsideHours: true,
  });
  expect(res.statusCode).toBe(201);
  await wa.idle();
  return res.json() as { id: string; manageToken: string; patient: { id: string } };
}

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp({ whatsappHttp: meta });
  wa = app.get(WhatsAppService);
  a = await signupAccount(app, 'Zap');
  b = await signupAccount(app, 'SemZap');
  slug = (await call(a, 'GET', '/clinic')).json().slug;
  pro = (await call(a, 'POST', '/professionals', { name: 'Dra. Ana' })).json();
  svc = (await call(a, 'POST', '/services', { name: 'Limpeza', durationMinutes: 30 })).json();
  await call(
    a,
    'PUT',
    `/professionals/${pro.id}/hours`,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ unitId: a.unitId, weekday, start: 0, end: 1440 })),
  );
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a, b]);
  await app?.close();
  await owner.close();
});

beforeEach(() => {
  enviadas = [];
});

describe('configuração', () => {
  it('sem WhatsApp configurado, nada é enviado', async () => {
    await marcar(a, slot(hours(48)));
    expect(enviadas).toEqual([]);
  });

  it('só o dono configura, e o token nunca volta', async () => {
    const payload = {
      phoneNumberId: '123456789012',
      accessToken: 'EAAG-token-de-teste-bem-comprido',
      templateName: 'consulta_aviso',
      templateLang: 'pt_BR',
      reminderHours: 24,
      enabled: true,
    };
    const res = await call(a, 'PUT', '/whatsapp', payload);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configured: true,
      displayPhone: '+55 81 99999-0000',
      reminderHours: 24,
    });
    expect(JSON.stringify(res.json())).not.toContain('EAAG');
    expect((await call(a, 'GET', '/whatsapp')).json().configured).toBe(true);
    expect((await call(b, 'GET', '/whatsapp')).json().configured).toBe(false);
  });

  it('manda uma mensagem de teste', async () => {
    const res = await call(a, 'POST', '/whatsapp/test', { phone: '(81) 97777-6666' });
    expect(res.statusCode).toBe(200);
    expect(enviadas[0]).toMatchObject({ to: '5581977776666', template: 'consulta_aviso' });
  });
});

describe('mensagens da agenda', () => {
  it('ao agendar, o paciente recebe o aviso com o link que vale', async () => {
    const c = await marcar(a, slot(hours(50)));
    expect(enviadas).toHaveLength(1);
    const [m] = enviadas;
    expect(m!.to).toBe('5581988887777');
    expect(m!.params.slice(0, 3)).toEqual(['Bruna', 'Limpeza', 'Clínica Zap']);
    expect(m!.params[3]).toMatch(/^está marcada para /);
    expect(m!.params[4]).toBe(`http://localhost:3001/a/${c.manageToken}`);
    expect(
      (await app.inject({ method: 'GET', url: `/public/appointments/${c.manageToken}` }))
        .statusCode,
    ).toBe(200);
    const log = (await call(a, 'GET', `/appointments/${c.id}/messages`)).json();
    expect(log).toEqual([expect.objectContaining({ event: 'booked', status: 'sent' })]);
  });

  it('remarcar e cancelar também avisam; cancelar manda o link do site', async () => {
    const c = await marcar(a, slot(hours(60)));
    enviadas = [];
    await call(a, 'PATCH', `/appointments/${c.id}`, {
      startsAt: slot(hours(62)),
      allowOutsideHours: true,
    });
    await wa.idle();
    expect(enviadas[0]!.params[3]).toMatch(/^foi remarcada para /);
    const novo = enviadas[0]!.params[4]!.split('/a/')[1]!;
    expect(
      (await app.inject({ method: 'GET', url: `/public/appointments/${novo}` })).statusCode,
    ).toBe(200);
    await call(a, 'POST', `/appointments/${c.id}/status`, {
      status: 'cancelled',
      reason: 'Paciente pediu',
    });
    await wa.idle();
    expect(enviadas[1]!.params[3]).toMatch(/foi cancelada/);
    expect(enviadas[1]!.params[4]).toBe(`http://localhost:3001/c/${slug}`);
  });

  it('o lembrete sai uma vez só, na hora certa, e não para consulta cancelada', async () => {
    const c = await marcar(a, slot(hours(30)));
    const cancelada = await marcar(a, slot(hours(31)));
    await call(a, 'POST', `/appointments/${cancelada.id}/status`, {
      status: 'cancelled',
      reason: 'Teste',
    });
    await wa.idle();
    enviadas = [];
    // Ainda faltam 30 h: cedo demais.
    await wa.sweepReminders(new Date());
    expect(enviadas).toEqual([]);
    // Oito horas depois, a consulta está a menos de 24 h.
    const depois = hours(8);
    await wa.sweepReminders(depois);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.params[3]).toMatch(/Podemos contar com você\?$/);
    await wa.sweepReminders(hours(9));
    expect(enviadas).toHaveLength(1);
    const log = (await call(a, 'GET', `/appointments/${c.id}/messages`)).json();
    expect(log.map((m: { event: string }) => m.event)).toEqual(['booked', 'reminder']);
  });

  it('marcada para daqui a poucas horas: só o aviso de agendamento, sem lembrete', async () => {
    await marcar(a, slot(hours(5)));
    enviadas = [];
    await wa.sweepReminders(hours(1));
    expect(enviadas).toEqual([]);
  });

  it('paciente sem WhatsApp e clínica desligada não recebem nada', async () => {
    const res = await call(a, 'POST', '/appointments', {
      patient: { name: 'Sem Telefone', phone: '' },
      serviceId: svc.id,
      professionalId: pro.id,
      startsAt: slot(hours(70)),
      allowOutsideHours: true,
    });
    expect(res.statusCode).toBe(201);
    await wa.idle();
    expect(enviadas).toEqual([]);
    await call(a, 'PATCH', '/whatsapp', { enabled: false });
    await marcar(a, slot(hours(72)));
    expect(enviadas).toEqual([]);
    await call(a, 'PATCH', '/whatsapp', { enabled: true });
  });

  it('agendamento pelo site também avisa', async () => {
    const tz = 'America/Recife';
    const date = addDays(localClock(new Date(), tz).ymd, 4);
    const res = await app.inject({
      method: 'POST',
      url: `/public/clinics/${slug}/appointments`,
      payload: {
        serviceId: svc.id,
        date,
        time: '10:00',
        name: 'Caio Prado',
        phone: '81966665555',
        consent: true,
      },
    });
    expect(res.statusCode).toBe(201);
    await wa.idle();
    expect(enviadas[0]).toMatchObject({ to: '5581966665555' });
    expect(enviadas[0]!.params[4]).toBe(`http://localhost:3001/a/${res.json().token}`);
  });

  it('a recepção e outra clínica não mexem na configuração', async () => {
    expect((await call(b, 'PATCH', '/whatsapp', { enabled: false })).statusCode).toBe(404);
    expect((await call(b, 'DELETE', '/whatsapp')).statusCode).toBe(200);
    expect((await call(a, 'GET', '/whatsapp')).json().enabled).toBe(true);
  });
});
