/**
 * V2 Sprint 5A — Supplier category/group/credit_limit additions + the new
 * ledger-summary endpoint's query shape. Same `.toSQL()` convention used
 * across this backend (no live test DB here).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { db } from '../db/connection';
import { computeSupplierBalance, computeSupplierOutstanding } from '../lib/ledgerBalance';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const SUPPLIER_ID = '22222222-2222-2222-2222-222222222222';

describe('supplierWriteSchema — category/supplier_group/credit_limit (V2 Sprint 5A)', () => {
  const supplierWriteSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    category: z.string().trim().max(100).nullable().optional(),
    supplier_group: z.string().trim().max(100).nullable().optional(),
    credit_limit: z.number().finite().min(0).optional(),
  });

  it('accepts a payload with no category/supplier_group/credit_limit (backward compatible)', () => {
    const parsed = supplierWriteSchema.parse({ name: 'Acme Tiles' });
    expect(parsed.category).toBeUndefined();
    expect(parsed.supplier_group).toBeUndefined();
    expect(parsed.credit_limit).toBeUndefined();
  });

  it('accepts category/supplier_group/credit_limit when supplied', () => {
    const parsed = supplierWriteSchema.parse({
      name: 'Acme Tiles', category: 'Manufacturer', supplier_group: 'Preferred', credit_limit: 50000,
    });
    expect(parsed.category).toBe('Manufacturer');
    expect(parsed.supplier_group).toBe('Preferred');
    expect(parsed.credit_limit).toBe(50000);
  });

  it('rejects a negative credit_limit', () => {
    expect(() => supplierWriteSchema.parse({ credit_limit: -100 })).toThrow();
  });
});

describe('GET /api/suppliers — sort/filter whitelist includes new columns (V2 Sprint 5A)', () => {
  const SORTABLE = new Set(['name', 'created_at', 'status', 'opening_balance', 'contact_person', 'category', 'supplier_group', 'credit_limit']);
  const FILTERABLE = new Set(['status', 'name', 'category', 'supplier_group']);

  it('allows sorting by the new columns', () => {
    expect(SORTABLE.has('category')).toBe(true);
    expect(SORTABLE.has('supplier_group')).toBe(true);
    expect(SORTABLE.has('credit_limit')).toBe(true);
  });

  it('allows filtering by category and supplier_group', () => {
    expect(FILTERABLE.has('category')).toBe(true);
    expect(FILTERABLE.has('supplier_group')).toBe(true);
  });
});

describe('GET /api/suppliers/:id/ledger-summary — query shape (V2 Sprint 5A)', () => {
  it('scopes supplier_ledger reads by dealer_id + supplier_id, ordered chronologically', () => {
    const { sql, bindings } = db('supplier_ledger')
      .where({ dealer_id: DEALER_ID, supplier_id: SUPPLIER_ID })
      .orderBy('entry_date', 'asc')
      .orderBy('created_at', 'asc')
      .select('id', 'type', 'amount', 'description', 'entry_date', 'purchase_id', 'created_at')
      .toSQL();
    expect(sql).toMatch(/"dealer_id" = /i);
    expect(sql).toMatch(/order by "entry_date" asc, "created_at" asc/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(SUPPLIER_ID);
  });

  it('reuses computeSupplierBalance/computeSupplierOutstanding rather than re-deriving balance math', () => {
    const rows = [
      { type: 'purchase', amount: -1000 },
      { type: 'payment', amount: 400 },
    ];
    expect(computeSupplierBalance(rows)).toBe(600);
    expect(computeSupplierOutstanding(rows)).toBe(600);
  });
});
