import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDb, type DbHandle } from '@tagtech/db';
import { addDays, localClock, zonedToUtc } from '@tagtech/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_URL } from '../../../packages/db/test/urls';
import { RelationshipService } from '../src/relationship/relationship.service';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';
import { createTestApp, deleteAccounts, signupAccount, type Account } from './helpers';

let app: NestFastifyApplication;
let owner: DbHandle;
let wa: WhatsAppService;
let rel: RelationshipService;
let a: Account;
let pro: { id: string };
let svc: { id: string };

interface Enviada {
  to: string;
  template: string;
  params: string[];
}
let enviadas: Enviada[] = [];
const meta: typeof fetch = async (input, init) => {
  if (!init?.method || init.method === 'GET')
    return new Response(JSON.stringify({ display_phone_number: '+55 81 99999-0000' }));
  const body = JSON.parse(String(init.body)) as {
    to: string;
    template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> };
  };
  enviadas.push({
    to: body.to,
    template: body.template.name,
    params: body.template.components[0]!.parameters.map((p) => p.text),
  });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.${enviadas.length}` }] }));
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: a.cookie }, ...(payload ? { payload } : {}) });
const pub = (method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/public${url}`, ...(payload ? { payload } : {}) });
const tokenDe = (link: string) => link.split('/').pop()!.split('?')[0]!.split('#')[0]!;
const doTipo = (t: string) => enviadas.filter((e) => e.template === t);

const TZ = 'America/Recife';
const hoje = localClock(new Date(), TZ).ymd;
const daqui = (dias: number, hhmm: string) =>
  zonedToUtc(addDays(hoje, dias), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

async function paciente(name: string, phone: string) {
  return (await call('POST', '/patients', { name, phone })).json().id as string;
}

/** Consulta antiga já feita, direto no banco. */
async function feita(patientId: string, fim: Date, serviceId = svc.id) {
  const ini = new Date(fim.getTime() - 30 * 60_000);
  await owner.db.execute(sql`insert into appointments
    (tenant_id, unit_id, professional_id, service_id, patient_id, starts_at, ends_at, status, created_at)
    values (${a.tenantId}, ${a.unitId}, ${pro.id}, ${serviceId}, ${patientId},
            ${ini.toISOString()}::timestamptz, ${fim.toISOString()}::timestamptz, 'done',
            ${ini.toISOString()}::timestamptz)`);
}

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = await createTestApp({ whatsappHttp: meta });
  wa = app.get(WhatsAppService);
  rel = app.get(RelationshipService);
  a = await signupAccount(app, 'Rel');
  pro = (await call('POST', '/professionals', { name: 'Dra. Ana' })).json();
  svc = (
    await call('POST', '/services', { name: 'Limpeza', durationMinutes: 30, priceCents: 18000 })
  ).json();
  await call(
    'PUT',
    `/professionals/${pro.id}/hours`,
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ unitId: a.unitId, weekday, start: 0, end: 1440 })),
  );
  await call('PUT', '/whatsapp', {
    phoneNumberId: '123456789012',
    accessToken: 'EAAG-token-de-teste-bem-comprido',
    templateName: 'consulta_aviso',
    templateLang: 'pt_BR',
    reminderHours: 24,
    enabled: true,
  });
});

afterAll(async () => {
  await deleteAccounts(owner.db, [a]);
  await app?.close();
  await owner.close();
});

beforeEach(async () => {
  await wa.idle();
  enviadas = [];
});

describe('vaga da lista de espera', () => {
  let consulta: { id: string };
  let carla: string;
  let davi: string;
  let tCarla = '';

  beforeAll(async () => {
    const quando = daqui(3, '10:00');
    consulta = (
      await call('POST', '/appointments', {
        patient: { name: 'Bruna Lopes', phone: '81988880001' },
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: quando.toISOString(),
        allowOutsideHours: true,
      })
    ).json();
    carla = await paciente('Carla Souza', '81988880002');
    davi = await paciente('Davi Melo', '81988880003');
    for (const patientId of [carla, davi]) {
      await call('POST', '/waitlist', {
        patientId,
        serviceId: svc.id,
        fromDate: hoje,
        toDate: addDays(hoje, 10),
        period: 'morning',
      });
    }
  });

  it('cancelou: a primeira da fila recebe a vaga no WhatsApp', async () => {
    await call('POST', `/appointments/${consulta.id}/status`, {
      status: 'cancelled',
      reason: 'Paciente viajou',
    });
    await wa.idle();
    const [oferta] = doTipo('vaga_oferta');
    expect(oferta).toMatchObject({ to: '5581988880002' });
    expect(oferta!.params.slice(0, 3)).toEqual(['Carla', 'Limpeza', 'Clínica Rel']);
    tCarla = tokenDe(oferta!.params[5]!);
    const v = (await pub('GET', `/offers/${tCarla}`)).json();
    expect(v).toMatchObject({
      patientFirstName: 'Carla',
      status: 'offered',
      serviceName: 'Limpeza',
    });
  });

  it('não pode: passa para o próximo; quem aceita fica com o horário', async () => {
    const t1 = tCarla;
    expect((await pub('POST', `/offers/${t1}/decline`)).json().status).toBe('declined');
    await wa.idle();
    const [oferta] = doTipo('vaga_oferta');
    expect(oferta!.to).toBe('5581988880003');
    const t2 = tokenDe(oferta!.params[5]!);
    const ok = await pub('POST', `/offers/${t2}/accept`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'accepted' });
    expect(ok.json().manageToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await wa.idle();
    expect(doTipo('consulta_aviso')[0]!.to).toBe('5581988880003');
    // A Carla não consegue mais aceitar a vaga que recusou.
    expect((await pub('POST', `/offers/${t1}/accept`)).statusCode).toBe(409);
    const espera = (await call('GET', '/waitlist')).json() as Array<{
      patient: { id: string };
      status: string;
    }>;
    expect(espera.find((w) => w.patient.id === carla)?.status).toBe('waiting');
    expect(espera.find((w) => w.patient.id === davi)).toBeUndefined();
    const r = (await call('GET', `/results?month=${hoje.slice(0, 7)}`)).json();
    expect(r.parts.waitlist).toMatchObject({ count: 1, valueCents: 18000 });
  });

  it('sem resposta no prazo, a vez passa', async () => {
    const outra = (
      await call('POST', '/appointments', {
        patient: { name: 'Elisa Ramos', phone: '81988880004' },
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt: daqui(4, '09:00').toISOString(),
        allowOutsideHours: true,
      })
    ).json();
    const fabio = await paciente('Fábio Nunes', '81988880005');
    await call('POST', '/waitlist', {
      patientId: fabio,
      serviceId: svc.id,
      fromDate: hoje,
      toDate: addDays(hoje, 10),
      period: 'any',
    });
    await wa.idle();
    enviadas = [];
    await call('POST', `/appointments/${outra.id}/status`, {
      status: 'cancelled',
      reason: 'Imprevisto',
    });
    await wa.idle();
    expect(doTipo('vaga_oferta').map((e) => e.to)).toEqual(['5581988880002']);
    enviadas = [];
    expect(await rel.sweepOffers(new Date(Date.now() + 3 * 3600_000))).toBeGreaterThanOrEqual(1);
    await wa.idle();
    expect(doTipo('vaga_oferta').map((e) => e.to)).toEqual(['5581988880005']);
  });
});

