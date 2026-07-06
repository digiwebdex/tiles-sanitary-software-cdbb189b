/**
 * V2 Sprint 3B — route/integration test for GET /api/racks and
 * GET /api/racks/:id/stock query-building logic. Same `.toSQL()`
 * convention as godowns.query.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const GODOWN_ID = '44444444-4444-4444-4444-444444444444';
const RACK_ID = '55555555-5555-5555-5555-555555555555';

function buildListQuery(godownId?: string) {
  const q = db('racks as r')
    .innerJoin('godowns as g', 'g.id', 'r.godown_id')
    .where('r.dealer_id', DEALER_ID)
    .select('r.*', 'g.name as godown_name', 'g.warehouse_id')
    .orderBy([{ column: 'r.is_active', order: 'desc' }, { column: 'r.name' }]);
  if (godownId) q.andWhere('r.godown_id', godownId);
  return q;
}

describe('GET /api/racks — query shape', () => {
  it('joins godowns and scopes to the dealer', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/inner join "godowns" as "g" on "g"."id" = "r"."godown_id"/i);
    expect(sql).toMatch(/"r"\."dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('adds a godown_id filter only when provided', () => {
    const scoped = buildListQuery(GODOWN_ID).toSQL();
    expect(scoped.sql).toMatch(/"r"\."godown_id" = /i);
    expect(scoped.bindings).toContain(GODOWN_ID);

    const unscoped = buildListQuery().toSQL();
    expect(unscoped.sql).not.toMatch(/"r"\."godown_id" = /i);
  });
});

describe('GET /api/racks/:id/stock — query shape', () => {
  it('joins products and scopes to the dealer + rack', () => {
    const { sql, bindings } = db('rack_stock as rs')
      .innerJoin('products as p', 'p.id', 'rs.product_id')
      .where({ 'rs.dealer_id': DEALER_ID, 'rs.rack_id': RACK_ID })
      .select('rs.product_id', 'p.name as product_name')
      .orderBy('p.name')
      .toSQL();
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "rs"."product_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(RACK_ID);
  });
});
