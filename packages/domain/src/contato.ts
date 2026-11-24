/**
 * Telefone brasileiro como o WhatsApp entende: 55 + DDD + número, só dígitos.
 * Aceita "(81) 99999-8888", "81999998888" ou "+55 81 99999-8888". null se não der.
 */
export function normalizePhoneBR(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55[1-9][0-9][0-9]{8,9}$/.test(d) ? d : null;
}

/** "(81) 99999-8888" a partir de 5581999998888. */
export function formatPhoneBR(digits: string): string {
  const d = digits.startsWith('55') ? digits.slice(2) : digits;
  const ddd = d.slice(0, 2);
  const n = d.slice(2);
  return n.length === 9
    ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`
    : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
}

export const whatsappLink = (phone: string, text: string) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** CPF só com dígitos e dígitos verificadores corretos; null se inválido. */
export function normalizeCpf(input: string): string | null {
  const d = input.replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}
