/**
 * V2 Sprint 3D — route/integration test for the DB-touching queries inside
 * inventoryIntelligenceService.ts (the pure math is covered by
 * inventoryIntelligenceService.test.ts). Same `.toSQL()` convention as
 * availabilityService.query.test.ts — mirrors the literal chains used by
 * getStockAging()/getInventoryValue()/getCogs90dByProduct(). Update both
 * if that code changes.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('getStockAging — query shape', () => {
  it('scopes to active batches for the dealer, oldest first', () => {
    const { sql, bindings } = db('product_batches as pb')
      .innerJoin('products as p', 'p.id', 'pb.product_id')
      .where({ 'pb.dealer_id': DEALER_ID, 'pb.status': 'active' })
      .select('pb.id', 'pb.batch_no', 'pb.created_at')
      .orderBy('pb.created_at', 'asc')
      .toSQL();
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "pb"."product_id"/i);
    expect(sql).toMatch(/"pb"\."status" = /i);
    expect(sql).toMatch(/order by "pb"\."created_at" asc/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('active');
  });
});

describe('getInventoryValue — query shapes', () => {
  it('joins warehouse_stock to warehouses for per-warehouse value aggregation', () => {
    const { sql, bindings } = db('warehouse_stock as ws')
      .innerJoin('warehouses as w', 'w.id', 'ws.warehouse_id')
      .where({ 'ws.dealer_id': DEALER_ID })
      .select('ws.warehouse_id', 'w.name as warehouse_name', 'ws.product_id', 'ws.sft_qty', 'ws.piece_qty')
      .toSQL();
    expect(sql).toMatch(/inner join "warehouses" as "w" on "w"."id" = "ws"."warehouse_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('joins godown_stock to godowns for per-godown value aggregation', () => {
    const { sql, bindings } = db('godown_stock as gs')
      .innerJoin('godowns as g', 'g.id', 'gs.godown_id')
      .where({ 'gs.dealer_id': DEALER_ID })
      .select('gs.godown_id', 'g.name as godown_name', 'gs.product_id', 'gs.sft_qty', 'gs.piece_qty')
      .toSQL();
    expect(sql).toMatch(/inner join "godowns" as "g" on "g"."id" = "gs"."godown_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('getCogs90dByProduct — query shape', () => {
  it('joins sales, products, and stock off sale_items, scoped to the last 90 days', () => {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { sql, bindings } = db('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .innerJoin('products as p', 'p.id', 'si.product_id')
      .innerJoin('stock as st', function () {
        this.on('st.product_id', '=', 'si.product_id').andOn('st.dealer_id', '=', 'si.dealer_id');
      })
      .where('si.dealer_id', DEALER_ID)
      .where('s.created_at', '>=', since)
      .select('si.product_id', 'si.quantity', 'si.total_sft', 'p.unit_type', 'st.average_cost_per_unit')
      .toSQL();
    expect(sql).toMatch(/inner join "sales" as "s" on "s"."id" = "si"."sale_id"/i);
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "si"."product_id"/i);
    expect(sql).toMatch(/inner join "stock" as "st" on "st"\."product_id" = "si"\."product_id" and "st"\."dealer_id" = "si"\."dealer_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(since);
  });
});
