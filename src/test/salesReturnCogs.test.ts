import { describe, expect, it } from 'vitest';
import { computeLineCogs } from '../../backend/src/lib/cogsLine';

describe('sales return COGS reversal (P3-02)', () => {
  it('computes tile COGS reversal using WAC at return time', () => {
    const cogs = computeLineCogs({
      unitType: 'box_sft',
      effectiveQty: 2,
      perBoxSft: 25,
      avgCost: 80,
    });
    expect(cogs).toBe(4000);
  });

  it('computes piece COGS reversal', () => {
    const cogs = computeLineCogs({
      unitType: 'piece',
      effectiveQty: 5,
      perBoxSft: null,
      avgCost: 120,
    });
    expect(cogs).toBe(600);
  });
});
