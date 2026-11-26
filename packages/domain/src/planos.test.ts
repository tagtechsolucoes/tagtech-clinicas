import { describe, expect, it } from 'vitest';
import { planFor, subscriptionState } from './planos';

const hoje = '2026-12-10';

describe('situação da assinatura', () => {
  it('em dia, vencendo, atrasada na tolerância e bloqueada', () => {
    const ativa = (paidUntil: string) =>
      subscriptionState(
        { plan: 'profissional', status: 'active', trialEndsAt: null, paidUntil },
        hoje,
      );
    expect(ativa('2027-01-10')).toMatchObject({ situation: 'ok', blocked: false, daysLeft: 31 });
    expect(ativa('2026-12-13')).toMatchObject({ situation: 'due_soon', blocked: false });
    expect(ativa('2026-12-05')).toMatchObject({
      situation: 'overdue',
      blocked: false,
      daysLeft: -5,
    });
    expect(ativa('2026-12-02')).toMatchObject({ situation: 'blocked', blocked: true });
  });

  it('teste grátis, suspensa e sem assinatura', () => {
    expect(
      subscriptionState(
        { plan: 'clinica', status: 'trial', trialEndsAt: '2026-12-20', paidUntil: null },
        hoje,
      ),
    ).toMatchObject({ situation: 'trial', daysLeft: 10, blocked: false });
    expect(
      subscriptionState(
        { plan: 'clinica', status: 'suspended', trialEndsAt: null, paidUntil: '2027-01-01' },
        hoje,
      ),
    ).toMatchObject({ blocked: true });
    expect(subscriptionState(null, hoje).blocked).toBe(true);
  });

  it('recursos e limite por plano', () => {
    const e = subscriptionState(
      { plan: 'essencial', status: 'active', trialEndsAt: null, paidUntil: '2027-01-10' },
      hoje,
    );
    expect(e.features).toEqual([]);
    expect(e.maxProfessionals).toBe(1);
    expect(planFor('insurance')).toBe('clinica');
    expect(planFor('pix')).toBe('profissional');
  });
});
