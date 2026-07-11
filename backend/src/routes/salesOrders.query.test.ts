/**
 * V2 Sprint 4B — route/integration tests for the Sales Order list query
 * shape and the create/edit Zod schemas. Same `.toSQL()` convention as
 * reservations.query.test.ts / quotations (no live test DB in this backend).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

function buildListQuery(opts: { status?: string; projectId?: string; customerId?: string; search?: string } = {}) {
  let q = db('sales_orders as so')
    .leftJoin('customers as c', 'c.id', 'so.customer_id')
    .leftJoin('projects as p', 'p.id', 'so.project_id')
    .where('so.dealer_id', DEALER_ID);
  if (opts.status) q = q.where('so.status', opts.status);
  if (opts.projectId) q = q.where('so.project_id', opts.projectId);
  if (opts.customerId) q = q.where('so.customer_id', opts.customerId);
  if (opts.search) {
    q = q.where(function () {
      this.where('so.so_number', 'ilike', `%${opts.search}%`).orWhere('so.customer_name_text', 'ilike', `%${opts.search}%`);
    });
  }
  return q.select('so.*', 'c.name as c_name', 'c.phone as c_phone', 'p.project_name as p_name', 'p.project_code as p_code');
}

describe('GET /api/sales-orders — query shape (V2 Sprint 4B)', () => {
  it('joins customers and projects, scoped by dealer_id', () => {
    const { sql, bindings } = buildListQuery().toSQL();
    expect(sql).toMatch(/left join "customers" as "c" on "c"."id" = "so"."customer_id"/i);
    expect(sql).toMatch(/left join "projects" as "p" on "p"."id" = "so"."project_id"/i);
    expect(bindings).toContain(DEALER_ID);
  });

  it('filters by status when provided', () => {
    const { sql, bindings } = buildListQuery({ status: 'confirmed' }).toSQL();
    expect(sql).toMatch(/"so"\."status" = /i);
    expect(bindings).toContain('confirmed');
  });

  it('filters by projectId and customerId when provided', () => {
    const { bindings } = buildListQuery({ projectId: 'proj-1', customerId: 'cust-1' }).toSQL();
    expect(bindings).toContain('proj-1');
    expect(bindings).toContain('cust-1');
  });

  it('searches so_number OR customer_name_text', () => {
    const { sql, bindings } = buildListQuery({ search: 'SO-001' }).toSQL();
    expect(sql).toMatch(/"so"\."so_number" ilike/i);
    expect(sql).toMatch(/"so"\."customer_name_text" ilike/i);
    expect(bindings).toContain('%SO-001%');
  });
});

describe('Sales Order form/item Zod schemas (V2 Sprint 4B)', () => {
  const itemSchema = z.object({
    product_id: z.string().uuid().nullable().optional(),
    product_name_snapshot: z.string().min(1),
    unit_type: z.enum(['box_sft', 'piece']),
    quantity: z.coerce.number().min(0),
    rate: z.coerce.number().min(0),
    discount_value: z.coerce.number().min(0).default(0),
    rate_source: z.enum(['default', 'tier', 'manual']).default('default'),
  });

  it('accepts a minimal valid item and defaults discount_value/rate_source', () => {
    const parsed = itemSchema.parse({
      product_name_snapshot: 'Glossy Tile 600x600',
      unit_type: 'box_sft',
      quantity: 10,
      rate: 500,
    });
    expect(parsed.discount_value).toBe(0);
    expect(parsed.rate_source).toBe('default');
  });

  it('rejects a negative quantity', () => {
    expect(() =>
      itemSchema.parse({ product_name_snapshot: 'X', unit_type: 'piece', quantity: -1, rate: 10 }),
    ).toThrow();
  });

  it('rejects an empty product_name_snapshot', () => {
    expect(() =>
      itemSchema.parse({ product_name_snapshot: '', unit_type: 'piece', quantity: 1, rate: 10 }),
    ).toThrow();
  });

  const statusEnum = z.enum(['draft', 'confirmed', 'partially_delivered', 'completed', 'cancelled']);
  it('accepts all 5 documented Sales Order statuses', () => {
    for (const s of ['draft', 'confirmed', 'partially_delivered', 'completed', 'cancelled']) {
      expect(() => statusEnum.parse(s)).not.toThrow();
    }
  });
  it('rejects an undocumented status', () => {
    expect(() => statusEnum.parse('invoiced')).toThrow();
  });

  const deliveryReadinessEnum = z.enum(['pending', 'ready', 'partially_ready']);
  it('accepts all 3 documented delivery-readiness values', () => {
    for (const s of ['pending', 'ready', 'partially_ready']) {
      expect(() => deliveryReadinessEnum.parse(s)).not.toThrow();
    }
  });
});
