/** Contas do orçamento e das parcelas. Tudo em centavos. */

export const PAY_METHODS = ['pix', 'cash', 'debit', 'credit', 'transfer', 'other'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
  transfer: 'Transferência',
  other: 'Outro',
};

export const PLAN_STATUS_LABELS = {
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  declined: 'Recusado',
  cancelled: 'Cancelado',
} as const;

export interface PlanLine {
  quantity: number;
  unitPriceCents: number;
}

/** Divide um valor em n parcelas; os centavos que sobram vão nas primeiras. */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const resto = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

export function planTotals(lines: PlanLine[], discountCents: number, cashDiscountPct: number) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  const total = Math.max(0, subtotal - discountCents);
  const cashTotal = Math.round(total * (1 - cashDiscountPct / 100));
  return { subtotal, total, cashTotal };
}

/** Datas de vencimento mensais a partir de uma data (mantém o dia; fim de mês ajusta). */
export function monthlyDueDates(firstYmd: string, n: number): string[] {
  const [y, m, d] = firstYmd.split('-').map(Number) as [number, number, number];
  return Array.from({ length: n }, (_, i) => {
    const alvo = new Date(Date.UTC(y, m - 1 + i, 1));
    const ultimo = new Date(
      Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
    ).getUTCDate();
    alvo.setUTCDate(Math.min(d, ultimo));
    return alvo.toISOString().slice(0, 10);
  });
}
