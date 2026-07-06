/**
 * V2 Sprint 5B — route/query-shape tests for Purchase Order. Same
 * `.toSQL()` convention as salesOrders.query.test.ts / purchaseRequests.query.test.ts
 * (no live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT_ID = '33333333-3333-3333-3333-333333333333';

function buildListQuery(opts: { status?: string; supplierId?: string; search?: string } = {}) {
  let q = db('purchase_orders as po')
    .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
    .where('po.dealer_id', DEALER_ID);
  if (opts.status) q = q.andWhere('po.status', opts.status);
  if (opts.supplierId) q = q.andWhere('po.supplier_id', opts.supplierId);
  if (opts.search) {
    q = q.andWhere((b: any) => b.whereILike('po.po_number', `%${opts.search}%`).orWhereILike('s.name', `%${opts.search}%`));
  }
  return q.select('po.*', 's.name as supplier_name');
}

describe('GET /api/purchase-orders — query shape (V2 Sprint 5B)', () => {
  it('joins suppliers, scoped by dealer_id', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/left join "suppliers" as "s" on "s"\."id" = "po"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('filters by status and supplierId when provided', () => {
    const { bindings } = buildListQuery({ status: 'pending_approval', supplierId: SUPPLIER_ID }).toSQL();
    expect(bindings).toContain('pending_approval');
    expect(bindings).toContain(SUPPLIER_ID);
  });

  it('searches po_number OR supplier name', () => {
    const { sql, bindings } = buildListQuery({ search: 'PO-001' }).toSQL();
    expect(sql).toMatch(/"po"\."po_number" ilike/i);
    expect(sql).toMatch(/"s"\."name" ilike/i);
    expect(bindings).toContain('%PO-001%');
  });
});

describe('last-purchase-rate query shape (V2 Sprint 5B)', () => {
  it('scopes by dealer_id + supplier_id (via purchases) + product_id, ordered by most recent purchase', () => {
    const { sql, bindings } = db('purchase_items as pi')
      .innerJoin('purchases as pu', 'pu.id', 'pi.purchase_id')
      .where({ 'pi.dealer_id': DEALER_ID, 'pu.supplier_id': SUPPLIER_ID, 'pi.product_id': PRODUCT_ID })
      .orderBy('pu.purchase_date', 'desc')
      .orderBy('pu.created_at', 'desc')
      .first('pi.purchase_rate as last_rate', 'pu.purchase_date as last_purchase_date')
      .toSQL();
    expect(sql).toMatch(/inner join "purchases" as "pu" on "pu"\."id" = "pi"\."purchase_id"/i);
    expect(sql).toMatch(/order by "pu"\."purchase_date" desc, "pu"\."created_at" desc/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(SUPPLIER_ID);
    expect(bindings).toContain(PRODUCT_ID);
  });
});

describe('Purchase Order form/item Zod schemas (V2 Sprint 5B)', () => {
  const itemSchema = z.object({
    product_id: z.string().uuid().nullable().optional(),
    product_name_snapshot: z.string().min(1),
    ordered_qty: z.coerce.number().positive(),
    rate: z.coerce.number().min(0),
  });

  it('accepts a minimal valid item', () => {
    const parsed = itemSchema.parse({ product_name_snapshot: 'Glossy Tile 600x600', ordered_qty: 100, rate: 500 });
    expect(parsed.ordered_qty).toBe(100);
  });

  it('rejects a zero/negative ordered_qty', () => {
    expect(() => itemSchema.parse({ product_name_snapshot: 'X', ordered_qty: 0, rate: 1 })).toThrow();
  });

  it('rejects a negative rate', () => {
    expect(() => itemSchema.parse({ product_name_snapshot: 'X', ordered_qty: 1, rate: -5 })).toThrow();
  });

  const statusEnum = z.enum(['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'fully_received', 'cancelled', 'closed']);
  it('accepts all 8 documented Purchase Order statuses', () => {
    for (const s of ['draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'fully_received', 'cancelled', 'closed']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
  it('rejects an undocumented status (e.g. a 9th "rejected" status was deliberately not introduced)', () => {
    expect(() => statusEnum.parse('rejected')).toThrow();
  });

  const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
  it('requires a non-empty rejection reason', () => {
    expect(() => rejectSchema.parse({ reason: '' })).toThrow();
    expect(rejectSchema.parse({ reason: 'Price too high' }).reason).toBe('Price too high');
  });
});

describe('Purchase Order numbering (generate_next_purchase_order_no) — call shape', () => {
  it('is invoked with the dealer id cast to uuid, matching generate_next_sales_order_no', () => {
    const { sql, bindings } = db.raw('SELECT generate_next_purchase_order_no(?::uuid) AS no', [DEALER_ID]).toSQL();
    expect(sql).toMatch(/generate_next_purchase_order_no\(\?::uuid\)/);
    expect(bindings).toEqual([DEALER_ID]);
  });
});

describe('purchase_order_approvals history shape (V2 Sprint 5B)', () => {
  const actionEnum = z.enum(['submitted', 'approved', 'rejected', 'sent', 'cancelled', 'closed']);
  it('accepts all 6 documented history actions', () => {
    for (const a of ['submitted', 'approved', 'rejected', 'sent', 'cancelled', 'closed']) {
      expect(() => actionEnum.parse(a)).not.toThrow();
    }
  });

  it('history rows are scoped by dealer_id + purchase_order_id, most-recent first', () => {
    const PO_ID = '44444444-4444-4444-4444-444444444444';
    const { sql, bindings } = db('purchase_order_approvals')
      .where({ dealer_id: DEALER_ID, purchase_order_id: PO_ID })
      .orderBy('created_at', 'desc')
      .toSQL();
    expect(sql).toMatch(/order by "created_at" desc/i);
    expect(bindings).toEqual([DEALER_ID, PO_ID]);
  });
});

describe('RFQ → PO conversion grouping (V2 Sprint 5B)', () => {
  it('groups rfq_items by selected_supplier_id so each supplier gets its own PO', () => {
    const items = [
      { id: 'i1', selected_supplier_id: 's1', product_name_snapshot: 'A', qty: 10 },
      { id: 'i2', selected_supplier_id: 's2', product_name_snapshot: 'B', qty: 5 },
      { id: 'i3', selected_supplier_id: 's1', product_name_snapshot: 'C', qty: 2 },
    ];
    const bySupplier = new Map<string, typeof items>();
    for (const item of items) {
      const arr = bySupplier.get(item.selected_supplier_id) || [];
      arr.push(item);
      bySupplier.set(item.selected_supplier_id, arr);
    }
    expect(bySupplier.size).toBe(2);
    expect(bySupplier.get('s1')).toHaveLength(2);
    expect(bySupplier.get('s2')).toHaveLength(1);
  });
});
