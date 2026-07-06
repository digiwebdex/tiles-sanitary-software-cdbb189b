/**
 * V2 Sprint 3C — route/integration test for the EXTENDED GET /api/reservations
 * list query (new warehouse/godown/rack joins + `kind` filter) and the
 * CreateSchema/EditSchema Zod defaults. Same `.toSQL()` convention as
 * godowns.query.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

function buildListQuery(kind?: 'reservation' | 'allocation') {
  let q = db('stock_reservations as sr')
    .leftJoin('products as p', 'p.id', 'sr.product_id')
    .leftJoin('customers as c', 'c.id', 'sr.customer_id')
    .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
    .leftJoin('warehouses as w', 'w.id', 'sr.warehouse_id')
    .leftJoin('godowns as g', 'g.id', 'sr.godown_id')
    .leftJoin('racks as rk', 'rk.id', 'sr.rack_id')
    .where({ 'sr.dealer_id': DEALER_ID })
    .select('sr.*', 'w.name as warehouse_name', 'g.name as godown_name', 'rk.name as rack_name')
    .orderBy('sr.created_at', 'desc');
  if (kind === 'allocation') q = q.andWhere('sr.source_type', 'allocation');
  else if (kind === 'reservation') q = q.andWhereNot('sr.source_type', 'allocation');
  return q;
}

describe('GET /api/reservations — query shape (V2 Sprint 3C extension)', () => {
  it('joins warehouses, godowns, and racks alongside the existing product/customer/batch joins', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/left join "warehouses" as "w" on "w"."id" = "sr"."warehouse_id"/i);
    expect(sql).toMatch(/left join "godowns" as "g" on "g"."id" = "sr"."godown_id"/i);
    expect(sql).toMatch(/left join "racks" as "rk" on "rk"."id" = "sr"."rack_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('kind=allocation filters to source_type=allocation only', () => {
    const { sql, bindings } = buildListQuery('allocation').toSQL();
    expect(sql).toMatch(/"sr"\."source_type" = /i);
    expect(bindings).toContain('allocation');
  });

  it('kind=reservation excludes source_type=allocation', () => {
    const { sql, bindings } = buildListQuery('reservation').toSQL();
    expect(sql).toMatch(/not "sr"\."source_type" = /i);
    expect(bindings).toContain('allocation');
  });

  it('no kind filter applies neither branch', () => {
    const { sql } = buildListQuery().toSQL();
    expect(sql).not.toMatch(/"sr"\."source_type"/i);
  });
});

describe('CreateSchema / EditSchema defaults (V2 Sprint 3C)', () => {
  const CreateSchema = z.object({
    kind: z.enum(['reservation', 'allocation']).default('reservation'),
    priority: z.coerce.number().int().min(0).max(100).default(0),
    warehouse_id: z.string().uuid().nullable().optional(),
  });

  it('defaults kind to "reservation" and priority to 0 when omitted', () => {
    const parsed = CreateSchema.parse({});
    expect(parsed.kind).toBe('reservation');
    expect(parsed.priority).toBe(0);
  });

  it('accepts an explicit kind="allocation" with a priority', () => {
    const parsed = CreateSchema.parse({ kind: 'allocation', priority: 50 });
    expect(parsed.kind).toBe('allocation');
    expect(parsed.priority).toBe(50);
  });

  it('rejects a priority outside 0-100', () => {
    expect(() => CreateSchema.parse({ priority: 500 })).toThrow();
  });
});
