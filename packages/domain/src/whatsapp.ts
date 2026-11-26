/**
 * WhatsApp: números e textos. O WhatsApp guarda muitos celulares brasileiros sem o nono
 * dígito (558199998888); aqui todo número vira uma forma só, para a conversa de quem
 * respondeu ser a mesma do aviso que enviamos.
 */

/** Só dígitos, com DDI; celular brasileiro sempre com o 9. null se não parece telefone. */
export function canonicalPhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  // 55 + DDD + 8 dígitos começando em 6-9: celular sem o nono dígito.
  if (/^55[1-9][0-9][6-9][0-9]{7}$/.test(d)) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return /^[0-9]{10,15}$/.test(d) ? d : null;
}

/** Preenche {{1}}, {{2}}… de um modelo de mensagem. */
export function fillTemplate(template: string, params: readonly string[]): string {
  return template.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');
}

/** Primeira linha curta de uma mensagem, para a lista de conversas. */
export function messagePreview(body: string, max = 120): string {
  const linha = body.replace(/\s+/g, ' ').trim();
  return linha.length > max ? `${linha.slice(0, max - 1)}…` : linha;
}
