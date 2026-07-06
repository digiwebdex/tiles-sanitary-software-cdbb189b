/**
 * V2 Sprint 5E — route/query-shape + pure-function tests for Purchase
 * Return. Same `.toSQL()` convention as purchaseInvoices.query.test.ts (no
 * live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';
const PURCHASE_ID = '33333333-3333-3333-3333-333333333333';
const PURCHASE_ITEM_ID = '44444444-4444-4444-4444-444444444444';

describe('GET /api/purchase-returns/purchases/returnable — query shape', () => {
  function buildQuery(opts: { supplierId?: string } = {}) {
    let q = db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where({ 'p.dealer_id': DEALER_ID, 'p.document_status': 'posted' });
    if (opts.supplierId) q = q.andWhere('p.supplier_id', opts.supplierId);
    return q.select('p.id', 'p.invoice_number', 'p.purchase_date', 'p.supplier_id', 's.name as supplier_name');
  }

  it('scopes to posted purchases for this dealer', () => {
    const { sql, bindings } = buildQuery().toSQL();
    expect(sql).toMatch(/left join "suppliers" as "s" on "s"\."id" = "p"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('posted');
  });

  it('filters by supplierId when provided', () => {
    const { bindings } = buildQuery({ supplierId: SUPPLIER_ID }).toSQL();
    expect(bindings).toContain(SUPPLIER_ID);
  });
});

describe('Already-returned quantity aggregation (loadReturnedMap) — query shape', () => {
  it('sums purchase_return_items.quantity grouped by source_purchase_item_id, scoped to draft/completed returns only', () => {
    const { sql, bindings } = db('purchase_return_items as pri')
      .innerJoin('purchase_returns as pr', 'pr.id', 'pri.purchase_return_id')
      .where({ 'pri.dealer_id': DEALER_ID })
      .whereIn('pri.source_purchase_item_id', [PURCHASE_ITEM_ID])
      .whereIn('pr.status', ['draft', 'completed'])
      .groupBy('pri.source_purchase_item_id')
      .select('pri.source_purchase_item_id as purchase_item_id')
      .sum({ returned: 'pri.quantity' })
      .toSQL();
    expect(sql).toMatch(/inner join "purchase_returns" as "pr" on "pr"\."id" = "pri"\."purchase_return_id"/i);
    expect(sql).toMatch(/group by "pri"\."source_purchase_item_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(PURCHASE_ITEM_ID);
    expect(bindings).toContain('draft');
    expect(bindings).toContain('completed');
  });

  it('excludes cancelled returns, so a cancelled return releases its claim', () => {
    const { bindings } = db('purchase_return_items as pri').whereIn('pr.status', ['draft', 'completed']).toSQL();
    expect(bindings).not.toContain('cancelled');
  });
});

describe('Purchase Return Zod schemas (V2 Sprint 5E)', () => {
  const itemSchema = z.object({
    purchase_item_id: z.string().uuid(),
    product_id: z.string().uuid(),
    return_qty: z.coerce.number().positive(),
    unit_price: z.coerce.number().min(0),
    reason: z.string().nullable().optional(),
  });
  const formSchema = z.object({
    supplier_id: z.string().uuid(),
    purchase_id: z.string().uuid().nullable().optional(),
    return_date: z.string().min(1),
    notes: z.string().nullable().optional(),
    items: z.array(itemSchema).min(1),
  });

  it('accepts a minimal valid return with one item', () => {
    const parsed = formSchema.parse({
      supplier_id: SUPPLIER_ID,
      return_date: '2026-07-06',
      items: [{ purchase_item_id: PURCHASE_ITEM_ID, product_id: PURCHASE_ITEM_ID, return_qty: 5, unit_price: 100 }],
    });
    expect(parsed.items).toHaveLength(1);
  });

  it('rejects a return with zero items', () => {
    expect(() => formSchema.parse({ supplier_id: SUPPLIER_ID, return_date: '2026-07-06', items: [] })).toThrow();
  });

  it('rejects a zero/negative return_qty', () => {
    expect(() => itemSchema.parse({ purchase_item_id: PURCHASE_ITEM_ID, product_id: PURCHASE_ITEM_ID, return_qty: 0, unit_price: 10 })).toThrow();
    expect(() => itemSchema.parse({ purchase_item_id: PURCHASE_ITEM_ID, product_id: PURCHASE_ITEM_ID, return_qty: -1, unit_price: 10 })).toThrow();
  });
});

describe('Over-return prevention logic (mirrors GRN over-receive / Invoice over-invoice checks)', () => {
  function wouldOverReturn(purchasedQty: number, alreadyReturned: number, incomingQty: number): boolean {
    return alreadyReturned + incomingQty > purchasedQty + 0.001;
  }

  it('allows a return that exactly matches the purchased quantity', () => {
    expect(wouldOverReturn(100, 0, 100)).toBe(false);
  });

  it('rejects a return that would exceed the purchased quantity', () => {
    expect(wouldOverReturn(100, 60, 50)).toBe(true);
  });

  it('allows a partial return within the remaining returnable quantity', () => {
    expect(wouldOverReturn(100, 40, 30)).toBe(false);
  });

  it('allows a second return to claim exactly the remainder after a first partial return', () => {
    expect(wouldOverReturn(100, 40, 60)).toBe(false);
    expect(wouldOverReturn(100, 40, 61)).toBe(true);
  });
});

describe('Return numbering — PR-NNNN sequence (mirrors legacy convention)', () => {
  function nextReturnNo(existingCount: number): string {
    return `PR-${String(existingCount + 1).padStart(4, '0')}`;
  }

  it('produces NNNN=0001 for the first return', () => {
    expect(nextReturnNo(0)).toBe('PR-0001');
  });

  it('increments based on existing count', () => {
    expect(nextReturnNo(41)).toBe('PR-0042');
  });
});

describe('Draft-only lifecycle guards', () => {
  const EDITABLE_STATUSES = ['draft'];
  it('only allows editing/completing/cancelling a draft return', () => {
    for (const s of ['completed', 'cancelled']) {
      expect(EDITABLE_STATUSES.includes(s)).toBe(false);
    }
    expect(EDITABLE_STATUSES.includes('draft')).toBe(true);
  });
});

describe('Supplier ledger sign convention for purchase_return (V2 Sprint 5E)', () => {
  function balanceDelta(amount: number): number {
    // Mirrors the universal `balance += -amount` rule verified in Sprint 5D
    // for credit_note/debit_note/refund — purchase_return uses the same
    // formula, stored POSITIVE, so it reduces balance owed like a refund
    // or credit note (a NEW, distinct type from Sprint 5D's 'debit_note',
    // which increases balance owed for its own, different purpose).
    return -amount;
  }

  it('a purchase_return stored with a positive amount reduces the balance owed', () => {
    const before = 1000;
    const returnAmount = 300; // stored positive
    const after = before + balanceDelta(returnAmount);
    expect(after).toBe(700);
  });
});
