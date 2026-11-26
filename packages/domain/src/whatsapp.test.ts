import { describe, expect, it } from 'vitest';
import { canonicalPhone, fillTemplate, messagePreview } from './whatsapp';

describe('canonicalPhone', () => {
  it('põe o nono dígito no celular que o WhatsApp guardou sem ele', () => {
    expect(canonicalPhone('558199998888')).toBe('5581999998888');
    expect(canonicalPhone('5581999998888')).toBe('5581999998888');
  });
  it('aceita o número como a pessoa digita', () => {
    expect(canonicalPhone('(81) 99999-8888')).toBe('5581999998888');
  });
  it('não mexe em fixo nem em número de fora', () => {
    expect(canonicalPhone('558133334444')).toBe('558133334444');
    expect(canonicalPhone('447911123456')).toBe('447911123456');
  });
  it('recusa o que não é telefone', () => {
    expect(canonicalPhone('abc')).toBeNull();
    expect(canonicalPhone('123')).toBeNull();
  });
});

describe('fillTemplate', () => {
  it('troca os marcadores na ordem', () => {
    expect(fillTemplate('Olá, {{1}}! Pedido {{2}}.', ['Ana', '#12'])).toBe('Olá, Ana! Pedido #12.');
  });
});

describe('messagePreview', () => {
  it('junta as linhas e corta textos longos', () => {
    expect(messagePreview('oi\n\ntudo bem?')).toBe('oi tudo bem?');
    expect(messagePreview('a'.repeat(10), 5)).toBe('aaaa…');
  });
});
