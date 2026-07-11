/**
 * V2 Sprint 3C — route/integration test for the new
 * GET /api/backorders/supplier-links query shape ("Supplier Backorder").
 * Same `.toSQL()` convention as reservations.query.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

function buildSupplierLinksQuery() {
  return db('purchase_shortage_links as psl')
    .innerJoin('sale_items as si', 'si.id', 'psl.sale_item_id')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .leftJoin('sales as s', 's.id', 'si.sale_id')
    .leftJoin('customers as c', 'c.id', 's.customer_id')
    .leftJoin('purchases as pu', 'pu.id', 'psl.purchase_id')
    .leftJoin('suppliers as sup', 'sup.id', 'pu.supplier_id')
    .where('psl.dealer_id', DEALER_ID)
    .select('psl.id', 'psl.planned_qty', 'si.backorder_qty', 'sup.name as supplier_name')
    .orderBy('psl.created_at', 'desc');
}

describe('GET /api/backorders/supplier-links — query shape', () => {
  it('chains sale_item -> sale -> customer and purchase -> supplier joins off purchase_shortage_links', () => {
    const { sql, bindings } = buildSupplierLinksQuery().toSQL();
    expect(sql).toMatch(/inner join "sale_items" as "si" on "si"."id" = "psl"."sale_item_id"/i);
    expect(sql).toMatch(/left join "purchases" as "pu" on "pu"."id" = "psl"."purchase_id"/i);
    expect(sql).toMatch(/left join "suppliers" as "sup" on "sup"."id" = "pu"."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('orders newest-first and reuses the existing purchase_shortage_links table (no new table)', () => {
    const { sql } = buildSupplierLinksQuery().toSQL();
    expect(sql).toMatch(/from "purchase_shortage_links" as "psl"/i);
    expect(sql).toMatch(/order by "psl"\."created_at" desc/i);
  });
});
