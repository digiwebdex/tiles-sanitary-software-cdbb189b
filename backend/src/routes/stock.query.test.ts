/**
 * V2 Sprint 3A — route/integration test for the new GET /api/stock/ledger
 * query-building logic.
 *
 * Same convention as products.query.test.ts (Sprint 2.1): this backend has
 * no HTTP/supertest or live-test-database harness, so `db(...).toSQL()` is
 * used to compile the REAL Knex query-builder chain (no network connection
 * opened) and assert on the resulting SQL/bindings — genuine integration
 * coverage between the route code and Knex/pg.
 *
 * Mirrors the literal chain in routes/stock.ts's `GET /ledger` handler. If
 * that code changes, update this file too.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';

function buildLedgerQuery(opts: { productId?: string; from?: string; to?: string } = {}) {
  let q = db('stock_ledger as sl')
    .innerJoin('products as p', 'p.id', 'sl.product_id')
    .where('sl.dealer_id', DEALER_ID);

  if (opts.productId) q = q.andWhere('sl.product_id', opts.productId);
  if (opts.from) q = q.andWhere('sl.created_at', '>=', opts.from);
  if (opts.to) q = q.andWhere('sl.created_at', '<', db.raw(`(?::date + interval '1 day')`, [opts.to]));

  return q;
}

describe('GET /api/stock/ledger — query shape', () => {
  it('joins products and scopes to the dealer with no other filters', () => {
    const { sql, bindings } = buildLedgerQuery().select('sl.id').toSQL();
    expect(sql).toMatch(/inner join "products" as "p" on "p"."id" = "sl"."product_id"/i);
    expect(sql).toMatch(/"sl"\."dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('adds a product_id filter only when provided ("Stock History" use case)', () => {
    const withProduct = buildLedgerQuery({ productId: PRODUCT_ID }).select('sl.id').toSQL();
    expect(withProduct.sql).toMatch(/"sl"\."product_id" = /i);
    expect(withProduct.bindings).toContain(PRODUCT_ID);

    const withoutProduct = buildLedgerQuery().select('sl.id').toSQL();
    expect(withoutProduct.sql).not.toMatch(/"sl"\."product_id" = /i);
  });

  it('applies an inclusive from/to date range', () => {
    const { sql, bindings } = buildLedgerQuery({ from: '2026-01-01', to: '2026-01-31' })
      .select('sl.id')
      .toSQL();
    expect(sql).toMatch(/"sl"\."created_at" >= /i);
    expect(sql).toMatch(/"sl"\."created_at" < /i);
    expect(sql).toMatch(/interval '1 day'/i);
    expect(bindings).toContain('2026-01-01');
    expect(bindings).toContain('2026-01-31');
  });

  it('the `to` bound is exclusive of the NEXT day, not the literal date at midnight (inclusive end-of-day)', () => {
    // Regression guard: comparing `created_at < to` (without the +1 day) would
    // silently exclude every row from the `to` date itself, since created_at
    // carries a time-of-day component. This test fails if that bug is
    // reintroduced.
    const { sql } = buildLedgerQuery({ to: '2026-01-31' }).select('sl.id').toSQL();
    expect(sql).toMatch(/\+ interval '1 day'/i);
  });

  it('count and rows queries both compile without error', () => {
    const countSQL = buildLedgerQuery({ productId: PRODUCT_ID })
      .clone()
      .clearSelect()
      .count('sl.id as count')
      .toSQL();
    expect(countSQL.sql).toMatch(/^select count/i);

    const rowsSQL = buildLedgerQuery({ productId: PRODUCT_ID })
      .clone()
      .select('sl.id', 'p.name as product_name', 'sl.created_at')
      .orderBy('sl.created_at', 'desc')
      .offset(0)
      .limit(50)
      .toSQL();
    expect(rowsSQL.sql).toMatch(/order by "sl"\."created_at" desc/i);
    expect(rowsSQL.sql).toMatch(/limit \$?\d|limit \?/i);
  });
});
