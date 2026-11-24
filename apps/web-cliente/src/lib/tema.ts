import {
  DEFAULT_THEME,
  DISPLAY_FONTS,
  isHexColor,
  themeTokens,
  type BrandTheme,
} from '@tagtech/domain';
import type { CSSProperties } from 'react';

const FONTES: Record<BrandTheme['displayFont'], string> = {
  grotesca: "'Bricolage Grotesque Variable'",
  serifada: "'Fraunces Variable'",
  condensada: "'Oswald Variable'",
};

/** Confere o tema vindo da API; qualquer valor estranho cai no padrão. */
export function temaSeguro(theme: Partial<BrandTheme> | undefined): BrandTheme {
  return {
    primaryColor:
      theme?.primaryColor && isHexColor(theme.primaryColor)
        ? theme.primaryColor
        : DEFAULT_THEME.primaryColor,
    accentColor:
      theme?.accentColor && isHexColor(theme.accentColor)
        ? theme.accentColor
        : DEFAULT_THEME.accentColor,
    displayFont: DISPLAY_FONTS.includes(theme?.displayFont as never)
      ? theme!.displayFont!
      : DEFAULT_THEME.displayFont,
  };
}

/**
 * Variáveis CSS que vestem o site com a marca da clínica. As cores de texto
 * sobre a marca e sobre o destaque são calculadas pelo contraste, então qualquer
 * combinação escolhida pelo dono continua legível.
 */
export function estiloDoTema(theme: BrandTheme): { estilo: CSSProperties; fundo: string } {
  const t = themeTokens(theme);
  return {
    fundo: t.primaryDeep,
    estilo: {
      '--color-marca': t.primary,
      '--color-marca-fundo': t.primaryDeep,
      '--color-sobre-marca': t.onPrimary,
      '--color-destaque': t.accent,
      '--color-destaque-forte': t.accentStrong,
      '--color-sobre-destaque': t.onAccent,
      '--color-destaque-na-marca': t.accentOnPrimary,
      '--font-display': `${FONTES[theme.displayFont]}, ui-sans-serif, system-ui, sans-serif`,
    } as CSSProperties,
  };
}

/** Endereço de uma imagem guardada pela API ("/media/..."), passando pelo /api do Next. */
export const imagem = (url: string) => `/api${url}`;

/**
 * Ícone da aba do navegador com o logo da clínica (e o do atalho na tela inicial do celular).
 * Sem logo, fica o ícone padrão definido no layout.
 */
export function iconesDaCasa(logoUrl: string | null) {
  if (!logoUrl) return {};
  const url = imagem(logoUrl);
  const ext = logoUrl.split('.').pop()?.toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { icons: { icon: [{ url, type }], apple: [{ url }] } };
}
