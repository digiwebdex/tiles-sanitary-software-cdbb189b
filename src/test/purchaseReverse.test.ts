import { describe, expect, it } from 'vitest';
import { reverseWeightedAverageCost } from '../../backend/src/services/purchaseReverse';

describe('reverseWeightedAverageCost', () => {
  it('undoes WAC after removing an incoming purchase line', () => {
    // Had 100 sft @ 80 = 8000; added 50 sft @ 120 = 6000 → avg 93.33 on 150 sft
    const avgAfterPurchase = (100 * 80 + 50 * 120) / 150;
    expect(avgAfterPurchase).toBeCloseTo(93.33, 1);

    const restored = reverseWeightedAverageCost({
      currentQtyBase: 150,
      currentAvg: avgAfterPurchase,
      incomingQtyBase: 50,
      incomingTotal: 6000,
    });
    expect(restored).toBe(80);
  });

  it('returns 0 when stock is fully removed', () => {
    expect(
      reverseWeightedAverageCost({
        currentQtyBase: 10,
        currentAvg: 50,
        incomingQtyBase: 10,
        incomingTotal: 500,
      }),
    ).toBe(0);
  });
});

describe('purchase reverse posting inversion', () => {
  it('negates purchase stock and ledger lines for reversal batch', async () => {
    const { invertPostingLines } = await import('../../backend/src/services/posting/invertPostingLines');
    const lines = [
      {
        lineDomain: 'stock' as const,
        lineType: 'purchase_in',
        amount: 10000,
        entryDate: '2026-06-01',
        qtyDelta: 5,
        qtyUnit: 'box',
        purchaseId: 'pur-1',
      },
      {
        lineDomain: 'supplier' as const,
        lineType: 'purchase',
        amount: -10000,
        entryDate: '2026-06-01',
        partyId: 'sup-1',
        purchaseId: 'pur-1',
      },
    ];
    const reversed = invertPostingLines(lines);
    expect(reversed[0].qtyDelta).toBe(-5);
    expect(reversed[0].amount).toBe(-10000);
    expect(reversed[1].amount).toBe(10000);
  });
});
