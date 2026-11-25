/**
 * Conteúdo do site da clínica que o dono preenche no painel. Fica num campo JSON;
 * a API confere o formato ao gravar e `siteContent` lê com tolerância (campo
 * faltando ou estranho vira vazio), então o site nunca quebra por um dado antigo.
 */
export interface SiteContent {
  /** Até 3 números de destaque: "12 anos" / "de consultório". */
  stats: Array<{ value: string; label: string }>;
  /** Até 4 diferenciais curtos: título e uma frase. */
  highlights: Array<{ title: string; text: string }>;
  faq: Array<{ question: string; answer: string }>;
  testimonials: Array<{ name: string; text: string; service: string }>;
  /** Nota pública (do Google, por exemplo). */
  rating: { value: number; count: number } | null;
  payments: {
    pix: boolean;
    credit: boolean;
    debit: boolean;
    cash: boolean;
    pixDiscountPct: number;
    installments: number;
    note: string;
  };
  hours: Array<{ days: string; hours: string }>;
  /** Como chegar: estacionamento, metrô, acessibilidade. */
  arrival: string[];
}

export const SITE_LIMITS = {
  stats: 3,
  highlights: 4,
  faq: 12,
  testimonials: 9,
  hours: 7,
  arrival: 4,
} as const;

export const EMPTY_SITE: SiteContent = {
  stats: [],
  highlights: [],
  faq: [],
  testimonials: [],
  rating: null,
  payments: {
    pix: false,
    credit: false,
    debit: false,
    cash: false,
    pixDiscountPct: 0,
    installments: 1,
    note: '',
  },
  hours: [],
  arrival: [],
};

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lista = <T>(v: unknown, max: number, ler: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(ler)
        .filter((x): x is T => x !== null)
        .slice(0, max)
    : [];
const numero = (v: unknown, min: number, max: number, padrao: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;

export function siteContent(raw: unknown): SiteContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = (r.payments && typeof r.payments === 'object' ? r.payments : {}) as Record<
    string,
    unknown
  >;
  const nota = r.rating as Record<string, unknown> | null | undefined;
  return {
    stats: lista(r.stats, SITE_LIMITS.stats, (x) => {
      const value = texto(x.value, 12);
      return value ? { value, label: texto(x.label, 40) } : null;
    }),
    highlights: lista(r.highlights, SITE_LIMITS.highlights, (x) => {
      const title = texto(x.title, 40);
      return title ? { title, text: texto(x.text, 140) } : null;
    }),
    faq: lista(r.faq, SITE_LIMITS.faq, (x) => {
      const question = texto(x.question, 160);
      const answer = texto(x.answer, 600);
      return question && answer ? { question, answer } : null;
    }),
    testimonials: lista(r.testimonials, SITE_LIMITS.testimonials, (x) => {
      const name = texto(x.name, 60);
      const text = texto(x.text, 400);
      return name && text ? { name, text, service: texto(x.service, 60) } : null;
    }),
    rating:
      nota && typeof nota === 'object' && typeof nota.value === 'number' && nota.value >= 1
        ? {
            value: Math.round(numero(nota.value, 1, 5, 5) * 10) / 10,
            count: Math.round(numero(nota.count, 0, 1_000_000, 0)),
          }
        : null,
    payments: {
      pix: p.pix === true,
      credit: p.credit === true,
      debit: p.debit === true,
      cash: p.cash === true,
      pixDiscountPct: Math.round(numero(p.pixDiscountPct, 0, 30, 0)),
      installments: Math.round(numero(p.installments, 1, 24, 1)),
      note: texto(p.note, 200),
    },
    hours: lista(r.hours, SITE_LIMITS.hours, (x) => {
      const days = texto(x.days, 30);
      return days ? { days, hours: texto(x.hours, 40) } : null;
    }),
    arrival: Array.isArray(r.arrival)
      ? r.arrival
          .map((x) => texto(x, 80))
          .filter(Boolean)
          .slice(0, SITE_LIMITS.arrival)
      : [],
  };
}
