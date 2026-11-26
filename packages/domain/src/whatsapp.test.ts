import { describe, expect, it } from 'vitest';
import { canonicalPhone, fillTemplate, messagePreview } from './whatsapp';
import { parseReply } from './mensagens';

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

describe('resposta ao lembrete', () => {
  it('1, sim e confirmo confirmam; 2 e remarcar pedem outro horário', () => {
    for (const t of ['1', ' 1 ', '*1*', 'Sim', 'sim!', 'Confirmo 👍', 'confirmado.', '1 - sim'])
      expect(parseReply(t), t).toBe('confirm');
    for (const t of ['2', '2.', 'Remarcar', 'preciso remarcar', 'Desmarcar'])
      expect(parseReply(t), t).toBe('reschedule');
  });
  it('qualquer outra coisa é conversa', () => {
    for (const t of ['12', 'Posso ir mais cedo?', 'sim, mas chego 10 min atrasada', 'oi', ''])
      expect(parseReply(t), t).toBeNull();
  });
});
