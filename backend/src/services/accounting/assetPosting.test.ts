import { describe, expect, it } from 'vitest';
import {
  computeStraightLineMonthlyDepreciation,
  computeDecliningBalanceMonthlyDepreciation,
} from './assetPosting';

describe('computeStraightLineMonthlyDepreciation', () => {
  it('spreads (cost - salvage) evenly across useful life months', () => {
    // 60000 - 6000 = 54000 depreciable / 36 months = 1500/month.
    expect(computeStraightLineMonthlyDepreciation(60000, 6000, 36)).toBe(1500);
  });

  it('treats a missing salvage value as zero', () => {
    expect(computeStraightLineMonthlyDepreciation(12000, 0, 12)).toBe(1000);
  });

  it('returns 0 when useful life is zero or negative (guards divide-by-zero)', () => {
    expect(computeStraightLineMonthlyDepreciation(12000, 0, 0)).toBe(0);
    expect(computeStraightLineMonthlyDepreciation(12000, 0, -5)).toBe(0);
  });

  it('never goes negative when salvage exceeds cost', () => {
    expect(computeStraightLineMonthlyDepreciation(1000, 5000, 12)).toBe(0);
  });
});

describe('computeDecliningBalanceMonthlyDepreciation', () => {
  it('applies annual rate / 12 to the book value at period start', () => {
    // 100000 book value, 24% annual rate -> 2% monthly -> 2000.
    expect(computeDecliningBalanceMonthlyDepreciation(100000, 24, 0)).toBe(2000);
  });

  it('caps the depreciation so book value never drops below salvage value', () => {
    // book value 10000, salvage 9900 -> max allowed depreciation is 100, even though
    // the 24% annual rate would otherwise imply 200 (10000 * 2%/month).
    expect(computeDecliningBalanceMonthlyDepreciation(10000, 24, 9900)).toBe(100);
  });

  it('returns 0 once book value has already reached salvage value', () => {
    expect(computeDecliningBalanceMonthlyDepreciation(900, 24, 900)).toBe(0);
  });

  it('returns 0 for a zero or negative rate', () => {
    expect(computeDecliningBalanceMonthlyDepreciation(100000, 0, 0)).toBe(0);
  });
});
