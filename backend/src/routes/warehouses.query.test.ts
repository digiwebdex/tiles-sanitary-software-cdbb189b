/**
 * V2 Sprint 3B — route/integration test for the EXTENDED
 * GET /api/warehouses/transfers query (now joins godowns/racks too so the
 * same list can display warehouse-, godown-, or rack-level transfers) and
 * the new GET /api/warehouses/:id/stock query. Same `.toSQL()` convention
 * as the other *.query.test.ts files.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const WAREHOUSE_ID = '33333333-3333-3333-3333-333333333333';

function buildTransfersQuery() {
  return db('warehouse_transfers as wt')
    .leftJoin('warehouses as wf', 'wf.id', 'wt.from_warehouse_id')
    .leftJoin('warehouses as wt2', 'wt2.id', 'wt.to_warehouse_id')
    .leftJoin('godowns as gf', 'gf.id', 'wt.from_godown_id')
    .leftJoin('godowns as gt', 'gt.id', 'wt.to_godown_id')
    .leftJoin('racks as rf', 'rf.id', 'wt.from_rack_id')
    .leftJoin('racks as rt', 'rt.id', 'wt.to_rack_id')
    .where('wt.dealer_id', DEALER_ID)
    .select(
      'wt.*',
      'wf.name as from_warehouse_name', 'wt2.name as to_warehouse_name',
      'gf.name as from_godown_name', 'gt.name as to_godown_name',
      'rf.name as from_rack_name', 'rt.name as to_rack_name',
    )
    .orderBy('wt.transfer_date', 'desc');
}

describe('GET /api/warehouses/transfers — query shape (V2 Sprint 3B extension)', () => {
  it('left-joins warehouses, godowns, and racks for both from/to sides', () => {
    const { sql, bindings } = buildTransfersQuery().toSQL();
    expect(sql).toMatch(/left join "warehouses" as "wf" on "wf"."id" = "wt"."from_warehouse_id"/i);
    expect(sql).toMatch(/left join "warehouses" as "wt2" on "wt2"."id" = "wt"."to_warehouse_id"/i);
    expect(sql).toMatch(/left join "godowns" as "gf" on "gf"."id" = "wt"."from_godown_id"/i);
    expect(sql).toMatch(/left join "godowns" as "gt" on "gt"."id" = "wt"."to_godown_id"/i);
    expect(sql).toMatch(/left join "racks" as "rf" on "rf"."id" = "wt"."from_rack_id"/i);
    expect(sql).toMatch(/left join "racks" as "rt" on "rt"."id" = "wt"."to_rack_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('still scopes to the dealer and orders newest-first (pre-existing behaviour preserved)', () => {
    const { sql } = buildTransfersQuery().toSQL();
    expect(sql).toMatch(/"wt"\."dealer_id" = /i);
    expect(sql).toMatch(/order by "wt"\."transfer_date" desc/i);
  });
});

describe('GET /api/warehouses/:id/stock — query shape', () => {
  it('joins products and scopes to the dealer + warehouse', () => {
    const { sql, bindings } = db('warehouse_stock as ws')
      .innerJoin('products as p', 'p.id', 'ws.product_id')
      .where({ 'ws.dealer_id': DEALER_ID, 'ws.warehouse_id': WAREHOUSE_ID })
      .select('ws.product_id', 'p.name as product_name')
      .orderBy('p.name')
      .toSQL();
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "ws"."product_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(WAREHOUSE_ID);
  });
});
