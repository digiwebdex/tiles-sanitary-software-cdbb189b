/**
 * V2 Sprint 5A — route/query-shape tests for Purchase Requests. Same
 * `.toSQL()` convention as salesOrders.query.test.ts (no live test DB in
 * this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

function buildListQuery(opts: { status?: string; department?: string; search?: string } = {}) {
  let q = db('purchase_requests').where({ dealer_id: DEALER_ID });
  if (opts.status) q = q.andWhere({ status: opts.status });
  if (opts.department) q = q.andWhere({ department: opts.department });
  if (opts.search) {
    q = q.andWhere(function () {
      this.whereILike('pr_number', `%${opts.search}%`).orWhereILike('department', `%${opts.search}%`);
    });
  }
  return q.select('*');
}

describe('GET /api/purchase-requests — query shape (V2 Sprint 5A)', () => {
  it('scopes by dealer_id', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/"dealer_id" = /i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('filters by status and department when provided', () => {
    const { bindings } = buildListQuery({ status: 'pending_approval', department: 'Sales' }).toSQL();
    expect(bindings).toContain('pending_approval');
    expect(bindings).toContain('Sales');
  });

  it('searches pr_number OR department', () => {
    const { sql, bindings } = buildListQuery({ search: 'PR-001' }).toSQL();
    expect(sql).toMatch(/"pr_number" ilike/i);
    expect(sql).toMatch(/"department" ilike/i);
    expect(bindings).toContain('%PR-001%');
  });
});

describe('Purchase Request form/item Zod schemas (V2 Sprint 5A)', () => {
  const itemSchema = z.object({
    product_id: z.string().uuid().nullable().optional(),
    product_name_snapshot: z.string().min(1),
    requested_qty: z.coerce.number().positive(),
    source: z.enum(['manual', 'reorder_suggestion']).default('manual'),
  });

  it('accepts a minimal valid item and defaults source to manual', () => {
    const parsed = itemSchema.parse({ product_name_snapshot: 'Glossy Tile 600x600', requested_qty: 10 });
    expect(parsed.source).toBe('manual');
  });

  it('rejects a zero/negative requested_qty', () => {
    expect(() => itemSchema.parse({ product_name_snapshot: 'X', requested_qty: 0 })).toThrow();
    expect(() => itemSchema.parse({ product_name_snapshot: 'X', requested_qty: -1 })).toThrow();
  });

  it('rejects an empty product_name_snapshot', () => {
    expect(() => itemSchema.parse({ product_name_snapshot: '', requested_qty: 1 })).toThrow();
  });

  it('accepts source=reorder_suggestion for Purchase Planning prefill', () => {
    const parsed = itemSchema.parse({ product_name_snapshot: 'X', requested_qty: 5, source: 'reorder_suggestion' });
    expect(parsed.source).toBe('reorder_suggestion');
  });

  const statusEnum = z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled']);
  it('accepts all 5 documented Purchase Request statuses', () => {
    for (const s of ['draft', 'pending_approval', 'approved', 'rejected', 'cancelled']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
  it('rejects an undocumented status', () => {
    expect(() => statusEnum.parse('submitted')).toThrow();
  });

  const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
  it('requires a non-empty rejection reason', () => {
    expect(() => rejectSchema.parse({ reason: '' })).toThrow();
    expect(() => rejectSchema.parse({ reason: '   ' })).toThrow();
    expect(rejectSchema.parse({ reason: 'Budget exceeded' }).reason).toBe('Budget exceeded');
  });
});

describe('Purchase Request numbering (generate_next_purchase_request_no) — call shape', () => {
  it('is invoked with the dealer id cast to uuid, matching generate_next_sales_order_no', () => {
    const { sql, bindings } = db.raw('SELECT generate_next_purchase_request_no(?::uuid) AS no', [DEALER_ID]).toSQL();
    expect(sql).toMatch(/generate_next_purchase_request_no\(\?::uuid\)/);
    expect(bindings).toEqual([DEALER_ID]);
  });
});
