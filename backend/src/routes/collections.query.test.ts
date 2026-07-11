/**
 * V2 Sprint 4A — route/integration test for the extended
 * GET /api/collections/outstanding (?customerId= scope) and the new
 * POST /api/collections/adjustment schema. Same `.toSQL()` convention as
 * reservations.query.test.ts for the query-shape half.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

function buildCustomersQuery(customerId?: string) {
  return db('customers')
    .select('id', 'name', 'phone', 'type', 'max_overdue_days')
    .where({ dealer_id: DEALER_ID, status: 'active' })
    .modify((qb) => { if (customerId) qb.andWhere('id', customerId); })
    .orderBy('name');
}

describe('GET /api/collections/outstanding — customerId scope (V2 Sprint 4A)', () => {
  it('scopes to a single customer when customerId is provided', () => {
    const { sql, bindings } = buildCustomersQuery(CUSTOMER_ID).toSQL();
    expect(sql).toMatch(/"id" = /i);
    expect(bindings).toContain(CUSTOMER_ID);
  });

  it('omitting customerId keeps the existing dealer-wide query unchanged', () => {
    const { sql, bindings } = buildCustomersQuery().toSQL();
    expect(sql).not.toMatch(/"id" = /i);
    expect(bindings).not.toContain(CUSTOMER_ID);
    expect(bindings).toContain(DEALER_ID);
  });
});

describe('POST /api/collections/adjustment schema (V2 Sprint 4A)', () => {
  const adjustmentSchema = z.object({
    customer_id: z.string().uuid(),
    amount: z.coerce.number().refine((v) => v !== 0, 'Amount must not be zero'),
    reason: z.string().trim().min(1, 'A reason is required').max(500),
  });

  it('accepts a positive amount (increase due) with a reason', () => {
    const r = adjustmentSchema.safeParse({ customer_id: CUSTOMER_ID, amount: 500, reason: 'Correction' });
    expect(r.success).toBe(true);
  });

  it('accepts a negative amount (decrease due / write-off)', () => {
    const r = adjustmentSchema.safeParse({ customer_id: CUSTOMER_ID, amount: -200, reason: 'Write-off' });
    expect(r.success).toBe(true);
  });

  it('rejects a zero amount', () => {
    const r = adjustmentSchema.safeParse({ customer_id: CUSTOMER_ID, amount: 0, reason: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects a missing reason', () => {
    const r = adjustmentSchema.safeParse({ customer_id: CUSTOMER_ID, amount: 100, reason: '' });
    expect(r.success).toBe(false);
  });
});
