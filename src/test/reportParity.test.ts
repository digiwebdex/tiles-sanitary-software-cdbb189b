import { describe, expect, it } from 'vitest';
import {
  computeCustomerBalance,
  computeSupplierBalance,
  computeSupplierOutstanding,
} from '../../backend/src/lib/ledgerBalance';
import {
  aggregateCustomerLedger,
  buildCustomerDueReportRows,
  buildSupplierPayableReportRows,
  groupCustomerLedger,
  groupSupplierLedger,
  type CustomerLedgerEntry,
  type SupplierLedgerEntry,
} from '../../backend/src/services/reportQueryService';

const C1 = '11111111-1111-1111-1111-111111111111';
const C2 = '22222222-2222-2222-2222-222222222222';
const S1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Sample ledger matching a fresh dealer after purchase + sale + partial payments. */
const customerLedger: CustomerLedgerEntry[] = [
  { customer_id: C1, type: 'sale', amount: 10000, entry_date: '2026-06-01' },
  { customer_id: C1, type: 'payment', amount: 3000, entry_date: '2026-06-05' },
  { customer_id: C2, type: 'sale', amount: 28800, entry_date: '2026-06-02' },
  { customer_id: C2, type: 'payment', amount: 10000, entry_date: '2026-06-06' },
];

const supplierLedger: SupplierLedgerEntry[] = [
  { supplier_id: S1, type: 'purchase', amount: -50000 },
  { supplier_id: S1, type: 'payment', amount: 20000 },
  { supplier_id: S2, type: 'purchase', amount: -28800 },
];

/** Invoice headers when payments flow through recordCustomerPayment (Phase 0). */
const salesDueHeaders = [
  { customer_id: C1, due_amount: 7000 },
  { customer_id: C2, due_amount: 18800 },
];

function sumPositiveCustomerBalances(entries: CustomerLedgerEntry[]): number {
  const grouped = groupCustomerLedger(entries);
  let total = 0;
  for (const rows of grouped.values()) {
    const balance = computeCustomerBalance(rows);
    if (balance > 0) total += balance;
  }
  return Math.round(total * 100) / 100;
}

function sumSupplierPayableFromLedger(entries: SupplierLedgerEntry[]): number {
  const grouped = groupSupplierLedger(entries);
  let total = 0;
  for (const rows of grouped.values()) {
    total += computeSupplierOutstanding(rows);
  }
  return Math.round(total * 100) / 100;
}

function rawSupplierLedgerSum(entries: SupplierLedgerEntry[]): number {
  const sum = entries.reduce((acc, e) => acc + Number(e.amount), 0);
  return Math.max(0, Math.round(sum * 100) / 100);
}

describe('report parity (Phase 1 fixtures)', () => {
  it('aggregateCustomerLedger outstanding matches computeCustomerBalance per customer', () => {
    for (const customerId of [C1, C2]) {
      const rows = customerLedger.filter((e) => e.customer_id === customerId);
      const agg = aggregateCustomerLedger(rows);
      expect(agg.outstanding).toBe(computeCustomerBalance(rows));
    }
  });

  it('Collections grand total equals Customer Due report sum (ledger-based)', () => {
    const grouped = groupCustomerLedger(customerLedger);
    const customers = new Map([
      [C1, { name: 'Customer A', type: 'customer' }],
      [C2, { name: 'Customer B', type: 'retailer' }],
    ]);

    const collectionsTotal = sumPositiveCustomerBalances(customerLedger);
    const reportRows = buildCustomerDueReportRows(grouped, customers);
    const reportTotal = reportRows.reduce((sum, r) => sum + r.balance, 0);

    expect(collectionsTotal).toBe(25800);
    expect(reportTotal).toBe(collectionsTotal);
    expect(Math.abs(collectionsTotal - reportTotal)).toBeLessThan(0.01);
  });

  it('Dashboard sales due total matches ledger when invoice headers are synced', () => {
    const ledgerTotal = sumPositiveCustomerBalances(customerLedger);
    const salesTotal = salesDueHeaders.reduce((sum, s) => sum + s.due_amount, 0);
    expect(ledgerTotal).toBe(salesTotal);
    expect(Math.abs(ledgerTotal - salesTotal)).toBeLessThan(0.01);
  });

  it('Supplier Payable report total matches financials AP formula (not raw SUM)', () => {
    const grouped = groupSupplierLedger(supplierLedger);
    const suppliers = new Map([
      [S1, { name: 'MIR CERAMICS' }],
      [S2, { name: 'Other Tiles' }],
    ]);

    const reportRows = buildSupplierPayableReportRows(grouped, suppliers);
    const reportTotal = reportRows.reduce((sum, r) => sum + r.balance, 0);
    const apTotal = sumSupplierPayableFromLedger(supplierLedger);
    const rawSum = rawSupplierLedgerSum(supplierLedger);

    expect(apTotal).toBe(58800);
    expect(reportTotal).toBe(apTotal);
    expect(rawSum).not.toBe(apTotal);
    expect(Math.abs(reportTotal - apTotal)).toBeLessThan(0.01);
  });

  it('per-supplier outstanding uses computeSupplierBalance consistently', () => {
    const grouped = groupSupplierLedger(supplierLedger);
    for (const [supplierId, rows] of grouped) {
      const balance = computeSupplierBalance(rows);
      const outstanding = computeSupplierOutstanding(rows);
      expect(outstanding).toBe(Math.max(0, balance));
    }
  });
});
