import { describe, expect, it } from 'vitest';
import { invertPostingLines } from '../../backend/src/services/posting/invertPostingLines';
import type { PostingLineInput } from '../../backend/src/services/posting/types';

describe('invertPostingLines', () => {
  it('negates amount and qty_delta for reversal batch', () => {
    const lines: PostingLineInput[] = [
      {
        lineDomain: 'stock',
        lineType: 'sale_out',
        amount: 2333.32,
        entryDate: '2026-06-09',
        qtyDelta: -7,
        qtyUnit: 'box',
        saleId: 'sale-1',
      },
      {
        lineDomain: 'customer',
        lineType: 'sale',
        amount: 6999.97,
        entryDate: '2026-06-09',
        partyId: 'cust-1',
        saleId: 'sale-1',
      },
    ];

    const reversed = invertPostingLines(lines);
    expect(reversed[0].amount).toBe(-2333.32);
    expect(reversed[0].qtyDelta).toBe(7);
    expect(reversed[1].amount).toBe(-6999.97);
    expect(reversed[0].metadata?.reversed).toBe(true);
  });
});
