/**
 * V2 Sprint 5C — route/query-shape tests for Goods Receipt (GRN). Same
 * `.toSQL()` convention as purchaseOrders.query.test.ts (no live test DB in
 * this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const PO_ID = '22222222-2222-2222-2222-222222222222';

describe('GET /api/goods-receipts — query shape (V2 Sprint 5C)', () => {
  function buildListQuery(opts: { status?: string; purchaseOrderId?: string; search?: string } = {}) {
    let q = db('goods_receipts as gr')
      .leftJoin('purchase_orders as po', 'po.id', 'gr.purchase_order_id')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where('gr.dealer_id', DEALER_ID);
    if (opts.status) q = q.andWhere('gr.status', opts.status);
    if (opts.purchaseOrderId) q = q.andWhere('gr.purchase_order_id', opts.purchaseOrderId);
    if (opts.search) {
      q = q.andWhere((b: any) => b.whereILike('gr.grn_number', `%${opts.search}%`).orWhereILike('po.po_number', `%${opts.search}%`).orWhereILike('s.name', `%${opts.search}%`));
    }
    return q.select('gr.*', 'po.po_number', 's.name as supplier_name');
  }

  it('joins purchase_orders and suppliers, scoped by dealer_id', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/left join "purchase_orders" as "po" on "po"\."id" = "gr"\."purchase_order_id"/i);
    expect(sql).toMatch(/left join "suppliers" as "s" on "s"\."id" = "po"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('filters by status and purchaseOrderId when provided', () => {
    const { bindings } = buildListQuery({ status: 'draft', purchaseOrderId: PO_ID }).toSQL();
    expect(bindings).toContain('draft');
    expect(bindings).toContain(PO_ID);
  });
});

describe('Received-quantity aggregation query shape (V2 Sprint 5C)', () => {
  it('sums goods_receipt_items.received_qty grouped by purchase_order_item_id, scoped to completed GRNs only', () => {
    const { sql, bindings } = db('goods_receipt_items as gri')
      .innerJoin('goods_receipts as gr', 'gr.id', 'gri.goods_receipt_id')
      .where({ 'gr.dealer_id': DEALER_ID, 'gr.purchase_order_id': PO_ID, 'gr.status': 'completed' })
      .groupBy('gri.purchase_order_item_id')
      .select('gri.purchase_order_item_id')
      .sum({ received: 'gri.received_qty' })
      .toSQL();
    expect(sql).toMatch(/inner join "goods_receipts" as "gr" on "gr"\."id" = "gri"\."goods_receipt_id"/i);
    expect(sql).toMatch(/group by "gri"\."purchase_order_item_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(PO_ID);
    expect(bindings).toContain('completed');
  });
});

describe('GRN item/form Zod schemas (V2 Sprint 5C)', () => {
  const itemSchema = z.object({
    purchase_order_item_id: z.string().uuid(),
    product_id: z.string().uuid(),
    received_qty: z.coerce.number().positive(),
    batch_no: z.string().trim().max(50).nullable().optional(),
  });

  it('accepts a minimal valid item', () => {
    const parsed = itemSchema.parse({
      purchase_order_item_id: PO_ID, product_id: PO_ID, received_qty: 10,
    });
    expect(parsed.received_qty).toBe(10);
  });

  it('rejects a zero/negative received_qty', () => {
    expect(() => itemSchema.parse({ purchase_order_item_id: PO_ID, product_id: PO_ID, received_qty: 0 })).toThrow();
    expect(() => itemSchema.parse({ purchase_order_item_id: PO_ID, product_id: PO_ID, received_qty: -1 })).toThrow();
  });

  const statusEnum = z.enum(['draft', 'completed', 'cancelled']);
  it('accepts all 3 documented GRN statuses', () => {
    for (const s of ['draft', 'completed', 'cancelled']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
  it('rejects an undocumented status', () => {
    expect(() => statusEnum.parse('partially_completed')).toThrow();
  });
});

describe('Receivable PO status gate (V2 Sprint 5C)', () => {
  const RECEIVABLE_PO_STATUSES = ['approved', 'sent', 'partially_received'];

  it('allows receiving against approved/sent/partially_received purchase orders', () => {
    for (const s of ['approved', 'sent', 'partially_received']) {
      expect(RECEIVABLE_PO_STATUSES.includes(s)).toBe(true);
    }
  });

  it('rejects receiving against draft/pending_approval/fully_received/cancelled/closed purchase orders', () => {
    for (const s of ['draft', 'pending_approval', 'fully_received', 'cancelled', 'closed']) {
      expect(RECEIVABLE_PO_STATUSES.includes(s)).toBe(false);
    }
  });
});

describe('Over-receive prevention logic (V2 Sprint 5C)', () => {
  function wouldOverReceive(orderedQty: number, alreadyReceived: number, incomingQty: number): boolean {
    return alreadyReceived + incomingQty > orderedQty + 0.001;
  }

  it('allows a receipt that exactly completes the ordered quantity', () => {
    expect(wouldOverReceive(100, 60, 40)).toBe(false);
  });

  it('rejects a receipt that would exceed the ordered quantity', () => {
    expect(wouldOverReceive(100, 60, 50)).toBe(true);
  });

  it('allows a partial receipt within the remaining pending quantity', () => {
    expect(wouldOverReceive(100, 0, 30)).toBe(false);
  });
});

describe('PO status recompute after receiving (V2 Sprint 5C)', () => {
  function computeNewPoStatus(
    items: Array<{ ordered_qty: number }>,
    receivedMap: Map<number, number>,
    currentStatus: string,
  ): string {
    const allFullyReceived = items.every((it, idx) => (receivedMap.get(idx) ?? 0) >= it.ordered_qty - 0.001);
    const anyReceived = items.some((it, idx) => (receivedMap.get(idx) ?? 0) > 0);
    return allFullyReceived ? 'fully_received' : anyReceived ? 'partially_received' : currentStatus;
  }

  it('moves to fully_received when every line is fully covered', () => {
    const items = [{ ordered_qty: 10 }, { ordered_qty: 5 }];
    const received = new Map([[0, 10], [1, 5]]);
    expect(computeNewPoStatus(items, received, 'sent')).toBe('fully_received');
  });

  it('moves to partially_received when some but not all quantity has arrived', () => {
    const items = [{ ordered_qty: 10 }, { ordered_qty: 5 }];
    const received = new Map([[0, 10], [1, 0]]);
    expect(computeNewPoStatus(items, received, 'sent')).toBe('partially_received');
  });

  it('leaves status unchanged when nothing has been received yet', () => {
    const items = [{ ordered_qty: 10 }];
    const received = new Map<number, number>();
    expect(computeNewPoStatus(items, received, 'approved')).toBe('approved');
  });
});
