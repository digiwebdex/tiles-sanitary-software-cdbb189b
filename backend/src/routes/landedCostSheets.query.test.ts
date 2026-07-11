/**
 * V2 Sprint 5E — pure-function + schema tests for Landed Cost allocation.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('Proportional-by-value allocation', () => {
  function allocate(totalCharges: number, lines: Array<{ qty: number; rate: number }>): number[] {
    const subtotal = lines.reduce((sum, l) => sum + l.qty * l.rate, 0);
    return lines.map((l) => round2(totalCharges * ((l.qty * l.rate) / subtotal)));
  }

  it('splits charges proportionally to line value for two equal-value lines', () => {
    const result = allocate(1000, [{ qty: 10, rate: 100 }, { qty: 10, rate: 100 }]);
    expect(result).toEqual([500, 500]);
  });

  it('gives a higher-value line a proportionally larger share', () => {
    const result = allocate(1000, [{ qty: 10, rate: 100 }, { qty: 10, rate: 300 }]);
    // line values: 1000 and 3000 => shares 25% / 75%
    expect(result).toEqual([250, 750]);
  });

  it('allocates the full amount across three lines summing back to the total (rounding aside)', () => {
    const result = allocate(999, [{ qty: 1, rate: 100 }, { qty: 1, rate: 200 }, { qty: 1, rate: 700 }]);
    const sum = result.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 999)).toBeLessThan(0.05);
  });
});

describe('qty_base conversion (mirrors receivingStockPosting.ts WAC basis)', () => {
  function qtyBase(unitType: string, quantity: number, perBoxSft: number | null): number {
    return unitType === 'box_sft' && perBoxSft ? quantity * perBoxSft : quantity;
  }

  it('uses sft_qty basis for box_sft products', () => {
    expect(qtyBase('box_sft', 10, 12.5)).toBe(125);
  });

  it('uses raw quantity for piece products', () => {
    expect(qtyBase('piece', 50, null)).toBe(50);
  });
});

describe('Average-cost-per-unit adjustment formula', () => {
  function applyLandedCost(avgBefore: number, allocatedAmount: number, qtyBase: number): number {
    return round2(avgBefore + allocatedAmount / qtyBase);
  }

  it('adds the per-unit allocated cost onto the existing average cost', () => {
    // 500 allocated across 125 sft units => +4.00/unit
    expect(applyLandedCost(50, 500, 125)).toBe(54);
  });

  it('leaves cost unchanged when nothing is allocated to a line', () => {
    expect(applyLandedCost(50, 0, 125)).toBe(50);
  });
});

describe('Landed Cost Sheet Zod schema', () => {
  const formSchema = z.object({
    purchase_id: z.string().uuid(),
    sheet_date: z.string().min(1),
    freight_amount: z.coerce.number().min(0).default(0),
    insurance_amount: z.coerce.number().min(0).default(0),
    customs_duty_amount: z.coerce.number().min(0).default(0),
    vat_amount: z.coerce.number().min(0).default(0),
    port_charges_amount: z.coerce.number().min(0).default(0),
    cf_charges_amount: z.coerce.number().min(0).default(0),
    local_transport_amount: z.coerce.number().min(0).default(0),
    other_charges_amount: z.coerce.number().min(0).default(0),
    notes: z.string().nullable().optional(),
  });
  const PURCHASE_ID = '33333333-3333-3333-3333-333333333333';

  it('accepts a minimal sheet with all charges defaulting to 0', () => {
    const parsed = formSchema.parse({ purchase_id: PURCHASE_ID, sheet_date: '2026-07-06' });
    expect(parsed.freight_amount).toBe(0);
    expect(parsed.customs_duty_amount).toBe(0);
  });

  it('rejects a negative charge amount', () => {
    expect(() => formSchema.parse({ purchase_id: PURCHASE_ID, sheet_date: '2026-07-06', freight_amount: -100 })).toThrow();
  });
});

describe('Apply-only-draft guard', () => {
  const APPLICABLE_STATUSES = ['draft'];
  it('only allows applying a draft sheet', () => {
    for (const s of ['applied', 'cancelled']) {
      expect(APPLICABLE_STATUSES.includes(s)).toBe(false);
    }
    expect(APPLICABLE_STATUSES.includes('draft')).toBe(true);
  });
});
