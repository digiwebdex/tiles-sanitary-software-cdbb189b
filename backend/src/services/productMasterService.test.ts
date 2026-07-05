import { describe, expect, it } from 'vitest';
import { computeBackorderOutstanding, shapePriceLevels } from './productMasterService';

describe('computeBackorderOutstanding', () => {
  it('returns backorder minus allocated when positive', () => {
    expect(computeBackorderOutstanding(50, 20)).toBe(30);
  });

  it('clamps at 0 when fully allocated', () => {
    expect(computeBackorderOutstanding(50, 50)).toBe(0);
  });

  it('clamps at 0 rather than going negative on over-allocation', () => {
    expect(computeBackorderOutstanding(20, 35)).toBe(0);
  });

  it('treats missing values as 0', () => {
    expect(computeBackorderOutstanding(0, 0)).toBe(0);
    // @ts-expect-error — defensive against undefined from a missing DB row
    expect(computeBackorderOutstanding(undefined, undefined)).toBe(0);
  });
});

describe('shapePriceLevels', () => {
  it('maps tier rows and preserves null (not-set) rates', () => {
    const result = shapePriceLevels(1200, [
      { tier_id: 't1', tier_name: 'Retail', is_default: true, rate: null },
      { tier_id: 't2', tier_name: 'Wholesale', is_default: false, rate: '950.00' },
      { tier_id: 't3', tier_name: 'Dealer', is_default: false, rate: 800 },
    ]);

    expect(result.defaultSaleRate).toBe(1200);
    expect(result.tiers).toEqual([
      { tierId: 't1', tierName: 'Retail', isDefault: true, rate: null },
      { tierId: 't2', tierName: 'Wholesale', isDefault: false, rate: 950 },
      { tierId: 't3', tierName: 'Dealer', isDefault: false, rate: 800 },
    ]);
  });

  it('coerces string numeric rates (as returned by pg numeric columns)', () => {
    const result = shapePriceLevels('500', [
      { tier_id: 't1', tier_name: 'Project', is_default: false, rate: '450.5' },
    ]);
    expect(result.defaultSaleRate).toBe(500);
    expect(result.tiers[0].rate).toBe(450.5);
  });

  it('handles an empty tier list', () => {
    const result = shapePriceLevels(0, []);
    expect(result).toEqual({ defaultSaleRate: 0, tiers: [] });
  });

  it('treats undefined rate the same as null (not-set)', () => {
    const result = shapePriceLevels(100, [
      { tier_id: 't1', tier_name: 'Retail', is_default: null, rate: undefined },
    ]);
    expect(result.tiers[0].rate).toBeNull();
    expect(result.tiers[0].isDefault).toBe(false);
  });
});
