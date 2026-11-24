import { describe, expect, it } from 'vitest';
import { contrastRatio, darken, DEFAULT_THEME, isHexColor, readableOn, themeTokens } from './index';

describe('cores da marca', () => {
  it('valida hexadecimal de 6 dígitos em minúsculas', () => {
    expect(isHexColor('#1f4b3a')).toBe(true);
    for (const bad of ['#1F4B3A', '#fff', 'red', '1f4b3a', '#1f4b3g', 'url(x)', '#1f4b3a;']) {
      expect(isHexColor(bad)).toBe(false);
    }
  });

  it('contraste: preto e branco dão 21, cor com ela mesma dá 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7a1f1f', '#7a1f1f')).toBeCloseTo(1, 5);
  });

  it('escolhe texto claro em fundo escuro e escuro em fundo claro', () => {
    expect(readableOn('#1f4b3a')).toBe('#ffffff');
    expect(readableOn('#0b2545')).toBe('#ffffff');
    expect(readableOn('#f2b01e')).toBe('#14231c');
    expect(readableOn('#ffffff')).toBe('#14231c');
  });

  it('o texto escolhido é sempre legível (contraste >= 4.5), para qualquer cor', () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const color = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          expect(contrastRatio(readableOn(color), color)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('escurece em direção ao preto', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#1f4b3a', 0)).toBe('#1f4b3a');
    expect(darken('#1f4b3a', 1)).toBe('#000000');
  });

  it('se destaque e principal forem parecidos, o destaque sobre a marca usa a cor de texto', () => {
    expect(themeTokens(DEFAULT_THEME).accentOnPrimary).toBe('#e9a23b');
    const samey = themeTokens({
      primaryColor: '#1f4b3a',
      accentColor: '#24503f',
      displayFont: 'grotesca',
    });
    expect(samey.accentOnPrimary).toBe('#ffffff');
  });

  it('destaque claro demais para o papel: os botões usam a cor principal', () => {
    const pale = themeTokens({
      primaryColor: '#7a1f1f',
      accentColor: '#ffffff',
      displayFont: 'grotesca',
    });
    expect(pale.accent).toBe('#7a1f1f');
    expect(pale.onAccent).toBe('#ffffff');
    expect(pale.accentOnPrimary).toBe('#ffffff'); // sobre a cor principal o branco funciona
    // um dourado comum continua valendo como destaque
    const gold = themeTokens({
      primaryColor: '#7a1f1f',
      accentColor: '#f5c542',
      displayFont: 'grotesca',
    });
    expect(gold.accent).toBe('#f5c542');
    expect(gold.onAccent).toBe('#14231c');
  });
});
