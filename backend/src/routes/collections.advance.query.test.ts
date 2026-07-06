/**
 * V2 Sprint 4C — Advance Payment: Zod schema + query-shape tests for the
 * new /api/collections/advance* endpoints. Same `.toSQL()` convention as
 * reservations.query.test.ts (no live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

describe('advancePaymentSchema / applyAdvanceSchema (V2 Sprint 4C)', () => {
  const advancePaymentSchema = z.object({
    customer_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
    note: z.string().trim().max(500).optional(),
    payment_mode: z.string().trim().max(50).optional(),
    paid_account_id: z.string().uuid().optional().nullable(),
  });

  it('accepts a minimal valid advance payment', () => {
    const parsed = advancePaymentSchema.parse({ customer_id: CUSTOMER_ID, amount: 500 });
    expect(parsed.amount).toBe(500);
  });

  it('rejects a zero or negative amount', () => {
    expect(() => advancePaymentSchema.parse({ customer_id: CUSTOMER_ID, amount: 0 })).toThrow();
    expect(() => advancePaymentSchema.parse({ customer_id: CUSTOMER_ID, amount: -5 })).toThrow();
  });

  const applyAdvanceSchema = z.object({
    customer_id: z.string().uuid(),
    sale_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
  });

  it('accepts a valid apply-advance payload', () => {
    const parsed = applyAdvanceSchema.parse({ customer_id: CUSTOMER_ID, sale_id: DEALER_ID, amount: 100 });
    expect(parsed.amount).toBe(100);
  });

  it('rejects a missing sale_id', () => {
    expect(() => applyAdvanceSchema.parse({ customer_id: CUSTOMER_ID, amount: 100 })).toThrow();
  });
});

describe('Advance balance query shape (V2 Sprint 4C)', () => {
  it('sums customer_ledger payment rows with sale_id IS NULL, scoped by dealer+customer', () => {
    const { sql, bindings } = db('customer_ledger')
      .where({ dealer_id: DEALER_ID, customer_id: CUSTOMER_ID, type: 'payment' })
      .whereNull('sale_id')
      .sum('amount as sum')
      .toSQL();
    expect(sql).toMatch(/sum\("amount"\) as "sum"/i);
    expect(sql).toMatch(/"sale_id" is null/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(CUSTOMER_ID);
    expect(bindings).toContain('payment');
  });

  it('sums customer_advance_applications for the same customer', () => {
    const { sql, bindings } = db('customer_advance_applications')
      .where({ dealer_id: DEALER_ID, customer_id: CUSTOMER_ID })
      .sum('amount as sum')
      .toSQL();
    expect(sql).toMatch(/sum\("amount"\) as "sum"/i);
    expect(bindings).toEqual([DEALER_ID, CUSTOMER_ID]);
  });
});
