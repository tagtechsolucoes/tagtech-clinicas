import { describe, expect, it } from 'vitest';
import { daysLeft, firstShortages, pickFefo, suggestedPurchase } from './estoque';

const d = new Date('2026-01-01');
describe('estoque', () => {
  it('tira primeiro o lote que vence antes; sem validade por último', () => {
    const r = pickFefo(
      [
        { id: 'sem', qty: 10, expiresOn: null, createdAt: d },
        { id: 'tarde', qty: 2, expiresOn: '2027-05-01', createdAt: d },
        { id: 'cedo', qty: 1.5, expiresOn: '2026-12-01', createdAt: d },
      ],
      4,
    );
    expect(r).toEqual({
      take: [
        { lotId: 'cedo', qty: 1.5 },
        { lotId: 'tarde', qty: 2 },
        { lotId: 'sem', qty: 0.5 },
      ],
      missing: 0,
    });
    expect(pickFefo([{ id: 'a', qty: 1, expiresOn: null, createdAt: d }], 3).missing).toBe(2);
  });

  it('previsão usa o maior ritmo', () => {
    expect(daysLeft(10, 1, 0.5)).toBe(10);
    expect(daysLeft(10, 0.2, 2)).toBe(5);
    expect(daysLeft(10, 0, 0)).toBeNull();
  });

  it('acha a primeira consulta que fica sem material', () => {
    const f = firstShortages(new Map([['impl', 1]]), [
      { appointmentId: 'b', startsAt: '2026-01-03', items: [{ itemId: 'impl', qty: 1 }] },
      { appointmentId: 'a', startsAt: '2026-01-02', items: [{ itemId: 'impl', qty: 1 }] },
    ]);
    expect(f.get('impl')).toEqual({ appointmentId: 'b', startsAt: '2026-01-03', missing: 1 });
  });

  it('sugere compra em unidades de compra', () => {
    expect(
      suggestedPurchase({
        current: 10,
        onOrder: 0,
        needUntilDelivery: 40,
        minQty: 20,
        unitsPerPurchase: 50,
      }),
    ).toBe(1);
    expect(
      suggestedPurchase({
        current: 10,
        onOrder: 50,
        needUntilDelivery: 40,
        minQty: 20,
        unitsPerPurchase: 50,
      }),
    ).toBe(0);
    expect(
      suggestedPurchase({
        current: 0,
        onOrder: 0,
        needUntilDelivery: 120,
        minQty: 0,
        unitsPerPurchase: 50,
      }),
    ).toBe(3);
  });
});
