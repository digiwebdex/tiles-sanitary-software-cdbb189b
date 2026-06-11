import { describe, expect, it } from 'vitest';
import {
  addDueToAgingBuckets,
  agingDaysFromSaleDate,
  emptyDueAgingBuckets,
} from '../../backend/src/services/reportQueryService';

describe('due aging bucket helpers', () => {
  const today = new Date('2026-06-09T12:00:00Z');

  it('agingDaysFromSaleDate returns non-negative day count', () => {
    expect(agingDaysFromSaleDate('2026-06-09', today)).toBe(0);
    expect(agingDaysFromSaleDate('2026-06-01', today)).toBe(8);
    expect(agingDaysFromSaleDate('2026-07-01', today)).toBe(0);
  });

  it('addDueToAgingBuckets allocates into correct columns', () => {
    const b = emptyDueAgingBuckets();
    addDueToAgingBuckets(b, 100, 0);
    addDueToAgingBuckets(b, 200, 15);
    addDueToAgingBuckets(b, 50, 45);
    addDueToAgingBuckets(b, 75, 70);
    addDueToAgingBuckets(b, 25, 95);
    expect(b).toEqual({
      current: 100,
      d30: 200,
      d60: 50,
      d90: 75,
      d90plus: 25,
      total: 450,
    });
  });

  it('due aging grand total matches sum of bucket columns', () => {
    const b = emptyDueAgingBuckets();
    const dues = [
      { due: 5000, days: 5 },
      { due: 3000, days: 40 },
      { due: 2000, days: 120 },
    ];
    for (const row of dues) addDueToAgingBuckets(b, row.due, row.days);
    const bucketSum = b.current + b.d30 + b.d60 + b.d90 + b.d90plus;
    expect(b.total).toBe(bucketSum);
    expect(b.total).toBe(10_000);
  });
});
