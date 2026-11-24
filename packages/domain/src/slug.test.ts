import { describe, expect, it } from 'vitest';
import { slugify } from './index';

describe('slugify', () => {
  it('tira acentos, símbolos e espaços', () => {
    expect(slugify('Burger do Zé & Cia.')).toBe('burger-do-ze-cia');
    expect(slugify('  Açaí   da   Praça  ')).toBe('acai-da-praca');
    expect(slugify('PIZZARIA 2000')).toBe('pizzaria-2000');
  });

  it('corta no tamanho máximo sem terminar em hífen', () => {
    expect(slugify('abc def ghi', 8)).toBe('abc-def');
  });

  it('devolve vazio quando não sobra nada', () => {
    expect(slugify('🍔🍟')).toBe('');
  });
});
