import type { StockItem } from '../api';
import { dataCurta } from '../formato';

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const PLURAL: Record<string, string> = {
  unidade: 'unidades',
  caixa: 'caixas',
  seringa: 'seringas',
  frasco: 'frascos',
  tubete: 'tubetes',
  par: 'pares',
  pacote: 'pacotes',
  ampola: 'ampolas',
  rolo: 'rolos',
};
/** Quantidade com a unidade: "12 unidades", "0,5 ml". */
export const qtd = (n: number, unidade?: string) => {
  const t = nf.format(n);
  if (!unidade) return t;
  return `${t} ${n !== 1 ? (PLURAL[unidade] ?? unidade) : unidade}`;
};

export type Situacao = { texto: string; tom: 'alerta' | 'ambar' | 'azul' | 'neutro' | 'ok' };

/** O que mais importa sobre o material agora, em uma frase. */
export function situacao(it: StockItem): Situacao {
  if (it.shortage)
    return {
      texto: `Falta para a consulta de ${dataCurta(it.shortage.startsAt.slice(0, 10))}`,
      tom: 'alerta',
    };
  if (it.expiring.some((l) => l.expired))
    return { texto: 'Lote vencido no estoque', tom: 'alerta' };
  if (it.minQty > 0 && it.qty <= it.minQty) return { texto: 'Abaixo do mínimo', tom: 'ambar' };
  if (it.daysLeft !== null && it.daysLeft <= 15)
    return {
      texto: it.daysLeft <= 1 ? 'Acaba amanhã' : `Acaba em ~${it.daysLeft} dias`,
      tom: 'ambar',
    };
  if (it.expiring.length)
    return { texto: `Vence ${dataCurta(it.expiring[0]!.expiresOn)}`, tom: 'azul' };
  if (it.idle) return { texto: 'Parado há 30+ dias', tom: 'neutro' };
  if (it.daysLeft !== null) return { texto: `Dá para ~${it.daysLeft} dias`, tom: 'ok' };
  return { texto: 'Sem consumo previsto', tom: 'neutro' };
}

export const TOM: Record<Situacao['tom'], string> = {
  alerta: 'bg-alerta-fundo text-alerta',
  ambar: 'bg-ambar-fundo text-ambar-tinta',
  azul: 'bg-azul-fundo text-azul',
  neutro: 'bg-trilho text-nevoa',
  ok: 'bg-ok-fundo text-ok',
};
