import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { createDb } from './client';
import { requireEnv } from './env';
import {
  appointments,
  insuranceAuthorizations,
  insurerPrices,
  insurers,
  patientInsurances,
  charges,
  serviceMaterials,
  stockItems,
  stockLots,
  stockMoves,
  supplierPrices,
  suppliers,
  clinicalNotes,
  expenses,
  memberships,
  patients,
  professionals,
  serviceProfessionals,
  services,
  sitePhotos,
  tenants,
  timeOff,
  toothChart,
  treatmentPlanItems,
  treatmentPlans,
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
/** Conteúdo do site da demonstração. Depoimentos e nota só na clínica fictícia. */
const SITE_BASE = {
  // Demonstração é odontologia: sem preço nem forma de pagamento anunciados (CFO, art. 44).
  prices: 'hide' as const,
  stats: [
    { value: '12 anos', label: 'de consultório' },
    { value: '+2.400', label: 'pacientes atendidos' },
    { value: '1 dentista', label: 'do início ao fim do tratamento' },
  ],
  highlights: [
    {
      title: 'Hora marcada de verdade',
      text: 'Atrasos acima de 10 minutos são avisados pelo WhatsApp.',
    },
    {
      title: 'Biossegurança completa',
      text: 'Instrumentais esterilizados em autoclave, kits abertos na sua frente.',
    },
    { title: 'Orçamento por escrito', text: 'Você aprova cada etapa e o valor antes de começar.' },
    {
      title: 'Conforto do início ao fim',
      text: 'Anestesia com gel tópico e pausas sempre que você precisar.',
    },
  ],
  faq: [
    {
      question: 'Preciso marcar uma avaliação antes do tratamento?',
      answer:
        'Sim. Na avaliação a dentista examina, tira fotos e entrega o plano de tratamento com valores por escrito. Se você estiver com dor, o atendimento de urgência começa na mesma consulta.',
    },
    {
      question: 'Vocês aceitam plano odontológico?',
      answer:
        'Sim, os planos aceitos estão na seção de pagamento. Para os demais, emitimos nota e relatório para pedir reembolso.',
    },
    {
      question: 'O clareamento deixa os dentes sensíveis?',
      answer:
        'Pode haver uma sensibilidade leve nos primeiros dias. Usamos gel dessensibilizante antes e depois de cada sessão.',
    },
    {
      question: 'Posso remarcar meu horário?',
      answer:
        'Pode, sem custo, com até 24 horas de antecedência, pelo próprio link que chega no WhatsApp.',
    },
    {
      question: 'Quanto tempo dura cada consulta?',
      answer:
        'Depende do procedimento: a duração média aparece ao lado de cada serviço na lista de valores.',
    },
  ],
  testimonials: [] as Array<{ name: string; text: string; service: string }>,
  rating: null as { value: number; count: number } | null,
  payments: {
    pix: false,
    credit: false,
    debit: false,
    cash: false,
    pixDiscountPct: 0,
    installments: 1,
    note: 'Seu plano não está na lista? Emitimos nota e relatório para você pedir reembolso.',
  },
  hours: [
    { days: 'Segunda a sexta', hours: '8h às 19h' },
    { days: 'Sábado', hours: '8h às 12h' },
  ],
  arrival: [
    'Estacionamento conveniado no prédio',
    'Fácil acesso por ônibus e aplicativo',
    'Prédio com acessibilidade',
  ],
};
const SITE_DEMO = {
  ...SITE_BASE,
  rating: { value: 4.9, count: 312 },
  testimonials: [
    {
      name: 'Mariana Costa',
      text: 'Fiz o clareamento e o resultado ficou natural. A doutora mostrou a simulação antes e explicou cada etapa.',
      service: 'Clareamento',
    },
    {
      name: 'Rafael Nunes',
      text: 'Tinha pavor de dentista e foi tranquilo. Atendimento no horário e retorno pelo WhatsApp no dia seguinte.',
      service: 'Tratamento de canal',
    },
    {
      name: 'Beatriz Almeida',
      text: 'Consultório muito limpo e organizado. Recebi o orçamento por escrito e sem surpresa no final.',
      service: 'Avaliação',
    },
  ],
};

// Fotos da demonstração (opcionais): o que existir em seed-media/aurora entra no site.
const here = dirname(fileURLToPath(import.meta.url));
const fotosDemo = join(here, '..', 'seed-media', 'aurora');
// Mesma pasta que a API serve (ver apps/api/src/media/media.service.ts).
const mediaDir = process.env.MEDIA_DIR ?? resolve(here, '../../..', '.data', 'media');
async function foto(arquivo: string): Promise<string | null> {
  if (!existsSync(join(fotosDemo, arquivo))) return null;
  const nome = `${randomBytes(16).toString('hex')}.webp`;
  await mkdir(mediaDir, { recursive: true });
  await copyFile(join(fotosDemo, arquivo), join(mediaDir, nome));
  return `/media/${nome}`;
}
// Fotos do espaço, na ordem do site: arquivo, título e legenda.
const ESPACO: Array<[string, string, string]> = [
  ['espaco-1.webp', 'Recepção', 'Café, água e Wi-Fi enquanto espera'],
  ['espaco-2.webp', 'Consultório', 'Equipamento novo e esterilização à vista'],
  ['espaco-3.webp', 'Atendimento', 'O mesmo profissional do começo ao fim'],
  ['espaco-4.webp', 'Sorriso', 'Clareamento e estética com planejamento'],
  ['espaco-5.webp', 'Instrumentos', 'Material esterilizado a cada atendimento'],
  ['espaco-6.webp', 'Cuidado em casa', 'Orientação de higiene para levar para casa'],
];

// SEED_ADMIN="email": conta da TagTech, que entra como gerente da clínica de demonstração.
const ADMIN = process.env.SEED_ADMIN?.trim().toLowerCase() || '';
const senhas: string[] = [];

/** Conta pelo e-mail; se não existir, cria com uma senha aleatória (mostrada uma vez). */
async function conta(
  db: ReturnType<typeof createDb>['db'],
  email: string,
  nome: string,
): Promise<{ id: string; email: string; senha: string | null }> {
  const [existe] = await db.execute<{ id: string }>(
    sql`select id from users where lower(email) = ${email}`,
  );
  if (existe) return { id: existe.id, email, senha: null };
  const senha = randomBytes(12).toString('base64url');
  const senhaHash = await hash(senha, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const [novo] = await db.execute<{ id: string }>(
    sql`insert into users (email, name, password_hash) values (${email}, ${nome}, ${senhaHash}) returning id`,
  );
  return { id: novo!.id, email, senha };
}

const INTO = process.env.SEED_INTO?.trim() || '';
// SEED_DONO="email": a clínica de demonstração fica com uma conta que já existe (a sua), sem
// criar a conta dono@demo.tagtech, cuja senha está neste arquivo. Em servidor é obrigatório.
const DONO = process.env.SEED_DONO?.trim().toLowerCase() || '';
const LOCAL = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_OWNER_URL ?? '');
// Na clínica de verdade, telefones de mentira (nunca de alguém): 55 81 90000-00NN.
const fone = (real: string, i: number) =>
  INTO ? `558190000${String(i + 1).padStart(4, '0')}` : real;
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
    // SEED_INTO="Nome ou endereço da clínica": preenche uma clínica que já existe (com o dono
    // que você criou) em vez de criar a Clínica Aurora.
    let tenantId: string;
    let u: { id: string } | undefined;
    let autorId: string;
    if (INTO) {
      const [t] = await db.execute<{ id: string; name: string }>(
        sql`select id, name from tenants where lower(name) = lower(${INTO}) or slug = ${INTO}`,
      );
      if (!t)
        throw new Error(`Clínica "${INTO}" não encontrada (use o nome ou o endereço do site)`);
      const [{ n }] = (await db.execute<{ n: number }>(
        sql`select count(*)::int n from patients where tenant_id = ${t.id}`,
      )) as unknown as [{ n: number }];
      if (n > 0 && process.env.SEED_FORCE !== '1')
        throw new Error(
          `"${t.name}" já tem ${n} pacientes. Para preencher mesmo assim: SEED_FORCE=1`,
        );
      tenantId = t.id;
      [u] = await db
        .select({ id: units.id })
        .from(units)
        .where(eq(units.tenantId, tenantId))
        .limit(1);
      if (!u) throw new Error('A clínica não tem unidade');
      const [dono] = await db.execute<{ user_id: string }>(
        sql`select user_id from memberships where tenant_id = ${tenantId} and role = 'owner' limit 1`,
      );
      autorId = dono!.user_id;
      await db.execute(sql`update tenants set
          tagline = coalesce(nullif(tagline, ''), 'Odontologia com hora marcada, sem sala de espera cheia'),
          about = coalesce(nullif(about, ''), 'Agenda enxuta, orçamento por escrito antes de começar e o mesmo profissional do começo ao fim do tratamento.')
        where id = ${tenantId}`);
      await db.execute(
        sql`update tenants set site = ${JSON.stringify(SITE_BASE)}::jsonb where id = ${tenantId} and site = '{}'::jsonb`,
      );
      console.log(`Preenchendo "${t.name}" com dados de demonstração…`);
    } else {
      if (!DONO && !LOCAL)
        throw new Error(
          'Fora do computador local, informe SEED_DONO=<seu e-mail já cadastrado>: a conta dono@demo.tagtech tem senha pública.',
        );
      // Confere a conta antes de apagar qualquer coisa: e-mail errado não pode sumir com a Aurora.
      // Contas antes de apagar qualquer coisa. Conta que não existe é criada com senha nova.
      const dono = DONO ? await conta(db, DONO, 'Clínica Aurora') : null;
      const admin = ADMIN ? await conta(db, ADMIN, 'TagTech') : null;
      await db.delete(tenants).where(eq(tenants.slug, SLUG));
      await db.execute(sql`delete from users where email = ${DEMO_EMAIL}`);

      const [user] = dono
        ? [dono]
        : await db.execute<{ id: string }>(
            sql`insert into users (email, name, password_hash) values (${DEMO_EMAIL}, 'Marina Duarte', ${DEMO_PASSWORD_HASH}) returning id`,
          );
      if (!user)
        throw new Error(`Nenhuma conta com o e-mail ${DONO}. Crie a conta no painel antes.`);
      const [novo] = await db
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
          displayFont: 'grotesca',
          site: SITE_DEMO,
          bookingMinNoticeMinutes: 60,
          slotStepMinutes: 30,
        })
        .returning();
      tenantId = novo!.id;
      // Demonstração sem fim: não entra em teste grátis nem vence.
      await db.execute(sql`
        update subscriptions set plan = 'clinica', status = 'active', trial_ends_at = null,
          paid_until = '2099-12-31', notes = 'Demonstração da TagTech'
        where tenant_id = ${tenantId}`);
      const [capa, logo] = [await foto('capa.webp'), await foto('logo.webp')];
      if (capa || logo)
        await db
          .update(tenants)
          .set({ ...(capa ? { coverUrl: capa } : {}), ...(logo ? { logoUrl: logo } : {}) })
          .where(eq(tenants.id, tenantId));
      let posicao = 0;
      for (const [arquivo, title, caption] of ESPACO) {
        const url = await foto(arquivo);
        if (url)
          await db
            .insert(sitePhotos)
            .values({ tenantId, url, title, caption, position: posicao++ });
      }
      const [unidade] = await db
        .insert(units)
        .values({
          tenantId,
          name: 'Boa Viagem',
          address: 'Av. Conselheiro Aguiar, 2000, sala 804 · Boa Viagem · Recife/PE',
          phone: '5581999990000',
        })
        .returning();
      await db.insert(memberships).values({ tenantId, userId: user!.id, role: 'owner' });
      // A TagTech entra como gerente: vê a Aurora e, pelo PLATFORM_ADMINS, a tela TagTech.
      if (admin && admin.id !== user!.id)
        await db.insert(memberships).values({ tenantId, userId: admin.id, role: 'manager' });
      senhas.push(
        ...[dono, admin].filter((c) => c?.senha).map((c) => `${c!.email}  senha: ${c!.senha}`),
      );
      u = unidade;
      autorId = user!.id;
    }

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
          recordKind: 'odonto',
          bio: 'Formada pela UFPE, 12 anos de consultório. Tratamentos conservadores, explicados passo a passo.',
        },
        {
          tenantId,
          name: 'Dr. Rafael Moura',
          specialty: 'Ortodontia',
          council: 'CRO-PE 23.456',
          color: '#3563c9',
          position: 1,
          recordKind: 'odonto',
          bio: 'Aparelhos fixos e alinhadores. Atende crianças a partir de 7 anos.',
        },
        {
          tenantId,
          name: 'Dra. Camila Torres',
          specialty: 'Harmonização orofacial',
          council: 'CRO-PE 34.567',
          color: '#c2417a',
          position: 2,
          recordKind: 'estetica',
          bio: 'Toxina botulínica e preenchimento com planejamento facial completo.',
        },
      ])
      .returning();
    const [helena, rafael, camila] = pros as [(typeof pros)[0], (typeof pros)[0], (typeof pros)[0]];
    // Foto de cada profissional, se estiver em seed-media/aurora (helena.webp, rafael.webp, camila.webp).
    if (!INTO)
      for (const [p, arquivo] of [
        [helena, 'helena.webp'],
        [rafael, 'rafael.webp'],
        [camila, 'camila.webp'],
      ] as const) {
        const url = await foto(arquivo);
        if (url)
          await db.update(professionals).set({ photoUrl: url }).where(eq(professionals.id, p.id));
      }

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
        nomes.map(([name, phone, birthDate, allergies, medications], i) => ({
          tenantId,
          name,
          phone: fone(phone!, i),
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
    const ags = await db
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
      ])
      .returning();

    await db.insert(timeOff).values({
      tenantId,
      professionalId: camila.id,
      startsAt: em(d0, '12:00'),
      endsAt: em(d0, '13:00'),
      reason: 'Almoço com fornecedor',
    });
    // Prontuário de exemplo da primeira paciente.
    await db.insert(clinicalNotes).values([
      {
        tenantId,
        patientId: p(0),
        professionalId: helena.id,
        authorUserId: autorId,
        kind: 'odonto',
        data: {
          queixa: 'Sensibilidade ao frio no lado esquerdo',
          procedimentos: 'Profilaxia e aplicação de flúor',
          dentes: '26, 27',
          proximo: 'Restauração do 26',
        },
        lockedAt: new Date(),
        createdAt: em(dia(-20), '09:30'),
      },
      {
        tenantId,
        patientId: p(0),
        professionalId: helena.id,
        authorUserId: autorId,
        kind: 'odonto',
        data: {
          procedimentos: 'Restauração em resina, face oclusal',
          dentes: '26',
          materiais: 'Resina A2, lote 2231',
        },
        text: 'Paciente sem queixas após o procedimento.',
        createdAt: em(hoje, '08:40'),
      },
    ]);
    // Retorno: limpeza a cada 6 meses, manutenção do aparelho todo mês.
    await db.update(services).set({ returnDays: 180 }).where(eq(services.id, limpeza.id));
    await db.update(services).set({ returnDays: 30 }).where(eq(services.id, manutencao.id));
    await db
      .update(tenants)
      .set({ reactivationDays: 180, googleReviewUrl: 'https://g.page/r/clinica-aurora/review' })
      .where(eq(tenants.id, tenantId));

    await db.insert(toothChart).values([
      { tenantId, patientId: p(0), tooth: 26, state: 'restored', note: 'Oclusal, resina A2' },
      { tenantId, patientId: p(0), tooth: 27, state: 'caries', note: 'Mesial' },
      { tenantId, patientId: p(0), tooth: 18, state: 'missing' },
      { tenantId, patientId: p(0), tooth: 36, state: 'root_canal' },
      { tenantId, patientId: p(0), tooth: 46, state: 'crown' },
    ]);

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

    // Financeiro: um orçamento aprovado em 3x (1ª paga), um enviado, recebimentos de hoje e contas.
    const [aprovado, enviado] = await db
      .insert(treatmentPlans)
      .values([
        {
          tenantId,
          patientId: p(0),
          professionalId: helena.id,
          title: 'Restaurações e coroa',
          status: 'approved',
          maxInstallments: 3,
          chosenInstallments: 3,
          sentAt: em(dia(-20), '10:00'),
          decidedAt: em(dia(-19), '18:30'),
        },
        {
          tenantId,
          patientId: p(2),
          professionalId: helena.id,
          title: 'Clareamento a laser',
          status: 'sent',
          cashDiscountPct: 10,
          maxInstallments: 4,
          sentAt: em(dia(-2), '16:00'),
          validUntil: dia(13),
        },
      ])
      .returning();
    await db.insert(treatmentPlanItems).values([
      {
        tenantId,
        planId: aprovado!.id,
        description: 'Restauração em resina',
        tooth: 27,
        unitPriceCents: 28000,
        position: 0,
      },
      {
        tenantId,
        planId: aprovado!.id,
        description: 'Coroa em porcelana',
        tooth: 46,
        unitPriceCents: 190000,
        position: 1,
      },
      {
        tenantId,
        planId: enviado!.id,
        serviceId: clareamento.id,
        description: 'Clareamento a laser',
        unitPriceCents: 90000,
        position: 0,
      },
      {
        tenantId,
        planId: enviado!.id,
        description: 'Moldeira para manutenção',
        unitPriceCents: 18000,
        position: 1,
      },
    ]);
    await db.insert(charges).values([
      {
        tenantId,
        patientId: p(0),
        planId: aprovado!.id,
        description: 'Restaurações e coroa (1/3)',
        amountCents: 72667,
        dueDate: dia(-19),
        installment: 1,
        installments: 3,
        status: 'paid',
        method: 'pix',
        paidAt: em(dia(-19), '18:31'),
      },
      {
        tenantId,
        patientId: p(0),
        planId: aprovado!.id,
        description: 'Restaurações e coroa (2/3)',
        amountCents: 72667,
        dueDate: dia(-3),
        installment: 2,
        installments: 3,
      },
      {
        tenantId,
        patientId: p(0),
        planId: aprovado!.id,
        description: 'Restaurações e coroa (3/3)',
        amountCents: 72666,
        dueDate: dia(27),
        installment: 3,
        installments: 3,
      },
      {
        tenantId,
        patientId: p(0),
        description: 'Limpeza',
        amountCents: 18000,
        dueDate: d0,
        status: 'paid',
        method: 'pix',
        paidAt: em(d0, '08:50'),
      },
      {
        tenantId,
        patientId: p(1),
        description: 'Avaliação',
        amountCents: 12000,
        dueDate: d0,
        status: 'paid',
        method: 'debit',
        paidAt: em(d0, '09:40'),
      },
      { tenantId, patientId: p(3), description: 'Avaliação', amountCents: 12000, dueDate: d0 },
      {
        tenantId,
        patientId: p(5),
        description: 'Toxina botulínica',
        amountCents: 120000,
        dueDate: d0,
        status: 'paid',
        method: 'credit',
        paidAt: em(d0, '10:20'),
      },
    ]);
    await db.insert(expenses).values([
      {
        tenantId,
        description: 'Aluguel da sala',
        category: 'Aluguel',
        amountCents: 450000,
        dueDate: dia(5),
      },
      {
        tenantId,
        description: 'Resina composta A2 (kit)',
        category: 'Material',
        supplier: 'Dental Nordeste',
        amountCents: 38900,
        dueDate: dia(-4),
        status: 'paid',
        method: 'pix',
        paidAt: em(dia(-4), '11:00'),
      },
      {
        tenantId,
        description: 'Coroa — laboratório',
        category: 'Laboratório',
        supplier: 'Lab Sorriso',
        amountCents: 62000,
        dueDate: dia(8),
      },
    ]);

    // Estoque: dois fornecedores, materiais com lote e validade, ficha por procedimento.
    const [dental, estetica] = await db
      .insert(suppliers)
      .values([
        {
          tenantId,
          name: 'Dental Nordeste',
          contact: 'Rogério',
          whatsapp: '5581999990001',
          leadTimeDays: 2,
          notes: 'Pedido até 14h sai no mesmo dia',
        },
        {
          tenantId,
          name: 'Estética Distribuidora',
          contact: 'Paula',
          whatsapp: '5581999990002',
          leadTimeDays: 5,
        },
      ])
      .returning();
    const antigo = em(dia(-90), '09:00');
    const mats = await db
      .insert(stockItems)
      .values([
        {
          tenantId,
          name: 'Anestésico lidocaína 2%',
          category: 'Anestesia',
          unit: 'tubete',
          purchaseUnit: 'caixa',
          unitsPerPurchase: 50,
          costCents: 180,
          minQty: 20,
          supplierId: dental!.id,
          createdAt: antigo,
        },
        {
          tenantId,
          name: 'Luva nitrílica M',
          category: 'Descartáveis',
          unit: 'par',
          purchaseUnit: 'caixa',
          unitsPerPurchase: 50,
          costCents: 90,
          minQty: 40,
          supplierId: dental!.id,
          createdAt: antigo,
        },
        {
          tenantId,
          name: 'Gel clareador 35%',
          category: 'Clareamento',
          unit: 'seringa',
          purchaseUnit: 'caixa',
          unitsPerPurchase: 3,
          costCents: 6000,
          minQty: 2,
          supplierId: dental!.id,
          createdAt: antigo,
        },
        {
          tenantId,
          name: 'Pasta profilática',
          category: 'Profilaxia',
          unit: 'g',
          purchaseUnit: 'pacote',
          unitsPerPurchase: 90,
          costCents: 30,
          minQty: 60,
          supplierId: dental!.id,
          createdAt: antigo,
        },
        {
          tenantId,
          name: 'Toxina botulínica 100U',
          category: 'Harmonização',
          unit: 'U',
          purchaseUnit: 'frasco',
          unitsPerPurchase: 100,
          costCents: 900,
          minQty: 100,
          supplierId: estetica!.id,
          openValidityDays: 30,
          createdAt: antigo,
        },
        {
          tenantId,
          name: 'Fio de sutura 4-0',
          category: 'Cirurgia',
          unit: 'unidade',
          purchaseUnit: 'caixa',
          unitsPerPurchase: 24,
          costCents: 520,
          minQty: 0,
          supplierId: dental!.id,
          createdAt: antigo,
        },
      ])
      .returning();
    const [anest, luva, gel, pasta, tox, fio] = mats as [
      (typeof mats)[0],
      (typeof mats)[0],
      (typeof mats)[0],
      (typeof mats)[0],
      (typeof mats)[0],
      (typeof mats)[0],
    ];
    const lotes = await db
      .insert(stockLots)
      .values([
        {
          tenantId,
          itemId: anest.id,
          lot: 'LD2-4471',
          expiresOn: dia(220),
          qty: 34,
          costCents: 180,
        },
        {
          tenantId,
          itemId: luva.id,
          lot: 'NT-M-0921',
          expiresOn: dia(500),
          qty: 30,
          costCents: 90,
        },
        { tenantId, itemId: gel.id, lot: 'CL35-118', expiresOn: dia(150), qty: 0, costCents: 6000 },
        { tenantId, itemId: pasta.id, lot: 'PP-77', expiresOn: dia(300), qty: 410, costCents: 30 },
        { tenantId, itemId: tox.id, lot: 'BTX-5521', expiresOn: dia(24), qty: 160, costCents: 900 },
        { tenantId, itemId: fio.id, lot: 'SUT-40-3', expiresOn: dia(600), qty: 18, costCents: 520 },
      ])
      .returning();
    await db.insert(serviceMaterials).values([
      { tenantId, serviceId: limpeza.id, itemId: luva.id, qty: 2 },
      { tenantId, serviceId: limpeza.id, itemId: pasta.id, qty: 10 },
      { tenantId, serviceId: aval.id, itemId: luva.id, qty: 1 },
      { tenantId, serviceId: clareamento.id, itemId: gel.id, qty: 1 },
      { tenantId, serviceId: clareamento.id, itemId: luva.id, qty: 2 },
      { tenantId, serviceId: toxina.id, itemId: tox.id, qty: 50 },
      { tenantId, serviceId: toxina.id, itemId: luva.id, qty: 1 },
      { tenantId, serviceId: manutencao.id, itemId: luva.id, qty: 1 },
    ]);
    // Consumo dos últimos dias (para a previsão de término).
    const consumo: Array<[typeof anest, number, number]> = [
      [luva, 3, -6],
      [luva, 4, -4],
      [luva, 3, -9],
      [luva, 4, -13],
      [luva, 2, -17],
      [luva, 3, -22],
      [pasta, 20, -6],
      [pasta, 30, -13],
      [pasta, 20, -22],
      [anest, 2, -8],
      [anest, 3, -16],
      [tox, 50, -10],
    ];
    await db.insert(stockMoves).values(
      consumo.map(([it, q, d]) => ({
        tenantId,
        itemId: it.id,
        lotId: lotes.find((l) => l.itemId === it.id)!.id,
        kind: 'consume' as const,
        qty: -q,
        costCents: q * it.costCents,
        createdAt: em(dia(d), '10:00'),
      })),
    );
    await db.insert(supplierPrices).values([
      {
        tenantId,
        supplierId: dental!.id,
        itemId: anest.id,
        lastPriceCents: 9000,
        previousPriceCents: 8500,
      },
      {
        tenantId,
        supplierId: dental!.id,
        itemId: luva.id,
        lastPriceCents: 4500,
        previousPriceCents: 3800,
      },
      { tenantId, supplierId: dental!.id, itemId: gel.id, lastPriceCents: 18000 },
      { tenantId, supplierId: estetica!.id, itemId: tox.id, lastPriceCents: 90000 },
    ]);
    // Um horário vago que a lista de espera preencheu.
    await db.insert(waitlist).values({
      tenantId,
      patientId: p(8),
      serviceId: limpeza.id,
      fromDate: d0,
      toDate: dia(5),
      status: 'booked',
      bookedAppointmentId: ags[17]!.id,
    });

    // Convênio: clínica aceita dois planos; a primeira consulta do dia foi pelo plano.
    await db
      .update(tenants)
      .set({
        insuranceEnabled: true,
        legalName: 'Clínica Aurora Odontologia Ltda',
        document: '11222333000181',
      })
      .where(eq(tenants.id, tenantId));
    const [odontoMais, sorrisoPlus] = await db
      .insert(insurers)
      .values([
        {
          tenantId,
          name: 'OdontoMais',
          ansCode: '412345',
          providerCode: 'AUR001',
          paymentDays: 30,
        },
        {
          tenantId,
          name: 'Sorriso Plus',
          ansCode: '398765',
          providerCode: '7788',
          paymentDays: 45,
        },
      ])
      .returning();
    await db.insert(insurerPrices).values([
      {
        tenantId,
        insurerId: odontoMais!.id,
        serviceId: aval.id,
        priceCents: 6000,
        tussCode: '81000065',
      },
      {
        tenantId,
        insurerId: odontoMais!.id,
        serviceId: limpeza.id,
        priceCents: 9000,
        copayCents: 2000,
        tussCode: '84000198',
      },
      {
        tenantId,
        insurerId: sorrisoPlus!.id,
        serviceId: aval.id,
        priceCents: 5500,
        tussCode: '81000065',
      },
      {
        tenantId,
        insurerId: sorrisoPlus!.id,
        serviceId: manutencao.id,
        priceCents: 12000,
        tussCode: '87000059',
        needsAuthorization: true,
      },
    ]);
    await db.insert(patientInsurances).values([
      {
        tenantId,
        patientId: p(0),
        insurerId: odontoMais!.id,
        cardNumber: '0042 7781 5500 1',
        planName: 'Clássico',
        validUntil: dia(300),
      },
      {
        tenantId,
        patientId: p(7),
        insurerId: sorrisoPlus!.id,
        cardNumber: '998877665',
        planName: 'Ouro',
      },
    ]);
    const [guiaDemo] = await db
      .insert(insuranceAuthorizations)
      .values({
        tenantId,
        patientId: p(7),
        insurerId: sorrisoPlus!.id,
        serviceId: manutencao.id,
        guideNumber: '20261144',
        password: 'A7K2',
        sessions: 4,
        validUntil: dia(40),
      })
      .returning();
    await db
      .update(appointments)
      .set({ insurerId: odontoMais!.id, priceCents: 9000, copayCents: 2000 })
      .where(eq(appointments.id, ags[0]!.id));
    await db
      .update(appointments)
      .set({ insurerId: sorrisoPlus!.id, authorizationId: guiaDemo!.id, priceCents: 12000 })
      .where(eq(appointments.id, ags[7]!.id));
    console.log(
      INTO
        ? 'Pronto. Apague os pacientes de demonstração antes de ligar o WhatsApp.'
        : DONO
          ? `Clínica de demonstração pronta na conta ${DONO} · site /c/${SLUG}`
          : `Clínica de demonstração pronta. Entre com ${DEMO_EMAIL} / demo-tagtech-123 · site /c/${SLUG}`,
    );
    if (senhas.length) {
      console.log('\nContas criadas agora (guarde as senhas; elas não aparecem de novo):');
      for (const l of senhas) console.log(`  ${l}`);
    }
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
