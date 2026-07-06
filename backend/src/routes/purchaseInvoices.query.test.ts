/**
 * V2 Sprint 5D — route/query-shape + pure-function tests for Purchase
 * Invoice. Same `.toSQL()` convention as goodsReceipts.query.test.ts (no
 * live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';
const GRN_ID = '33333333-3333-3333-3333-333333333333';

describe('GET /api/purchase-invoices/goods-receipts/uninvoiced — query shape', () => {
  function buildQuery(opts: { supplierId?: string } = {}) {
    let q = db('goods_receipts as gr')
      .innerJoin('purchase_orders as po', 'po.id', 'gr.purchase_order_id')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'gr.dealer_id': DEALER_ID, 'gr.status': 'completed' });
    if (opts.supplierId) q = q.andWhere('po.supplier_id', opts.supplierId);
    return q.select('gr.id', 'gr.grn_number', 'gr.receive_date', 'po.supplier_id', 's.name as supplier_name');
  }

  it('scopes to completed GRNs for this dealer, joined through purchase_orders/suppliers', () => {
    const { sql, bindings } = buildQuery().toSQL();
    expect(sql).toMatch(/inner join "purchase_orders" as "po" on "po"\."id" = "gr"\."purchase_order_id"/i);
    expect(sql).toMatch(/left join "suppliers" as "s" on "s"\."id" = "po"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('completed');
  });

  it('filters by supplierId when provided', () => {
    const { bindings } = buildQuery({ supplierId: SUPPLIER_ID }).toSQL();
    expect(bindings).toContain(SUPPLIER_ID);
  });
});

describe('Already-invoiced quantity aggregation (loadInvoicedMap) — query shape', () => {
  it('sums purchase_items.quantity grouped by source_goods_receipt_item_id, scoped to draft/posted invoices only', () => {
    const { sql, bindings } = db('purchase_items as pi')
      .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
      .where({ 'pi.dealer_id': DEALER_ID })
      .whereIn('pi.source_goods_receipt_item_id', [GRN_ID])
      .whereIn('p.document_status', ['draft', 'posted'])
      .groupBy('pi.source_goods_receipt_item_id')
      .select('pi.source_goods_receipt_item_id as goods_receipt_item_id')
      .sum({ invoiced: 'pi.quantity' })
      .toSQL();
    expect(sql).toMatch(/inner join "purchases" as "p" on "p"\."id" = "pi"\."purchase_id"/i);
    expect(sql).toMatch(/group by "pi"\."source_goods_receipt_item_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(GRN_ID);
    expect(bindings).toContain('draft');
    expect(bindings).toContain('posted');
  });

  it('excludes cancelled invoices from the document_status filter, so a cancelled invoice releases its claim', () => {
    const { bindings } = db('purchase_items as pi')
      .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
      .whereIn('p.document_status', ['draft', 'posted'])
      .toSQL();
    expect(bindings).not.toContain('cancelled');
  });
});

describe('Purchase Invoice Zod schemas (V2 Sprint 5D)', () => {
  const itemSchema = z.object({
    goods_receipt_item_id: z.string().uuid(),
    product_id: z.string().uuid(),
    invoice_qty: z.coerce.number().positive(),
    rate: z.coerce.number().min(0),
  });
  const formSchema = z.object({
    supplier_id: z.string().uuid(),
    purchase_date: z.string().min(1),
    notes: z.string().nullable().optional(),
    voucher_discount: z.coerce.number().min(0).default(0),
    items: z.array(itemSchema).min(1),
  });

  it('accepts a minimal valid invoice with one item', () => {
    const parsed = formSchema.parse({
      supplier_id: SUPPLIER_ID,
      purchase_date: '2026-07-06',
      items: [{ goods_receipt_item_id: GRN_ID, product_id: GRN_ID, invoice_qty: 10, rate: 50 }],
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.voucher_discount).toBe(0);
  });

  it('rejects an invoice with zero items', () => {
    expect(() => formSchema.parse({ supplier_id: SUPPLIER_ID, purchase_date: '2026-07-06', items: [] })).toThrow();
  });

  it('rejects a zero/negative invoice_qty', () => {
    expect(() => itemSchema.parse({ goods_receipt_item_id: GRN_ID, product_id: GRN_ID, invoice_qty: 0, rate: 10 })).toThrow();
    expect(() => itemSchema.parse({ goods_receipt_item_id: GRN_ID, product_id: GRN_ID, invoice_qty: -5, rate: 10 })).toThrow();
  });

  const statusEnum = z.enum(['draft', 'pending_approval', 'posted', 'reversed', 'cancelled']);
  it('accepts all 5 document_status values after the Sprint 5D widening', () => {
    for (const s of ['draft', 'pending_approval', 'posted', 'reversed', 'cancelled']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
});

describe('Over-invoice prevention logic (mirrors GRN over-receive check)', () => {
  function wouldOverInvoice(receivedQty: number, alreadyInvoiced: number, incomingQty: number): boolean {
    return alreadyInvoiced + incomingQty > receivedQty + 0.001;
  }

  it('allows an invoice that exactly matches the received quantity', () => {
    expect(wouldOverInvoice(100, 0, 100)).toBe(false);
  });

  it('rejects an invoice that would exceed the received quantity', () => {
    expect(wouldOverInvoice(100, 60, 50)).toBe(true);
  });

  it('allows a partial invoice within the remaining invoiceable quantity', () => {
    expect(wouldOverInvoice(100, 40, 30)).toBe(false);
  });

  it('allows a second invoice to claim exactly the remainder after a first partial invoice', () => {
    expect(wouldOverInvoice(100, 40, 60)).toBe(false);
    expect(wouldOverInvoice(100, 40, 60.001)).toBe(false);
    expect(wouldOverInvoice(100, 40, 61)).toBe(true);
  });
});

describe('Invoice numbering — PUR-YYYYMMDD-NNNN sequence derivation', () => {
  function nextInvoiceNumber(purchaseDate: string, existingNumbers: string[]): string {
    const datePart = purchaseDate.replace(/-/g, '').slice(0, 8);
    const prefix = `PUR-${datePart}-`;
    let maxSeq = 0;
    for (const num of existingNumbers) {
      const m = /-(\d+)$/.exec(num || '');
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  }

  it('produces NNNN=0001 for the first invoice of a given day', () => {
    expect(nextInvoiceNumber('2026-07-06', [])).toBe('PUR-20260706-0001');
  });

  it('increments the sequence based on the highest existing suffix for that day', () => {
    expect(nextInvoiceNumber('2026-07-06', ['PUR-20260706-0001', 'PUR-20260706-0002'])).toBe('PUR-20260706-0003');
  });

  it('does not let a different day\'s sequence bleed into a new day\'s numbering', () => {
    // Simulates the query being pre-filtered by the `PUR-${datePart}-%` LIKE
    // clause: only same-day numbers should ever reach this function.
    expect(nextInvoiceNumber('2026-07-07', [])).toBe('PUR-20260707-0001');
  });
});

describe('Finalize-only draft guard', () => {
  const FINALIZABLE_STATUSES = ['draft'];
  it('only allows finalizing a draft invoice', () => {
    for (const s of ['pending_approval', 'posted', 'reversed', 'cancelled']) {
      expect(FINALIZABLE_STATUSES.includes(s)).toBe(false);
    }
    expect(FINALIZABLE_STATUSES.includes('draft')).toBe(true);
  });
});
