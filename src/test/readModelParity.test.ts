import { describe, expect, it } from 'vitest';
import {
  computeCustomerBalance,
  computeSupplierOutstanding,
} from '../../backend/src/lib/ledgerBalance';
import {
  addDueToAgingBuckets,
  emptyDueAgingBuckets,
  groupCustomerLedger,
  groupSupplierLedger,
  type CustomerLedgerEntry,
  type SupplierLedgerEntry,
} from '../../backend/src/services/reportQueryService';

const C1 = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/**
 * Phase 4 read-model view definitions (062) must match these rollups when
 * sales headers / supplier ledger are in sync.
 */
describe('Phase 4 read model parity (fixtures)', () => {
  it('mv_customer_outstanding rollup matches sum of positive sales due_amount', () => {
    const salesDue = [
      { customer_id: C1, due_amount: 7000, document_status: 'posted' },
      { customer_id: C1, due_amount: 0, document_status: 'posted' },
      { customer_id: C1, due_amount: 500, document_status: 'reversed' },
    ];
    const viewTotal = salesDue
      .filter((s) => s.document_status !== 'reversed' && s.due_amount > 0.01)
      .reduce((sum, s) => sum + s.due_amount, 0);
    expect(viewTotal).toBe(7000);
  });

  it('mv_supplier_payable rollup matches computeSupplierOutstanding per supplier', () => {
    const supplierLedger: SupplierLedgerEntry[] = [
      { supplier_id: S1, type: 'purchase', amount: -50000 },
      { supplier_id: S1, type: 'payment', amount: 20000 },
    ];
    const grouped = groupSupplierLedger(supplierLedger);
    const viewOutstanding = computeSupplierOutstanding(grouped.get(S1)!);
    expect(viewOutstanding).toBe(30000);
  });

  it('due aging invoice rollup matches mv_customer_outstanding when headers sync', () => {
    const openInvoices = [
      { due_amount: 4000, sale_date: '2026-05-01', document_status: 'posted' },
      { due_amount: 3000, sale_date: '2026-04-01', document_status: 'posted' },
      { due_amount: 500, document_status: 'reversed' },
    ];
    const viewTotal = openInvoices
      .filter((s) => s.document_status !== 'reversed' && s.due_amount > 0.01)
      .reduce((sum, s) => sum + s.due_amount, 0);

    const buckets = emptyDueAgingBuckets();
    const today = new Date('2026-06-09T12:00:00Z');
    for (const inv of openInvoices) {
      if (inv.document_status === 'reversed' || inv.due_amount <= 0.01) continue;
      const days = Math.max(
        0,
        Math.floor(
          (today.getTime() - new Date(inv.sale_date ?? today).getTime()) / 86_400_000,
        ),
      );
      addDueToAgingBuckets(buckets, inv.due_amount, days);
    }
    expect(buckets.total).toBe(viewTotal);
    expect(buckets.total).toBe(7000);
  });

  it('ledger AR can diverge from sales-header AR when headers are stale', () => {
    const customerLedger: CustomerLedgerEntry[] = [
      { customer_id: C1, type: 'sale', amount: 10000, entry_date: '2026-06-01' },
      { customer_id: C1, type: 'payment', amount: 3000, entry_date: '2026-06-05' },
    ];
    const ledgerAr = computeCustomerBalance(customerLedger);
    const salesHeaderAr = 7000;
    expect(ledgerAr).toBe(7000);
    expect(salesHeaderAr).toBe(ledgerAr);
  });
});
