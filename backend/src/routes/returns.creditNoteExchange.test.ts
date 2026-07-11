/**
 * V2 Sprint 4D — Credit Note / Exchange / refund_mode additions to
 * returns.ts. Zod schema + query-shape tests, same `.toSQL()` convention
 * as collections.advance.query.test.ts (no live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';
const SALE_ID = '33333333-3333-3333-3333-333333333333';

describe('salesReturnSchema — refund_mode / refund_paid_account_id (V2 Sprint 4D)', () => {
  const salesReturnSchema = z.object({
    dealer_id: z.string().uuid().optional(),
    sale_id: z.string().uuid(),
    product_id: z.string().uuid(),
    qty: z.coerce.number().positive(),
    qty_sqft: z.coerce.number().min(0).optional().nullable(),
    reason: z.string().nullable().optional(),
    is_broken: z.boolean(),
    refund_amount: z.coerce.number().nonnegative(),
    refund_mode: z.string().nullable().optional(),
    refund_paid_account_id: z.string().uuid().nullable().optional(),
    return_date: z.string().min(1),
  });

  it('accepts a payload with no refund_mode/refund_paid_account_id (backward compatible)', () => {
    const parsed = salesReturnSchema.parse({
      sale_id: SALE_ID, product_id: CUSTOMER_ID, qty: 1, is_broken: false, refund_amount: 100, return_date: '2026-01-01',
    });
    expect(parsed.refund_mode).toBeUndefined();
    expect(parsed.refund_paid_account_id).toBeUndefined();
  });

  it('accepts a "credit" refund_mode with no bank account', () => {
    const parsed = salesReturnSchema.parse({
      sale_id: SALE_ID, product_id: CUSTOMER_ID, qty: 1, is_broken: false, refund_amount: 100, refund_mode: 'credit', return_date: '2026-01-01',
    });
    expect(parsed.refund_mode).toBe('credit');
  });

  it('accepts a bank refund_mode with a refund_paid_account_id', () => {
    const parsed = salesReturnSchema.parse({
      sale_id: SALE_ID, product_id: CUSTOMER_ID, qty: 1, is_broken: false, refund_amount: 100,
      refund_mode: 'bank', refund_paid_account_id: DEALER_ID, return_date: '2026-01-01',
    });
    expect(parsed.refund_paid_account_id).toBe(DEALER_ID);
  });
});

describe('applyCreditNoteSchema / linkExchangeSchema (V2 Sprint 4D)', () => {
  const applyCreditNoteSchema = z.object({
    customer_id: z.string().uuid(),
    sale_id: z.string().uuid(),
    amount: z.coerce.number().positive(),
  });

  it('accepts a valid apply-credit-note payload', () => {
    const parsed = applyCreditNoteSchema.parse({ customer_id: CUSTOMER_ID, sale_id: SALE_ID, amount: 250 });
    expect(parsed.amount).toBe(250);
  });

  it('rejects a zero amount', () => {
    expect(() => applyCreditNoteSchema.parse({ customer_id: CUSTOMER_ID, sale_id: SALE_ID, amount: 0 })).toThrow();
  });

  const linkExchangeSchema = z.object({ saleId: z.string().uuid() });

  it('accepts a valid link-exchange payload', () => {
    const parsed = linkExchangeSchema.parse({ saleId: SALE_ID });
    expect(parsed.saleId).toBe(SALE_ID);
  });

  it('rejects a missing saleId', () => {
    expect(() => linkExchangeSchema.parse({})).toThrow();
  });
});

describe('Credit note balance query shape (V2 Sprint 4D)', () => {
  it('sums sales_returns.refund_amount for credit-mode returns, joined to sales and scoped by dealer+customer', () => {
    const { sql, bindings } = db('sales_returns as sr')
      .join('sales as s', 's.id', 'sr.sale_id')
      .where({ 's.dealer_id': DEALER_ID, 's.customer_id': CUSTOMER_ID, 'sr.refund_mode': 'credit' })
      .sum('sr.refund_amount as sum')
      .toSQL();
    expect(sql).toMatch(/inner join "sales" as "s" on "s"\."id" = "sr"\."sale_id"/i);
    expect(sql).toMatch(/sum\("sr"\."refund_amount"\) as "sum"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(CUSTOMER_ID);
    expect(bindings).toContain('credit');
  });

  it('sums customer_credit_note_applications for the same customer', () => {
    const { sql, bindings } = db('customer_credit_note_applications')
      .where({ dealer_id: DEALER_ID, customer_id: CUSTOMER_ID })
      .sum('amount as sum')
      .toSQL();
    expect(sql).toMatch(/sum\("amount"\) as "sum"/i);
    expect(bindings).toEqual([DEALER_ID, CUSTOMER_ID]);
  });
});
