/**
 * Planos do TagClin e a situação da assinatura. Os valores ficam no painel da TagTech (cada
 * cliente pode ter um preço combinado); aqui só o que cada plano libera.
 */
export const PLANS = ['essencial', 'profissional', 'clinica'] as const;
export type Plan = (typeof PLANS)[number];

/** Recursos que nem todo plano tem. O resto (agenda, pacientes, site, WhatsApp...) é de todos. */
export const FEATURES = [
  'relationship',
  'pix',
  'nfse',
  'packages',
  'tv',
  'insurance',
  'reports',
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  relationship: 'Vaga oferecida sozinha à lista de espera, retorno, reativação e avaliações',
  pix: 'Pix com confirmação automática e sinal no agendamento',
  nfse: 'Nota fiscal de serviço (NFS-e)',
  packages: 'Pacotes de sessões',
  tv: 'TV da sala de espera',
  insurance: 'Convênios, guias e lote TISS',
  reports: 'Relatórios por profissional e comissões',
};

export interface PlanInfo {
  name: string;
  pitch: string;
  /** Preço de tabela por mês, em centavos. */
  priceCents: number;
  /** null = sem limite. */
  maxProfessionals: number | null;
  features: readonly Feature[];
}

export const PLAN_INFO: Record<Plan, PlanInfo> = {
  essencial: {
    name: 'Essencial',
    priceCents: 11500,
    pitch: 'Para quem atende sozinho: agenda, site, confirmação no WhatsApp e prontuário.',
    maxProfessionals: 1,
    features: [],
  },
  profissional: {
    name: 'Profissional',
    priceCents: 24000,
    pitch: 'Para encher a agenda: lista de espera automática, retorno, Pix e nota fiscal.',
    maxProfessionals: 5,
    features: ['relationship', 'pix', 'nfse', 'packages', 'tv'],
  },
  clinica: {
    name: 'Clínica',
    priceCents: 34900,
    pitch: 'Para equipes e convênios: tudo do Profissional, TISS, comissões e relatórios.',
    maxProfessionals: null,
    features: ['relationship', 'pix', 'nfse', 'packages', 'tv', 'insurance', 'reports'],
  },
};

/** Mensalidade de um cliente: o valor combinado com ele ou, sem acordo, o preço de tabela. */
export const monthlyPrice = (plan: Plan, priceCents: number): number =>
  priceCents > 0 ? priceCents : PLAN_INFO[plan].priceCents;

/** O plano mais barato que tem o recurso. */
export const planFor = (f: Feature): Plan => PLANS.find((p) => PLAN_INFO[p].features.includes(f))!;

export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

export interface SubscriptionRow {
  plan: Plan;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  paidUntil: string | null;
}

/** Dias de tolerância depois do vencimento antes de bloquear. */
export const GRACE_DAYS = 7;

export type Situation =
  | 'trial' // em teste
  | 'ok' // em dia
  | 'due_soon' // vence em até 5 dias
  | 'overdue' // venceu, ainda na tolerância
  | 'blocked'; // passou da tolerância, suspensa ou cancelada

export interface SubscriptionState {
  plan: Plan;
  situation: Situation;
  /** Até quando vale (fim do teste ou "pago até"). */
  until: string | null;
  /** Dias até `until` (negativo = atrasado). */
  daysLeft: number | null;
  /** Bloqueada: o painel só lê e o site não agenda. */
  blocked: boolean;
  features: Feature[];
  maxProfessionals: number | null;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/** Situação da assinatura em `hoje` (YYYY-MM-DD, no fuso da clínica). Sem assinatura = bloqueada. */
export function subscriptionState(s: SubscriptionRow | null, hoje: string): SubscriptionState {
  const plan: Plan = s && PLANS.includes(s.plan) ? s.plan : 'essencial';
  const info = PLAN_INFO[plan];
  const base = { plan, features: [...info.features], maxProfessionals: info.maxProfessionals };
  if (!s || s.status === 'suspended' || s.status === 'cancelled')
    return {
      ...base,
      situation: 'blocked',
      until: s?.paidUntil ?? null,
      daysLeft: null,
      blocked: true,
    };
  const until = s.status === 'trial' ? s.trialEndsAt : s.paidUntil;
  if (!until)
    return {
      ...base,
      situation: s.status === 'trial' ? 'trial' : 'ok',
      until,
      daysLeft: null,
      blocked: false,
    };
  const daysLeft = diasEntre(hoje, until);
  const situation: Situation =
    daysLeft < -GRACE_DAYS
      ? 'blocked'
      : daysLeft < 0
        ? 'overdue'
        : s.status === 'trial'
          ? 'trial'
          : daysLeft <= 5
            ? 'due_soon'
            : 'ok';
  return { ...base, situation, until, daysLeft, blocked: situation === 'blocked' };
}
