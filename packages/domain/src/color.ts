/** Cores da marca do restaurante: validação e contraste, para o tema nunca ficar ilegível. */

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channels(hex: string): [number, number, number] {
  if (!isHexColor(hex)) throw new RangeError(`cor inválida: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Luminância relativa (WCAG 2), de 0 (preto) a 1 (branco). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores, de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const INK = '#14231c';
export const PAPER = '#ffffff';

/**
 * Cor de texto que mais contrasta com o fundo: a tinta escura da interface ou branco.
 * Em tons médios nenhuma das duas chega a 4,5:1; aí vale preto puro, que sempre chega
 * (entre preto e branco, o melhor nunca fica abaixo de 4,58:1).
 */
export function readableOn(background: string): string {
  const best = contrastRatio(INK, background) >= contrastRatio(PAPER, background) ? INK : PAPER;
  return contrastRatio(best, background) >= 4.5 ? best : '#000000';
}

/** Mistura a cor com preto. amount 0 = igual, 1 = preto. */
export function darken(hex: string, amount: number): string {
  return toHex(channels(hex).map((c) => c * (1 - amount)));
}

export const DISPLAY_FONTS = ['grotesca', 'serifada', 'condensada'] as const;
export type DisplayFont = (typeof DISPLAY_FONTS)[number];

export interface BrandTheme {
  primaryColor: string;
  accentColor: string;
  displayFont: DisplayFont;
}

export const DEFAULT_THEME: BrandTheme = {
  primaryColor: '#1d4e5f',
  accentColor: '#e9a23b',
  displayFont: 'grotesca',
};

const PAPER_SURFACE = '#f4f6f1';

/** Tudo que a interface precisa para vestir a marca: as duas cores e o que deriva delas. */
export function themeTokens(theme: BrandTheme) {
  const { primaryColor: primary, accentColor } = theme;
  // Botões de destaque ficam sobre o papel claro. Um destaque quase branco sumiria ali;
  // nesse caso os botões usam a cor principal.
  const accent = contrastRatio(accentColor, PAPER_SURFACE) >= 1.3 ? accentColor : primary;
  return {
    primary,
    primaryDeep: darken(primary, 0.28),
    onPrimary: readableOn(primary),
    accent,
    accentStrong: darken(accent, 0.1),
    onAccent: readableOn(accent),
    // O destaque também aparece sobre a cor principal (o selo do horário escolhido). Se as duas
    // forem parecidas demais, usa a cor de texto no lugar para não sumir.
    accentOnPrimary: contrastRatio(accentColor, primary) >= 3 ? accentColor : readableOn(primary),
  };
}
