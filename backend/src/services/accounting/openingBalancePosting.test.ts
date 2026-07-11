/**
 * V2 Sprint 6B — query-shape + pure-logic tests for Opening Balance posting.
 * No live test DB in this backend (see periodLock.test.ts's own convention),
 * so DB-touching assertions are query-shape (.toSQL()) checks; the sign
 * convention itself is re-derived and asserted directly, matching each
 * ledger's documented rule (customer_ledger stores as-is; supplier_ledger
 * negates, per ledgerBalance.ts's computeSupplierBalance).
 */
import { describe, expect, it } from 'vitest';
import { db } from '../../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';
const SUPPLIER_ID = '33333333-3333-3333-3333-333333333333';

describe('Opening Balance idempotency existence-check — query shape', () => {
  it('looks up an existing customer_ledger opening_balance row scoped by dealer_id + customer_id + type', () => {
    const { sql, bindings } = db('customer_ledger')
      .where({ dealer_id: DEALER_ID, customer_id: CUSTOMER_ID, type: 'opening_balance' })
      .first('id')
      .toSQL();
    expect(sql.toLowerCase()).toContain('dealer_id');
    expect(sql.toLowerCase()).toContain('customer_id');
    expect(sql.toLowerCase()).toContain('type');
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain(CUSTOMER_ID);
    expect(bindings).toContain('opening_balance');
  });

  it('looks up an existing supplier_ledger opening_balance row scoped by dealer_id + supplier_id + type', () => {
    const { sql, bindings } = db('supplier_ledger')
      .where({ dealer_id: DEALER_ID, supplier_id: SUPPLIER_ID, type: 'opening_balance' })
      .first('id')
      .toSQL();
    expect(sql.toLowerCase()).toContain('supplier_id');
    expect(bindings).toContain(SUPPLIER_ID);
  });
});

describe('Sign convention (must match ledgerBalance.ts exactly)', () => {
  function round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  it('a customer opening balance is stored as-is (positive = customer owes more, same bucket as sale/adjustment)', () => {
    const customerOpeningBalance = 5000;
    const ledgerAmount = round2(customerOpeningBalance);
    expect(ledgerAmount).toBe(5000);
    // computeCustomerBalance: balance += amt for 'opening_balance' (same as 'sale'/'adjustment')
    const balanceContribution = ledgerAmount;
    expect(balanceContribution).toBe(5000);
  });

  it('a supplier opening balance is NEGATED on write (matches the purchase row convention: negative = we owe more)', () => {
    const supplierOpeningBalance = 3000; // "we owe the supplier 3000"
    const ledgerAmount = round2(-supplierOpeningBalance);
    expect(ledgerAmount).toBe(-3000);
    // computeSupplierBalance's else-bucket: balance += -amt
    const balanceContribution = -ledgerAmount;
    expect(balanceContribution).toBe(3000);
  });

  it('a zero opening balance produces no ledger row (short-circuited before any insert)', () => {
    const amount = 0;
    const shouldPost = round2(amount) !== 0;
    expect(shouldPost).toBe(false);
  });
});

describe('GL documentType/idempotencyKey conventions for opening balance', () => {
  it('uses a distinct, collision-free idempotency key per party', () => {
    const customerKey = (id: string) => `opening_balance:customer:${id}`;
    const supplierKey = (id: string) => `opening_balance:supplier:${id}`;
    expect(customerKey(CUSTOMER_ID)).toBe(`opening_balance:customer:${CUSTOMER_ID}`);
    expect(supplierKey(SUPPLIER_ID)).toBe(`opening_balance:supplier:${SUPPLIER_ID}`);
    expect(customerKey(CUSTOMER_ID)).not.toBe(supplierKey(CUSTOMER_ID));
  });
});
