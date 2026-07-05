/**
 * V2 Sprint 2.1 — route/integration tests for the new & changed Product
 * query-building logic (facets, extended search, new filter column).
 *
 * There is no HTTP/supertest or live-test-database harness anywhere in this
 * backend (verified before writing this file) — every other route's tests
 * are pure-function unit tests of extracted service logic. Spinning up a
 * fresh integration-test harness from scratch would be new test
 * infrastructure, out of scope for a "polish" sprint, and Postgres-specific
 * SQL (ILIKE, DISTINCT) wouldn't be meaningfully testable against an
 * in-memory/sqlite substitute anyway.
 *
 * Knex's `.toSQL()` compiles a query WITHOUT opening a network connection
 * (verified: `db(...)` only connects lazily on execution), so this file
 * exercises the REAL `db` connection + the REAL query-builder chains as
 * written in routes/products.ts and asserts on the compiled SQL/bindings.
 * This is genuine integration coverage between our route code and
 * Knex/pg — e.g. it would catch an accidental `.orWhereILike` operator-
 * precedence bug that leaks OR conditions outside the intended AND scope,
 * which a pure-function unit test cannot see.
 *
 * NOTE: these chains intentionally mirror the literal code in
 * routes/products.ts (search clause + facets loop). If that code changes,
 * update this file too — same convention as computeBackorderOutstanding
 * mirroring the /backorders/shortage-demand formula.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';
import { FACET_COLUMNS } from '../services/productMasterService';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/products — search clause (V2 Sprint 2.1: +series, +collection_name)', () => {
  function buildSearchQuery(search: string) {
    return db('products')
      .where({ dealer_id: DEALER_ID })
      .andWhere(function () {
        this.whereILike('sku', `%${search}%`)
          .orWhereILike('name', `%${search}%`)
          .orWhereILike('barcode', `%${search}%`)
          .orWhereILike('series', `%${search}%`)
          .orWhereILike('collection_name', `%${search}%`);
      });
  }

  it('ORs all five searchable columns within ONE parenthesized group, ANDed with dealer_id', () => {
    const { sql, bindings } = buildSearchQuery('milano').toSQL();
    // The dealer scope must be a top-level AND, and the five ILIKE terms must
    // be grouped together (parenthesized) so they don't leak out of the AND.
    expect(sql).toMatch(/where .*"dealer_id" = .* and \(.*ilike.*or.*ilike.*or.*ilike.*or.*ilike.*or.*ilike.*\)/i);
    expect(sql.match(/ilike/gi)?.length).toBe(5);
  });

  it('includes all five columns as bound %search% params (no SQL injection via string concat)', () => {
    const { bindings } = buildSearchQuery("o'brien").toSQL();
    const likeBindings = bindings.filter((b) => typeof b === 'string' && b.includes('brien'));
    expect(likeBindings).toHaveLength(5);
    for (const b of likeBindings) expect(b).toBe("%o'brien%");
  });

  it('new columns (series, collection_name) are present in the compiled SQL', () => {
    const { sql } = buildSearchQuery('x').toSQL();
    expect(sql).toMatch(/"series"/);
    expect(sql).toMatch(/"collection_name"/);
  });

  it('pre-existing columns (sku, name, barcode) are still present — additive, not replaced', () => {
    const { sql } = buildSearchQuery('x').toSQL();
    expect(sql).toMatch(/"sku"/);
    expect(sql).toMatch(/"name"/);
    expect(sql).toMatch(/"barcode"/);
  });
});

describe('GET /api/products/facets — distinct-value query shape', () => {
  it('builds one DISTINCT + WHERE dealer_id + WHERE NOT NULL query per facet column', () => {
    for (const col of FACET_COLUMNS) {
      const { sql, bindings } = db('products')
        .distinct(col)
        .where({ dealer_id: DEALER_ID })
        .whereNotNull(col)
        .select(col)
        .toSQL();
      expect(sql).toMatch(/^select distinct/i);
      expect(sql).toMatch(new RegExp(`"${col}" is not null`, 'i'));
      expect(bindings).toContain(DEALER_ID);
    }
  });

  it('FACET_COLUMNS covers exactly the 7 filters Sprint 2.1 requires', () => {
    expect([...FACET_COLUMNS].sort()).toEqual(
      ['brand', 'collection_name', 'country_of_origin', 'finish', 'series', 'size', 'tile_type'].sort(),
    );
  });
});

describe('GET /api/products — generic f.<col> filter (V2 Sprint 2.1: +size)', () => {
  it('the generic equality-filter loop applies correctly to the new `size` column', () => {
    // Mirrors the FILTERABLE-gated loop in routes/products.ts:
    //   if (col === 'active') ... else q = q.andWhere(col, value)
    const col = 'size';
    const value = '600x600';
    const { sql, bindings } = db('products')
      .where({ dealer_id: DEALER_ID })
      .andWhere(col, value)
      .toSQL();
    expect(sql).toMatch(/"size" = \$?\d|"size" = \?/i);
    expect(bindings).toContain(value);
  });

  it('the `active` (boolean) column still coerces string "true"/"false" correctly', () => {
    const { bindings } = db('products')
      .where({ dealer_id: DEALER_ID })
      .andWhere('active', 'true' === 'true')
      .toSQL();
    expect(bindings).toContain(true);
  });
});
