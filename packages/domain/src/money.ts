/**
 * Dinheiro é sempre um inteiro em centavos. Nunca use ponto flutuante para valores:
 * 0.1 + 0.2 !== 0.3 em JavaScript, e isso vira erro de total, taxa e troco.
 */
export type Cents = number;

export function assertCents(value: number, field = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} precisa ser um inteiro em centavos, recebeu ${value}`);
  }
  return value;
}

/** 1990 -> "R$ 19,90" */
export function formatBRL(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais},${centavos}`;
}

/** Percentual em pontos-base (1000 = 10%), arredondando meio centavo para cima. */
export function percentOf(cents: Cents, basisPoints: number): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(`percentual inválido: ${basisPoints}`);
  }
  return Math.round((cents * basisPoints) / 10_000);
}

/**
 * Lê um valor digitado em reais e devolve centavos. Aceita "28", "28,9", "28,90",
 * "1.234,50", "R$ 28,90" e também ponto decimal ("28.90"). Valor inválido devolve null.
 */
export function parseBRL(text: string): Cents | null {
  const clean = text.replace(/R\$|\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const [reais, centavos = ''] = normalized.split('.');
  const cents = Number(reais) * 100 + Number(centavos.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 2890 -> "28,90", para preencher um campo de preço. */
export function centsToInput(cents: Cents): string {
  return formatBRL(cents).replace(/^-?R\$\s/, '');
}
