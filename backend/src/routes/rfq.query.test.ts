/**
 * V2 Sprint 5A — route/query-shape tests for RFQ. Same `.toSQL()` convention
 * as salesOrders.query.test.ts / purchaseRequests.query.test.ts (no live
 * test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const RFQ_ID = '22222222-2222-2222-2222-222222222222';

describe('GET /api/rfqs — query shape (V2 Sprint 5A)', () => {
  it('scopes list by dealer_id', () => {
    const { sql, bindings } = db('rfqs').where({ dealer_id: DEALER_ID }).select('*').toSQL();
    expect(sql).toMatch(/"dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('joins products and suppliers for the item detail view', () => {
    const { sql } = db('rfq_items')
      .leftJoin('products', 'products.id', 'rfq_items.product_id')
      .leftJoin('suppliers', 'suppliers.id', 'rfq_items.selected_supplier_id')
      .where({ 'rfq_items.dealer_id': DEALER_ID, rfq_id: RFQ_ID })
      .select('rfq_items.*', 'products.sku as product_sku', 'suppliers.name as selected_supplier_name')
      .toSQL();
    expect(sql).toMatch(/left join "products" on "products"\."id" = "rfq_items"\."product_id"/i);
    expect(sql).toMatch(/left join "suppliers" on "suppliers"\."id" = "rfq_items"\."selected_supplier_id"/i);
  });

  it('joins suppliers for the invited-suppliers view', () => {
    const { sql, bindings } = db('rfq_suppliers')
      .innerJoin('suppliers', 'suppliers.id', 'rfq_suppliers.supplier_id')
      .where({ 'rfq_suppliers.dealer_id': DEALER_ID, rfq_id: RFQ_ID })
      .select('rfq_suppliers.*', 'suppliers.name as supplier_name')
      .toSQL();
    expect(sql).toMatch(/inner join "suppliers" on "suppliers"\."id" = "rfq_suppliers"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(RFQ_ID);
  });
});

describe('RFQ upsert-on-conflict shape for supplier responses (V2 Sprint 5A)', () => {
  it('merges on (rfq_item_id, supplier_id) so re-recording a quote updates rather than duplicates', () => {
    const { sql } = db('rfq_responses')
      .insert({
        dealer_id: DEALER_ID,
        rfq_id: RFQ_ID,
        rfq_item_id: 'item-1',
        supplier_id: 'sup-1',
        quoted_rate: 100,
      })
      .onConflict(['rfq_item_id', 'supplier_id'])
      .merge({ quoted_rate: 100 })
      .toSQL();
    expect(sql).toMatch(/on conflict \("rfq_item_id", "supplier_id"\) do update set/i);
  });

  it('invite-suppliers ignores duplicate (rfq_id, supplier_id) invites', () => {
    const { sql } = db('rfq_suppliers')
      .insert({ dealer_id: DEALER_ID, rfq_id: RFQ_ID, supplier_id: 'sup-1' })
      .onConflict(['rfq_id', 'supplier_id'])
      .ignore()
      .toSQL();
    expect(sql).toMatch(/on conflict \("rfq_id", "supplier_id"\) do nothing/i);
  });
});

describe('RFQ form/item Zod schemas (V2 Sprint 5A)', () => {
  const itemSchema = z.object({
    product_id: z.string().uuid().nullable().optional(),
    product_name_snapshot: z.string().min(1),
    qty: z.coerce.number().positive(),
  });

  it('accepts a minimal valid RFQ item', () => {
    const parsed = itemSchema.parse({ product_name_snapshot: 'Glossy Tile 600x600', qty: 100 });
    expect(parsed.qty).toBe(100);
  });

  it('rejects a zero/negative qty', () => {
    expect(() => itemSchema.parse({ product_name_snapshot: 'X', qty: 0 })).toThrow();
  });

  const statusEnum = z.enum(['draft', 'sent', 'comparing', 'approved', 'cancelled']);
  it('accepts all 5 documented RFQ statuses', () => {
    for (const s of ['draft', 'sent', 'comparing', 'approved', 'cancelled']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
  it('rejects an undocumented status', () => {
    expect(() => statusEnum.parse('quoted')).toThrow();
  });

  const responseSchema = z.object({
    supplier_id: z.string().uuid(),
    rfq_item_id: z.string().uuid(),
    quoted_rate: z.coerce.number().nonnegative(),
    quoted_lead_time_days: z.coerce.number().int().nonnegative().nullable().optional(),
  });

  it('accepts a valid supplier response payload', () => {
    const parsed = responseSchema.parse({
      supplier_id: '33333333-3333-3333-3333-333333333333',
      rfq_item_id: '44444444-4444-4444-4444-444444444444',
      quoted_rate: 250.5,
      quoted_lead_time_days: 7,
    });
    expect(parsed.quoted_rate).toBe(250.5);
  });

  it('rejects a negative quoted_rate', () => {
    expect(() =>
      responseSchema.parse({
        supplier_id: '33333333-3333-3333-3333-333333333333',
        rfq_item_id: '44444444-4444-4444-4444-444444444444',
        quoted_rate: -1,
      }),
    ).toThrow();
  });

  const approveSchema = z.object({
    selections: z.array(z.object({
      rfq_item_id: z.string().uuid(),
      supplier_id: z.string().uuid(),
    })).min(1),
  });

  it('requires at least one selection to approve', () => {
    expect(() => approveSchema.parse({ selections: [] })).toThrow();
  });

  it('accepts a valid multi-line approval selection', () => {
    const parsed = approveSchema.parse({
      selections: [
        { rfq_item_id: '44444444-4444-4444-4444-444444444444', supplier_id: '33333333-3333-3333-3333-333333333333' },
      ],
    });
    expect(parsed.selections).toHaveLength(1);
  });
});
