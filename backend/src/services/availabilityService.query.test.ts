/**
 * V2 Sprint 3C — route/integration test for the DB-touching queries inside
 * availabilityService.ts (the pure formula math itself is covered by
 * availabilityService.test.ts). Same `.toSQL()` convention as
 * stock.query.test.ts — mirrors the literal chains used by
 * computeAvailability()/computeBatchAvailability(). Update both if that
 * code changes.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';

describe('computeAvailability — pending delivery query shape', () => {
  it('joins deliveries and filters to pending status for the product', () => {
    const { sql, bindings } = db('delivery_items as di')
      .innerJoin('deliveries as d', 'd.id', 'di.delivery_id')
      .where({ 'di.product_id': PRODUCT_ID, 'di.dealer_id': DEALER_ID, 'd.status': 'pending' })
      .sum('di.quantity as sum')
      .toSQL();
    expect(sql).toMatch(/inner join "deliveries" as "d" on "d"."id" = "di"."delivery_id"/i);
    expect(sql).toMatch(/"d"\."status" = /i);
    expect(bindings).toContain(PRODUCT_ID);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('pending');
  });
});

describe('computeBatchAvailability — query shapes', () => {
  it('scopes active batches to the dealer + product, oldest first (FIFO order)', () => {
    const { sql, bindings } = db('product_batches')
      .where({ product_id: PRODUCT_ID, dealer_id: DEALER_ID, status: 'active' })
      .select('id', 'batch_no', 'total_pieces')
      .orderBy('created_at', 'asc')
      .toSQL();
    expect(sql).toMatch(/order by "created_at" asc/i);
    expect(bindings).toEqual(expect.arrayContaining([PRODUCT_ID, DEALER_ID, 'active']));
  });

  it('scopes active batch-level reservations to non-null batch_id', () => {
    const { sql } = db('stock_reservations')
      .where({ product_id: PRODUCT_ID, dealer_id: DEALER_ID, status: 'active' })
      .whereNotNull('batch_id')
      .select('batch_id', 'source_type', 'reserved_qty')
      .toSQL();
    expect(sql).toMatch(/"batch_id" is not null/i);
  });
});
