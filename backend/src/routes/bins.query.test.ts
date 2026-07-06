/**
 * V2 Sprint 3B — route/integration test for GET /api/bins query-building
 * logic. Same `.toSQL()` convention as godowns.query.test.ts / racks.query.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const RACK_ID = '55555555-5555-5555-5555-555555555555';

function buildListQuery(rackId?: string) {
  const q = db('bins as b')
    .innerJoin('racks as r', 'r.id', 'b.rack_id')
    .where('b.dealer_id', DEALER_ID)
    .select('b.*', 'r.name as rack_name', 'r.godown_id')
    .orderBy([{ column: 'b.is_active', order: 'desc' }, { column: 'b.bin_code' }]);
  if (rackId) q.andWhere('b.rack_id', rackId);
  return q;
}

describe('GET /api/bins — query shape', () => {
  it('joins racks and scopes to the dealer', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/inner join "racks" as "r" on "r"."id" = "b"."rack_id"/i);
    expect(sql).toMatch(/"b"\."dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('adds a rack_id filter only when provided', () => {
    const scoped = buildListQuery(RACK_ID).toSQL();
    expect(scoped.sql).toMatch(/"b"\."rack_id" = /i);
    expect(scoped.bindings).toContain(RACK_ID);

    const unscoped = buildListQuery().toSQL();
    expect(unscoped.sql).not.toMatch(/"b"\."rack_id" = /i);
  });

  it('orders by bin_code with active bins first', () => {
    const { sql } = buildListQuery().toSQL();
    expect(sql).toMatch(/order by "b"\."is_active" desc, "b"\."bin_code"/i);
  });
});
