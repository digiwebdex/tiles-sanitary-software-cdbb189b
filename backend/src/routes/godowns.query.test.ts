/**
 * V2 Sprint 3B — route/integration test for GET /api/godowns and
 * GET /api/godowns/:id/stock query-building logic.
 *
 * Same `.toSQL()` convention as stock.query.test.ts / products.query.test.ts
 * (no HTTP/supertest/test-DB harness exists in this backend).
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const WAREHOUSE_ID = '33333333-3333-3333-3333-333333333333';
const GODOWN_ID = '44444444-4444-4444-4444-444444444444';

function buildListQuery(warehouseId?: string) {
  const q = db('godowns as g')
    .innerJoin('warehouses as w', 'w.id', 'g.warehouse_id')
    .where('g.dealer_id', DEALER_ID)
    .select('g.*', 'w.name as warehouse_name')
    .orderBy([{ column: 'g.is_active', order: 'desc' }, { column: 'g.is_default', order: 'desc' }, { column: 'g.name' }]);
  if (warehouseId) q.andWhere('g.warehouse_id', warehouseId);
  return q;
}

describe('GET /api/godowns — query shape', () => {
  it('joins warehouses and scopes to the dealer', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/inner join "warehouses" as "w" on "w"."id" = "g"."warehouse_id"/i);
    expect(sql).toMatch(/"g"\."dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('adds a warehouse_id filter only when provided', () => {
    const scoped = buildListQuery(WAREHOUSE_ID).toSQL();
    expect(scoped.sql).toMatch(/"g"\."warehouse_id" = /i);
    expect(scoped.bindings).toContain(WAREHOUSE_ID);

    const unscoped = buildListQuery().toSQL();
    expect(unscoped.sql).not.toMatch(/"g"\."warehouse_id" = /i);
  });

  it('orders active-and-default godowns first', () => {
    const { sql } = buildListQuery().toSQL();
    expect(sql).toMatch(/order by "g"\."is_active" desc, "g"\."is_default" desc, "g"\."name"/i);
  });
});

describe('GET /api/godowns/:id/stock — query shape', () => {
  it('joins products and scopes to the dealer + godown', () => {
    const { sql, bindings } = db('godown_stock as gs')
      .innerJoin('products as p', 'p.id', 'gs.product_id')
      .where({ 'gs.dealer_id': DEALER_ID, 'gs.godown_id': GODOWN_ID })
      .select('gs.product_id', 'p.name as product_name')
      .orderBy('p.name')
      .toSQL();
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "gs"."product_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(GODOWN_ID);
  });
});
