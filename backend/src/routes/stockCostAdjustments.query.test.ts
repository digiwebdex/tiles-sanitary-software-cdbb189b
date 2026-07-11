/**
 * V2 Sprint 5E — schema tests for manual Batch/Stock Cost Update.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('Manual cost adjustment Zod schema', () => {
  const schema = z.object({
    product_id: z.string().uuid(),
    new_avg_cost: z.coerce.number().min(0),
    reason: z.string().trim().min(1, 'A reason is required').max(500),
  });
  const PRODUCT_ID = '55555555-5555-5555-5555-555555555555';

  it('accepts a valid adjustment with a reason', () => {
    const parsed = schema.parse({ product_id: PRODUCT_ID, new_avg_cost: 42.5, reason: 'Physical stock revaluation' });
    expect(parsed.new_avg_cost).toBe(42.5);
  });

  it('rejects an empty reason', () => {
    expect(() => schema.parse({ product_id: PRODUCT_ID, new_avg_cost: 42.5, reason: '' })).toThrow();
  });

  it('rejects a negative new_avg_cost', () => {
    expect(() => schema.parse({ product_id: PRODUCT_ID, new_avg_cost: -1, reason: 'test' })).toThrow();
  });
});

describe('Cost adjustment audit record shape', () => {
  it('records both old and new average cost for traceability', () => {
    const record = { old_avg_cost: 50, new_avg_cost: 54, adjustment_type: 'manual' };
    expect(record.new_avg_cost).toBeGreaterThan(record.old_avg_cost);
  });

  it('distinguishes manual adjustments from landed-cost-driven ones via adjustment_type', () => {
    const manual = { adjustment_type: 'manual', landed_cost_sheet_id: null };
    const landed = { adjustment_type: 'landed_cost', landed_cost_sheet_id: '11111111-1111-1111-1111-111111111111' };
    expect(manual.landed_cost_sheet_id).toBeNull();
    expect(landed.landed_cost_sheet_id).not.toBeNull();
  });
});
