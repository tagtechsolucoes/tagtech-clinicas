import { eq, sql } from 'drizzle-orm';
import { createDb } from './client';
import { requireEnv } from './env';
import {
  appointments,
  memberships,
  patients,
  professionals,
  serviceProfessionals,
  services,
  tenants,
  timeOff,
  units,
  waitlist,
  workingHours,
} from './schema';

// Cria uma clínica de demonstração para desenvolver. Roda com o usuário dono do banco.
// Entrar: dono@demo.tagtech / demo-tagtech-123. Site: /c/clinica-aurora

const DEMO_EMAIL = 'dono@demo.tagtech';
// Hash Argon2id de "demo-tagtech-123" (o pacote db não depende da biblioteca de hash).
const DEMO_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$1XGMDAnyNTnQDt1EUNZZRg$uoCQDV1EAfhZXjj+EPB4ghYTjgKVVHk9rcpORsB4aog';
const SLUG = 'clinica-aurora';
const TZ_OFFSET = '-03:00'; // Recife não tem horário de verão

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
const dia = (n: number) => {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const em = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00${TZ_OFFSET}`);
const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

async function main() {
  const { db, close } = createDb(requireEnv('DATABASE_OWNER_URL'), { max: 1 });
  try {
    await db.delete(tenants).where(eq(tenants.slug, SLUG));
    await db.execute(sql`delete from users where email = ${DEMO_EMAIL}`);

    const [user] = await db.execute<{ id: string }>(
      sql`insert into users (email, name, password_hash) values (${DEMO_EMAIL}, 'Marina Duarte', ${DEMO_PASSWORD_HASH}) returning id`,
    );
    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Clínica Aurora',
        slug: SLUG,
        tagline: 'Odontologia e estética com hora marcada, sem sala de espera cheia',
        about:
          'Consultório no coração de Boa Viagem, com agenda enxuta e o mesmo profissional do começo ao fim do tratamento. Orçamento por escrito antes de começar.',
        whatsapp: '5581999990000',
        instagram: 'clinica.aurora',
        brandPrimary: '#1d4e5f',
        brandAccent: '#e9a23b',
        displayFont: 'serifada',
        bookingMinNoticeMinutes: 60,
        slotStepMinutes: 30,
      })
      .returning();
    const tenantId = t!.id;
    const [u] = await db
      .insert(units)
      .values({
        tenantId,
        name: 'Boa Viagem',
        address: 'Av. Conselheiro Aguiar, 2000, sala 804 · Boa Viagem · Recife/PE',
        phone: '5581999990000',
      })
      .returning();
    await db.insert(memberships).values({ tenantId, userId: user!.id, role: 'owner' });

    const pros = await db
      .insert(professionals)
      .values([
        {
          tenantId,
          name: 'Dra. Helena Prado',
          specialty: 'Clínica geral e estética dental',
          council: 'CRO-PE 12.345',
          color: '#1d4e5f',
          position: 0,
          bio: 'Formada pela UFPE, 12 anos de consultório. Tratamentos conservadores, explicados passo a passo.',
        },
        {
          tenantId,
          name: 'Dr. Rafael Moura',
          specialty: 'Ortodontia',
          council: 'CRO-PE 23.456',
          color: '#3563c9',
          position: 1,
          bio: 'Aparelhos fixos e alinhadores. Atende crianças a partir de 7 anos.',
        },
        {
          tenantId,
          name: 'Dra. Camila Torres',
          specialty: 'Harmonização orofacial',
          council: 'CRO-PE 34.567',
          color: '#c2417a',
          position: 2,
          bio: 'Toxina botulínica e preenchimento com planejamento facial completo.',
        },
      ])
      .returning();
    const [helena, rafael, camila] = pros as [(typeof pros)[0], (typeof pros)[0], (typeof pros)[0]];

    const semana = (pid: string, dias: number[], turnos: Array<[string, string]>) =>
      dias.flatMap((d) =>
        turnos.map(([a, b]) => ({
          tenantId,
          professionalId: pid,
          unitId: u!.id,
          weekday: d,
          startMinute: h(a),
          endMinute: h(b),
        })),
      );
    await db.insert(workingHours).values([
      ...semana(
        helena.id,
        [1, 2, 3, 4, 5],
        [
          ['08:00', '12:00'],
          ['13:30', '18:00'],
        ],
      ),
      ...semana(helena.id, [6], [['08:00', '12:00']]),
      ...semana(
        rafael.id,
        [1, 3, 5],
        [
          ['09:00', '12:30'],
          ['14:00', '19:00'],
        ],
      ),
      ...semana(rafael.id, [2, 4], [['14:00', '19:00']]),
      ...semana(camila.id, [2, 4], [['09:00', '17:00']]),
      ...semana(camila.id, [6], [['09:00', '13:00']]),
    ]);

    const svc = await db
      .insert(services)
      .values([
        {
          tenantId,
          name: 'Avaliação',
          category: 'Primeira consulta',
          durationMinutes: 30,
          priceCents: 12000,
          color: '#1d4e5f',
          position: 0,
          description: 'Exame completo, fotos e plano de tratamento por escrito.',
        },
        {
          tenantId,
          name: 'Limpeza e profilaxia',
          category: 'Prevenção',
          durationMinutes: 60,
          priceCents: 22000,
          color: '#2a7f52',
          position: 1,
          description: 'Remoção de tártaro, polimento e aplicação de flúor.',
        },
        {
          tenantId,
          name: 'Clareamento em consultório',
          category: 'Estética',
          durationMinutes: 90,
          priceCents: 90000,
          color: '#b48a12',
          position: 2,
          description: 'Duas sessões com gel de alta concentração e proteção gengival.',
        },
        {
          tenantId,
          name: 'Manutenção do aparelho',
          category: 'Ortodontia',
          durationMinutes: 30,
          priceCents: 18000,
          color: '#3563c9',
          position: 3,
          description: 'Troca de borrachas e ajuste do fio.',
        },
        {
          tenantId,
          name: 'Avaliação ortodôntica',
          category: 'Ortodontia',
          durationMinutes: 45,
          priceCents: 15000,
          color: '#3563c9',
          position: 4,
          description: 'Análise da mordida e indicação entre aparelho fixo e alinhadores.',
        },
        {
          tenantId,
          name: 'Toxina botulínica',
          category: 'Harmonização',
          durationMinutes: 60,
          priceCents: null,
          color: '#c2417a',
          position: 5,
          description: 'Valor definido na avaliação, conforme as áreas tratadas.',
        },
      ])
      .returning();
    const [aval, limpeza, clareamento, manutencao, avalOrto, toxina] = svc as [
      (typeof svc)[0],
      (typeof svc)[0],
      (typeof svc)[0],
      (typeof svc)[0],
      (typeof svc)[0],
      (typeof svc)[0],
    ];
    await db.insert(serviceProfessionals).values([
      { tenantId, serviceId: aval.id, professionalId: helena.id },
      { tenantId, serviceId: limpeza.id, professionalId: helena.id },
      { tenantId, serviceId: clareamento.id, professionalId: helena.id },
      { tenantId, serviceId: manutencao.id, professionalId: rafael.id },
      { tenantId, serviceId: avalOrto.id, professionalId: rafael.id },
      { tenantId, serviceId: toxina.id, professionalId: camila.id },
    ]);

    const nomes: Array<[string, string, string | null, string?, string?]> = [
      ['Beatriz Albuquerque', '5581988112233', '1991-03-14'],
      ['Carlos Eduardo Lins', '5581987114455', '1984-11-02', 'Dipirona'],
      ['Fernanda Cavalcanti', '5581996553311', '1995-07-21'],
      ['Gustavo Pessoa', '5581991224488', '2009-01-30'],
      ['Isabela Moraes', '5581985667700', '1988-09-09', '', 'Losartana 50 mg'],
      ['João Pedro Arruda', '5581992001122', '2011-05-17'],
      ['Larissa Queiroz', '5581994335577', '1993-12-01'],
      ['Mateus Barreto', '5581989776655', '1979-04-25'],
      ['Natália Freire', '5581983442211', '1997-02-11', 'Látex'],
      ['Otávio Siqueira', '5581997668899', '1969-08-08'],
      ['Paula Monteiro', '5581986554433', '1990-10-19'],
      ['Renata Brandão', '5581993112277', '1986-06-03'],
      ['Sofia Guerra', '5581984998877', '2002-03-28'],
      ['Thiago Valença', '5581990887766', '1992-01-15'],
    ];
    const pac = await db
      .insert(patients)
      .values(
        nomes.map(([name, phone, birthDate, allergies, medications]) => ({
          tenantId,
          name,
          phone,
          birthDate,
          allergies: allergies ?? '',
          medications: medications ?? '',
          consentAt: new Date(),
        })),
      )
      .returning();
    const p = (i: number) => pac[i]!.id;

    type S =
      'scheduled' | 'confirmed' | 'arrived' | 'in_progress' | 'done' | 'no_show' | 'cancelled';
    const marca = (
      d: string,
      hhmm: string,
      pro: string,
      s: (typeof svc)[0],
      pi: number,
      status: S,
      extra: Partial<typeof appointments.$inferInsert> = {},
    ) => {
      const startsAt = em(d, hhmm);
      return {
        tenantId,
        unitId: u!.id,
        professionalId: pro,
        serviceId: s.id,
        patientId: p(pi),
        startsAt,
        endsAt: new Date(startsAt.getTime() + s.durationMinutes * 60_000),
        status,
        priceCents: s.priceCents,
        confirmedAt: status === 'confirmed' ? new Date() : null,
        cancelReason: status === 'cancelled' ? 'Paciente desmarcou' : null,
        ...extra,
      };
    };
    const d0 = hoje;
    await db
      .insert(appointments)
      .values([
        marca(d0, '08:00', helena.id, limpeza, 0, 'done'),
        marca(d0, '09:00', helena.id, aval, 1, 'in_progress'),
        marca(d0, '09:30', helena.id, clareamento, 2, 'arrived'),
        marca(d0, '11:00', helena.id, aval, 3, 'confirmed', { source: 'online' }),
        marca(d0, '13:30', helena.id, limpeza, 4, 'scheduled'),
        marca(d0, '15:00', helena.id, aval, 5, 'scheduled', { source: 'online' }),
        marca(d0, '16:30', helena.id, limpeza, 6, 'confirmed'),
        marca(d0, '09:00', rafael.id, manutencao, 7, 'done'),
        marca(d0, '09:30', rafael.id, manutencao, 3, 'no_show'),
        marca(d0, '10:30', rafael.id, avalOrto, 5, 'confirmed'),
        marca(d0, '14:00', rafael.id, manutencao, 8, 'scheduled'),
        marca(d0, '15:00', rafael.id, manutencao, 9, 'cancelled'),
        marca(d0, '16:00', rafael.id, avalOrto, 10, 'scheduled', { source: 'online' }),
        marca(d0, '17:30', rafael.id, manutencao, 11, 'confirmed'),
        marca(d0, '10:00', camila.id, toxina, 12, 'confirmed'),
        marca(d0, '14:00', camila.id, toxina, 13, 'scheduled'),
        marca(dia(1), '08:00', helena.id, aval, 7, 'scheduled', { source: 'online' }),
        marca(dia(1), '10:00', helena.id, limpeza, 8, 'confirmed'),
        marca(dia(1), '14:00', helena.id, clareamento, 9, 'scheduled'),
        marca(dia(2), '09:00', helena.id, limpeza, 10, 'scheduled'),
        marca(dia(2), '11:00', helena.id, aval, 11, 'scheduled', { source: 'online' }),
        marca(dia(-1), '08:00', helena.id, limpeza, 12, 'done'),
        marca(dia(-1), '10:00', helena.id, aval, 13, 'no_show'),
      ]);

    await db.insert(timeOff).values({
      tenantId,
      professionalId: camila.id,
      startsAt: em(d0, '12:00'),
      endsAt: em(d0, '13:00'),
      reason: 'Almoço com fornecedor',
    });
    await db.insert(waitlist).values([
      {
        tenantId,
        patientId: p(6),
        serviceId: limpeza.id,
        fromDate: d0,
        toDate: dia(10),
        period: 'afternoon',
        notes: 'Pode vir em cima da hora',
      },
      {
        tenantId,
        patientId: p(2),
        serviceId: manutencao.id,
        professionalId: rafael.id,
        fromDate: d0,
        toDate: dia(7),
        period: 'any',
      },
    ]);
    console.log(
      `Clínica de demonstração pronta. Entre com ${DEMO_EMAIL} / demo-tagtech-123 · site /c/${SLUG}`,
    );
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
