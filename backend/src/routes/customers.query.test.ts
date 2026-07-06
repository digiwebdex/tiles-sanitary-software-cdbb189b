/**
 * V2 Sprint 4A — Customer & Quotation Foundation.
 * Tests the extended CUSTOMER_TYPES enum and the new writable
 * customer_group/default_discount_type/default_discount_value fields.
 * Same `.toSQL()`-adjacent convention as reservations.query.test.ts —
 * duplicates the route's zod schema shape to assert on its behavior.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const CUSTOMER_TYPES = ['retailer', 'customer', 'project', 'dealer', 'contractor', 'builder', 'corporate'] as const;

const customerWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  credit_limit: z.number().finite().min(0).optional(),
  customer_group: z.string().trim().max(100).nullable().optional(),
  default_discount_type: z.enum(['flat', 'percent']).nullable().optional(),
  default_discount_value: z.number().finite().min(0).optional(),
});

describe('customerWriteSchema — V2 Sprint 4A extensions', () => {
  it('accepts all 4 new customer types alongside the original 3', () => {
    for (const t of CUSTOMER_TYPES) {
      expect(customerWriteSchema.safeParse({ type: t }).success).toBe(true);
    }
  });

  it('rejects a type outside the known set', () => {
    expect(customerWriteSchema.safeParse({ type: 'wholesaler' }).success).toBe(false);
  });

  it('accepts customer_group as an optional nullable string', () => {
    expect(customerWriteSchema.safeParse({ customer_group: 'VIP' }).success).toBe(true);
    expect(customerWriteSchema.safeParse({ customer_group: null }).success).toBe(true);
    expect(customerWriteSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a default_discount_type of flat/percent or null, rejects anything else', () => {
    expect(customerWriteSchema.safeParse({ default_discount_type: 'flat' }).success).toBe(true);
    expect(customerWriteSchema.safeParse({ default_discount_type: 'percent' }).success).toBe(true);
    expect(customerWriteSchema.safeParse({ default_discount_type: null }).success).toBe(true);
    expect(customerWriteSchema.safeParse({ default_discount_type: 'buy1get1' }).success).toBe(false);
  });

  it('rejects a negative default_discount_value', () => {
    expect(customerWriteSchema.safeParse({ default_discount_value: -5 }).success).toBe(false);
  });
});
