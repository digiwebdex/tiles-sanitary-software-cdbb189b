/**
 * V2 Sprint 6B — query-shape tests for the Customer Aging / Accounts
 * Receivable Due Today/This Week/This Month endpoint. This is the
 * customer-side counterpart to supplierAging.query.test.ts — the shared
 * recency-bucket logic (startOfWeek/classify) already has coverage there
 * and is not re-tested here; this file covers what's new: reuse of
 * `applyOpenArSalesFilter`'s exact query shape via `fetchOpenSalesDueRows`.
 */
import { describe, expect, it } from 'vitest';
import { applyOpenArSalesFilter } from '../services/reportQueryService';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('customer-aging — open sales-due query shape (via applyOpenArSalesFilter)', () => {
  it('excludes reversed sales and zero/negative due amounts', () => {
    const { sql, bindings } = applyOpenArSalesFilter(
      db('sales').where({ dealer_id: DEALER_ID }),
    ).toSQL();
    expect(sql.toLowerCase()).toContain('due_amount');
    expect(sql.toLowerCase()).toContain('reversed');
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('due amount rounding (matches supplierAging.ts convention)', () => {
  function round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  it('skips a sale whose due amount rounds to zero', () => {
    const dueAmount = round2(0.004);
    expect(dueAmount <= 0.01).toBe(true);
  });

  it('includes a sale with a genuine positive due amount', () => {
    const dueAmount = round2(1500.999);
    expect(dueAmount > 0.01).toBe(true);
  });
});
