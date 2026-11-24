/**
 * "Burger do Zé & Cia." -> "burger-do-ze-cia". Usado no endereço do restaurante.
 * Devolve string vazia se não sobrar nenhuma letra ou número.
 */
export function slugify(text: string, maxLength = 48): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}
