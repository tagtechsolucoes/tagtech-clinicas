import { describe, expect, it } from 'vitest';
import {
  addDays,
  canTransition,
  canManage,
  freeSlots,
  fromMinutes,
  localClock,
  normalizeCpf,
  normalizePhoneBR,
  rolesManagedBy,
  weekdayOf,
  zonedToUtc,
} from './index';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe('horários livres', () => {
  const manha = { start: h('08:00'), end: h('12:00') };

  it('oferece a grade do turno quando nada está ocupado', () => {
    const slots = freeSlots({ windows: [manha], busy: [], duration: 60, step: 30 });
    expect(slots.map(fromMinutes)).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('pula o que bate numa consulta, mas aceita encostar nela', () => {
    const slots = freeSlots({
      windows: [manha],
      busy: [{ start: h('09:00'), end: h('10:00') }],
      duration: 30,
      step: 30,
    });
    expect(slots.map(fromMinutes)).toEqual(['08:00', '08:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('o serviço tem de caber inteiro no turno e respeita a antecedência', () => {
    const slots = freeSlots({
      windows: [manha, { start: h('14:00'), end: h('15:00') }],
      busy: [],
      duration: 90,
      step: 30,
      notBefore: h('10:15'),
    });
    expect(slots.map(fromMinutes)).toEqual(['10:30']);
  });
});

describe('estados da consulta', () => {
  it('segue o fluxo e não volta de cancelado', () => {
    expect(canTransition('scheduled', 'confirmed')).toBe(true);
    expect(canTransition('arrived', 'done')).toBe(true);
    expect(canTransition('done', 'in_progress')).toBe(true);
    expect(canTransition('cancelled', 'scheduled')).toBe(false);
    expect(canTransition('scheduled', 'done')).toBe(false);
  });
});

describe('fuso da clínica', () => {
  it('converte hora local de Recife para UTC e volta', () => {
    const t = zonedToUtc('2026-11-24', h('09:30'), 'America/Recife');
    expect(t.toISOString()).toBe('2026-11-24T12:30:00.000Z');
    expect(localClock(t, 'America/Recife')).toEqual({
      ymd: '2026-11-24',
      minute: h('09:30'),
      day: 2,
    });
  });
  it('acerta fuso com horário de verão', () => {
    expect(zonedToUtc('2026-07-01', h('09:00'), 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(zonedToUtc('2026-12-01', h('09:00'), 'America/New_York').toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });
  it('dias', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-11-24')).toBe(2);
  });
});

describe('cadastro', () => {
  it('telefone e CPF', () => {
    expect(normalizePhoneBR('(81) 99999-8888')).toBe('5581999998888');
    expect(normalizePhoneBR('9999-8888')).toBeNull();
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf('111.111.111-11')).toBeNull();
    expect(normalizeCpf('529.982.247-24')).toBeNull();
  });
  it('equipe: dono cuida de todos menos donos', () => {
    expect(rolesManagedBy('owner')).toEqual(['manager', 'reception', 'professional']);
    expect(canManage('manager', 'manager')).toBe(false);
    expect(canManage('manager', 'reception')).toBe(true);
    expect(canManage('reception', 'professional')).toBe(false);
  });
});

describe('mensagens', async () => {
  const { whenText, messageSentence } = await import('./mensagens');
  const now = new Date('2026-11-24T15:00:00Z'); // terça, 12:00 em Recife
  it('diz hoje, amanhã ou o dia da semana', () => {
    expect(whenText(new Date('2026-11-24T19:30:00Z'), 'America/Recife', now)).toBe(
      'hoje, às 16:30',
    );
    expect(whenText(new Date('2026-11-25T12:00:00Z'), 'America/Recife', now)).toBe(
      'amanhã, às 09:00',
    );
    expect(whenText(new Date('2026-11-27T12:00:00Z'), 'America/Recife', now)).toBe(
      'sexta, 27/11, às 09:00',
    );
    expect(messageSentence('reminder', 'amanhã, às 09:00')).toBe(
      'é amanhã, às 09:00. Podemos contar com você?',
    );
  });
});
