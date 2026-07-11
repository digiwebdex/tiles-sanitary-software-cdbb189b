/**
 * V2 Sprint 6B — first-ever coverage for `buildCustomerPaymentLines` /
 * `buildSupplierPaymentLines`. Both functions predate this sprint (built
 * during Sprint 6A's posting-engine work) but had zero callers and zero
 * tests until this sprint wired them into `recordCustomerPayment`/
 * `recordSupplierPaymentFifo` — see customerPayment.ts / supplierPayment.ts.
 */
import { describe, expect, it } from 'vitest';
import { buildCustomerPaymentLines, buildSupplierPaymentLines } from './LedgerPostingEngine';

describe('buildCustomerPaymentLines', () => {
  it('builds one customer/payment line per allocation plus one cash receipt line', () => {
    const lines = buildCustomerPaymentLines({
      customerId: 'cust-1',
      entryDate: '2026-07-06',
      allocations: [
        { saleId: 'sale-1', amount: 400 },
        { saleId: 'sale-2', amount: 600 },
      ],
      totalApplied: 1000,
    });
    const customerLines = lines.filter((l) => l.lineDomain === 'customer');
    expect(customerLines).toHaveLength(2);
    expect(customerLines[0]).toMatchObject({ lineType: 'payment', amount: 400, saleId: 'sale-1', partyId: 'cust-1' });
    expect(customerLines[1]).toMatchObject({ lineType: 'payment', amount: 600, saleId: 'sale-2' });
    const cashLines = lines.filter((l) => l.lineDomain === 'cash');
    expect(cashLines).toHaveLength(1);
    expect(cashLines[0].amount).toBe(1000);
  });

  it('routes to bank instead of cash when paidAccountId is set', () => {
    const lines = buildCustomerPaymentLines({
      customerId: 'cust-1',
      entryDate: '2026-07-06',
      paidAccountId: 'bank-acct-1',
      allocations: [{ saleId: 'sale-1', amount: 500 }],
      totalApplied: 500,
    });
    expect(lines.some((l) => l.lineDomain === 'bank')).toBe(true);
    expect(lines.some((l) => l.lineDomain === 'cash')).toBe(false);
  });

  it('the resulting batch balances (customer debit total ... wait, credit total equals cash/bank debit)', () => {
    const lines = buildCustomerPaymentLines({
      customerId: 'cust-1',
      entryDate: '2026-07-06',
      allocations: [{ saleId: 'sale-1', amount: 250 }],
      totalApplied: 250,
    });
    const customerAmount = lines.filter((l) => l.lineDomain === 'customer').reduce((s, l) => s + l.amount, 0);
    const cashAmount = lines.filter((l) => l.lineDomain === 'cash').reduce((s, l) => s + l.amount, 0);
    expect(customerAmount).toBe(cashAmount);
  });

  it('skips a zero/negative allocation (defensive — should never happen upstream)', () => {
    const lines = buildCustomerPaymentLines({
      customerId: 'cust-1',
      entryDate: '2026-07-06',
      allocations: [{ saleId: 'sale-1', amount: 0 }, { saleId: 'sale-2', amount: 100 }],
      totalApplied: 100,
    });
    expect(lines.filter((l) => l.lineDomain === 'customer')).toHaveLength(1);
  });
});

describe('buildSupplierPaymentLines', () => {
  it('builds one supplier/payment line per allocation plus one cash outflow line (negative amount)', () => {
    const lines = buildSupplierPaymentLines({
      supplierId: 'sup-1',
      entryDate: '2026-07-06',
      allocations: [
        { purchaseId: 'pur-1', amount: 700 },
      ],
      totalApplied: 700,
    });
    const supplierLines = lines.filter((l) => l.lineDomain === 'supplier');
    expect(supplierLines).toHaveLength(1);
    expect(supplierLines[0]).toMatchObject({ lineType: 'payment', amount: 700, purchaseId: 'pur-1', partyId: 'sup-1' });
    const cashLines = lines.filter((l) => l.lineDomain === 'cash');
    expect(cashLines).toHaveLength(1);
    expect(cashLines[0].amount).toBe(-700);
  });

  it('the batch balances: supplier debit total equals the cash/bank outflow magnitude', () => {
    const lines = buildSupplierPaymentLines({
      supplierId: 'sup-1',
      entryDate: '2026-07-06',
      allocations: [{ purchaseId: 'pur-1', amount: 300 }, { purchaseId: 'pur-2', amount: 200 }],
      totalApplied: 500,
    });
    const supplierAmount = lines.filter((l) => l.lineDomain === 'supplier').reduce((s, l) => s + l.amount, 0);
    const cashAmount = Math.abs(lines.filter((l) => l.lineDomain === 'cash').reduce((s, l) => s + l.amount, 0));
    expect(supplierAmount).toBe(cashAmount);
  });
});
