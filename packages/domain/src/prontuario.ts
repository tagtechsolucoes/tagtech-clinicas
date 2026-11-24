/** Modelos de prontuário por especialidade e o odontograma. */

export const RECORD_KINDS = [
  'geral',
  'odonto',
  'estetica',
  'fisio',
  'psico',
  'nutri',
  'medicina',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'scale';
  unit?: string;
  /** Para "scale": de 0 a max. */
  max?: number;
  placeholder?: string;
}

export interface RecordTemplate {
  label: string;
  fields: RecordField[];
  /** Evolução nasce sigilosa (só quem escreveu lê). */
  privateByDefault: boolean;
}

export const RECORD_TEMPLATES: Record<RecordKind, RecordTemplate> = {
  geral: {
    label: 'Geral',
    privateByDefault: false,
    fields: [
      { key: 'queixa', label: 'Queixa', type: 'textarea' },
      { key: 'conduta', label: 'Conduta', type: 'textarea' },
    ],
  },
  odonto: {
    label: 'Odontologia',
    privateByDefault: false,
    fields: [
      { key: 'queixa', label: 'Queixa', type: 'textarea' },
      { key: 'procedimentos', label: 'Procedimentos realizados', type: 'textarea' },
      { key: 'dentes', label: 'Dentes', type: 'text', placeholder: 'Ex.: 16, 26' },
      { key: 'materiais', label: 'Materiais e lotes', type: 'text' },
      { key: 'proximo', label: 'Próxima sessão', type: 'text' },
    ],
  },
  estetica: {
    label: 'Estética',
    privateByDefault: false,
    fields: [
      { key: 'area', label: 'Área tratada', type: 'text' },
      { key: 'produto', label: 'Produto e lote', type: 'text' },
      { key: 'quantidade', label: 'Quantidade', type: 'text', placeholder: 'Ex.: 20 U, 1 ml' },
      { key: 'tecnica', label: 'Técnica', type: 'textarea' },
      { key: 'orientacoes', label: 'Orientações ao paciente', type: 'textarea' },
    ],
  },
  fisio: {
    label: 'Fisioterapia',
    privateByDefault: false,
    fields: [
      { key: 'dor', label: 'Dor', type: 'scale', max: 10 },
      { key: 'avaliacao', label: 'Avaliação', type: 'textarea' },
      { key: 'conduta', label: 'Exercícios e conduta', type: 'textarea' },
      { key: 'evolucao', label: 'Evolução', type: 'textarea' },
    ],
  },
  psico: {
    label: 'Psicologia',
    privateByDefault: true,
    fields: [{ key: 'registro', label: 'Registro da sessão', type: 'textarea' }],
  },
  nutri: {
    label: 'Nutrição',
    privateByDefault: false,
    fields: [
      { key: 'peso', label: 'Peso', type: 'number', unit: 'kg' },
      { key: 'altura', label: 'Altura', type: 'number', unit: 'cm' },
      { key: 'cintura', label: 'Circunferência da cintura', type: 'number', unit: 'cm' },
      { key: 'conduta', label: 'Conduta e plano', type: 'textarea' },
    ],
  },
  medicina: {
    label: 'Medicina',
    privateByDefault: false,
    fields: [
      { key: 'queixa', label: 'Queixa principal', type: 'textarea' },
      { key: 'historia', label: 'História', type: 'textarea' },
      { key: 'exame', label: 'Exame físico', type: 'textarea' },
      { key: 'hipotese', label: 'Hipótese diagnóstica (CID)', type: 'text' },
      { key: 'conduta', label: 'Conduta', type: 'textarea' },
    ],
  },
};

/**
 * Confere os campos de uma evolução contra o modelo. Devolve só as chaves conhecidas,
 * com texto aparado e número válido, ou a mensagem de erro.
 */
export function cleanRecordData(
  kind: RecordKind,
  data: Record<string, unknown>,
): { ok: true; data: Record<string, string | number> } | { ok: false; error: string } {
  const out: Record<string, string | number> = {};
  for (const f of RECORD_TEMPLATES[kind].fields) {
    const v = data[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number' || f.type === 'scale') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > (f.type === 'scale' ? (f.max ?? 10) : 100_000)) {
        return { ok: false, error: `${f.label}: valor inválido` };
      }
      out[f.key] = Math.round(n * 100) / 100;
    } else {
      const t = String(v).trim();
      if (t.length > (f.type === 'textarea' ? 4000 : 300))
        return { ok: false, error: `${f.label}: texto longo demais` };
      if (t) out[f.key] = t;
    }
  }
  return { ok: true, data: out };
}

/** IMC a partir de peso (kg) e altura (cm). */
export const bmi = (kg: number, cm: number) => Math.round((kg / (cm / 100) ** 2) * 10) / 10;

// ---------------------------------------------------------------- odontograma

export const TOOTH_STATES = [
  'healthy',
  'caries',
  'restored',
  'root_canal',
  'crown',
  'implant',
  'prosthesis',
  'extraction',
  'missing',
] as const;
export type ToothState = (typeof TOOTH_STATES)[number];

export const TOOTH_STATE_LABELS: Record<ToothState, string> = {
  healthy: 'Hígido',
  caries: 'Cárie',
  restored: 'Restaurado',
  root_canal: 'Canal',
  crown: 'Coroa',
  implant: 'Implante',
  prosthesis: 'Prótese',
  extraction: 'Extração indicada',
  missing: 'Ausente',
};

/** Arcadas na ordem em que o dentista olha o paciente (FDI). */
export const PERMANENT_TEETH = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};
export const PRIMARY_TEETH = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};

export const isTooth = (n: number) =>
  (n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8 && Math.floor(n / 10) <= 4) ||
  (n >= 51 && n <= 85 && n % 10 >= 1 && n % 10 <= 5);

/** Texto padrão da autorização de uso de imagem (a clínica pode ajustar ao registrar). */
export const IMAGE_CONSENT_TERM =
  'Autorizo a clínica a usar fotografias do meu tratamento, sem identificação do meu nome, para divulgação dos resultados nos canais indicados. Posso revogar esta autorização a qualquer momento, e as imagens deixam de ser publicadas.';
