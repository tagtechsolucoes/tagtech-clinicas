/** Contas do estoque: lote que vence primeiro, previsão de término, falta para a agenda e compra. */

export const STOCK_UNITS = [
  'unidade',
  'caixa',
  'seringa',
  'ml',
  'frasco',
  'tubete',
  'par',
  'g',
  'pacote',
] as const;

export const MOVE_LABELS = {
  purchase: 'Compra',
  consume: 'Consulta',
  return: 'Devolução',
  loss: 'Perda',
  expired: 'Vencido',
  manual: 'Uso fora de consulta',
  adjust: 'Ajuste de contagem',
} as const;
export type MoveKind = keyof typeof MOVE_LABELS;

/** Arredonda quantidades para 3 casas (o banco guarda numeric(12,3)). */
export const q3 = (n: number) => Math.round(n * 1000) / 1000;

export interface Lot {
  id: string;
  qty: number;
  expiresOn: string | null;
  createdAt: Date;
}

/**
 * Tira `need` dos lotes, primeiro o que vence antes (sem validade por último, depois o mais
 * antigo). Devolve o que sai de cada lote e quanto faltou.
 */
export function pickFefo(
  lots: Lot[],
  need: number,
): { take: Array<{ lotId: string; qty: number }>; missing: number } {
  const ordem = [...lots]
    .filter((l) => l.qty > 0)
    .sort((a, b) => {
      if (a.expiresOn !== b.expiresOn) {
        if (a.expiresOn === null) return 1;
        if (b.expiresOn === null) return -1;
        return a.expiresOn < b.expiresOn ? -1 : 1;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  let resto = q3(need);
  const take: Array<{ lotId: string; qty: number }> = [];
  for (const l of ordem) {
    if (resto <= 0) break;
    const t = q3(Math.min(l.qty, resto));
    take.push({ lotId: l.id, qty: t });
    resto = q3(resto - t);
  }
  return { take, missing: Math.max(0, resto) };
}

/**
 * Dias até acabar: usa o maior ritmo entre o que a agenda vai consumir e o consumo dos
 * últimos 30 dias. `null` quando nada consome.
 */
export function daysLeft(
  current: number,
  scheduledPerDay: number,
  pastPerDay: number,
): number | null {
  const ritmo = Math.max(scheduledPerDay, pastPerDay);
  if (ritmo <= 0) return null;
  return Math.max(0, Math.floor(current / ritmo));
}

export interface Need {
  appointmentId: string;
  startsAt: string;
  items: Array<{ itemId: string; qty: number }>;
}

/**
 * Percorre as consultas marcadas em ordem e devolve, para cada material, a primeira consulta
 * que vai ficar sem ele.
 */
export function firstShortages(
  stock: Map<string, number>,
  needs: Need[],
): Map<string, { appointmentId: string; startsAt: string; missing: number }> {
  const saldo = new Map(stock);
  const out = new Map<string, { appointmentId: string; startsAt: string; missing: number }>();
  for (const n of [...needs].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))) {
    for (const i of n.items) {
      const s = q3((saldo.get(i.itemId) ?? 0) - i.qty);
      saldo.set(i.itemId, s);
      if (s < 0 && !out.has(i.itemId)) {
        out.set(i.itemId, { appointmentId: n.appointmentId, startsAt: n.startsAt, missing: -s });
      }
    }
  }
  return out;
}

/**
 * Quanto comprar, em unidades de compra: cobre o consumo até a próxima entrega e deixa o
 * estoque mínimo de margem, descontando o que já tem e o que já foi pedido.
 */
export function suggestedPurchase(o: {
  current: number;
  onOrder: number;
  needUntilDelivery: number;
  minQty: number;
  unitsPerPurchase: number;
}): number {
  const falta = o.needUntilDelivery + o.minQty - o.current - o.onOrder;
  if (falta <= 0) return 0;
  return Math.ceil(q3(falta / o.unitsPerPurchase));
}

export type ShoppingReason = 'agenda' | 'minimum' | 'ending' | 'expiring';
export const SHOPPING_REASONS: Record<ShoppingReason, { label: string; priority: 1 | 2 | 3 }> = {
  agenda: { label: 'Falta para a agenda', priority: 1 },
  minimum: { label: 'Abaixo do mínimo', priority: 2 },
  ending: { label: 'Acabando', priority: 2 },
  expiring: { label: 'Vencendo', priority: 3 },
};