describe('retorno, reativação e avaliação', () => {
  // Meio-dia de hoje no fuso da clínica: dentro do horário de mandar mensagem.
  const agora = daqui(0, '12:00');

  it('lembra o retorno do serviço e não repete', async () => {
    await call('PATCH', `/services/${svc.id}`, { returnDays: 30 });
    const g = await paciente('Gabi Torres', '81988880006');
    await feita(g, new Date(agora.getTime() - 31 * 86400_000));
    await rel.sweepMessages(agora);
    const [m] = doTipo('retorno_aviso');
    expect(m).toMatchObject({
      to: '5581988880006',
      params: ['Gabi', 'Limpeza', 'Clínica Rel', expect.stringContaining('?servico=')],
    });
    enviadas = [];
    await rel.sweepMessages(agora);
    expect(doTipo('retorno_aviso')).toEqual([]);
  });

  it('chama de volta quem sumiu, só se a clínica ligou', async () => {
    const h = await paciente('Heitor Lima', '81988880007');
    const outro = (
      await call('POST', '/services', { name: 'Avaliação', durationMinutes: 30 })
    ).json();
    await feita(h, new Date(agora.getTime() - 70 * 86400_000), outro.id);
    await rel.sweepMessages(agora);
    expect(doTipo('reativacao')).toEqual([]);
    expect(
      (await call('PATCH', '/relationship/settings', { reactivationDays: 30 })).statusCode,
    ).toBe(400);
    await call('PATCH', '/relationship/settings', { reactivationDays: 60 });
    await rel.sweepMessages(agora);
    expect(doTipo('reativacao').map((e) => e.to)).toEqual(['5581988880007']);
  });

  it('pede avaliação; nota alta vai ao Google, baixa fica com a clínica', async () => {
    await call('PATCH', '/relationship/settings', {
      googleReviewUrl: 'https://g.page/r/clinica-rel/review',
    });
    const i = await paciente('Iara Costa', '81988880008');
    const j = await paciente('João Pires', '81988880009');
    await feita(i, new Date(agora.getTime() - 3 * 3600_000));
    await feita(j, new Date(agora.getTime() - 4 * 3600_000));
    await rel.sweepMessages(agora);
    const pedidos = doTipo('avaliacao_pedido');
    expect(pedidos.map((p) => p.to).sort()).toEqual(['5581988880008', '5581988880009']);
    const tok = (to: string) => tokenDe(pedidos.find((p) => p.to === to)!.params[2]!);

    const alta = (await pub('POST', `/reviews/${tok('5581988880008')}`, { rating: 5 })).json();
    expect(alta.googleUrl).toBe('https://g.page/r/clinica-rel/review');
    const baixa = (
      await pub('POST', `/reviews/${tok('5581988880009')}`, {
        rating: 2,
        comment: 'Esperei 40 min',
      })
    ).json();
    expect(baixa.googleUrl).toBeNull();
    const lista = (await call('GET', '/relationship/reviews')).json();
    expect(lista[0]).toMatchObject({
      patientName: 'João Pires',
      rating: 2,
      comment: 'Esperei 40 min',
    });

    const r = (await call('GET', `/results?month=${hoje.slice(0, 7)}`)).json();
    expect(r.reviews).toMatchObject({ requested: 2, answered: 2, toGoogle: 1, low: 1 });
  });

  it('não manda mensagem de madrugada', async () => {
    const k = await paciente('Kátia Reis', '81988880010');
    await feita(k, new Date(daqui(0, '03:00').getTime() - 31 * 86400_000));
    await rel.sweepMessages(daqui(0, '03:00'));
    expect(enviadas).toEqual([]);
  });
});
