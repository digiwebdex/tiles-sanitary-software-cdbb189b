/**
 * Shared balance queries for reports, dashboard, collections, and financials.
 *
 * Phase 4 (P4-01/P4-02): AR/AP totals and Tier A list endpoints read from
 * `mv_customer_outstanding` and `mv_supplier_payable` (migration 062).
 * Ledger helpers remain for line-level detail, as-of snapshots, and parity tests.
 */
import type { Knex } from 'knex';
import { db } from '../db/connection';
import {
  attachPurchasePaymentSummaries,
  sumPurchaseLedgerPayments,
} from '../lib/purchasePaymentSummary';
import {
  computeCustomerBalance,
  computeSupplierBalance,
  computeSupplierOutstanding,
  type CustomerLedgerRow,
  type SupplierLedgerRow,
} from '../lib/ledgerBalance';

export type CustomerLedgerEntry = CustomerLedgerRow & {
  customer_id: string;
  entry_date?: string | Date | null;
};

export type SupplierLedgerEntry = SupplierLedgerRow & {
  supplier_id: string;
};

export interface CustomerLedgerAgg {
  outstanding: number;
  total_sales: number;
  total_paid: number;
  last_payment: string | null;
}

export interface CustomerDueReportRow {
  customerId: string;
  customerName: string;
  customerType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export interface SupplierPayableReportRow {
  supplierId: string;
  supplierName: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

/** Row from `mv_customer_outstanding` (sales-header AR read model). */
export interface CustomerOutstandingReadRow {
  customer_id: string;
  outstanding: number;
  oldest_unpaid_date: string | null;
  open_invoice_count: number;
}

/** Row from `mv_supplier_payable` (supplier-ledger AP read model). */
export interface SupplierPayableReadRow {
  supplier_id: string;
  outstanding: number;
}

/** WAC inventory valuation SQL fragment (P4-03). Falls back to cost_price when WAC unset. */
export const INVENTORY_WAC_VALUATION_EXPR = `
  CASE
    WHEN p.unit_type = 'box_sft' THEN
      COALESCE(s.box_qty, 0)
      * COALESCE(NULLIF(s.average_cost_per_unit, 0), p.cost_price, 0)
      * COALESCE(p.per_box_sft, 1)
    ELSE
      COALESCE(s.piece_qty, 0)
      * COALESCE(NULLIF(s.average_cost_per_unit, 0), p.cost_price, 0)
  END
`;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

export function groupCustomerLedger(
  entries: CustomerLedgerEntry[],
): Map<string, CustomerLedgerRow[]> {
  const map = new Map<string, CustomerLedgerRow[]>();
  for (const e of entries) {
    const rows = map.get(e.customer_id) ?? [];
    rows.push({ type: e.type, amount: num(e.amount) });
    map.set(e.customer_id, rows);
  }
  return map;
}

export function groupSupplierLedger(
  entries: SupplierLedgerEntry[],
): Map<string, SupplierLedgerRow[]> {
  const map = new Map<string, SupplierLedgerRow[]>();
  for (const e of entries) {
    const rows = map.get(e.supplier_id) ?? [];
    rows.push({ type: e.type, amount: num(e.amount) });
    map.set(e.supplier_id, rows);
  }
  return map;
}

/** Per-customer ledger rollup (Collections, dashboard widgets). */
export function aggregateCustomerLedger(
  entries: CustomerLedgerEntry[],
): CustomerLedgerAgg {
  let total_sales = 0;
  let total_paid = 0;
  let last_payment: string | null = null;

  for (const e of entries) {
    const amt = num(e.amount);
    if (e.type === 'sale' || e.type === 'adjustment') {
      total_sales += amt;
    } else if (e.type === 'payment' || e.type === 'refund') {
      total_paid += amt;
      const d = e.entry_date ? String(e.entry_date).slice(0, 10) : null;
      if (d && (!last_payment || d > last_payment)) last_payment = d;
    }
  }

  return {
    outstanding: computeCustomerBalance(entries),
    total_sales: round2(total_sales),
    total_paid: round2(total_paid),
    last_payment,
  };
}

export function buildCustomerDueReportRows(
  grouped: Map<string, CustomerLedgerRow[]>,
  customers: Map<string, { name: string; type: string }>,
): CustomerDueReportRow[] {
  return Array.from(grouped.entries())
    .map(([customerId, entryRows]) => {
      const c = customers.get(customerId);
      const balance = computeCustomerBalance(entryRows);
      const totalDebit = entryRows
        .filter((r) => r.type === 'sale' || r.type === 'adjustment')
        .reduce((sum, r) => sum + num(r.amount), 0);
      const totalCredit = entryRows
        .filter((r) => r.type === 'payment' || r.type === 'refund')
        .reduce((sum, r) => sum + num(r.amount), 0);
      return {
        customerId,
        customerName: c?.name ?? '—',
        customerType: c?.type ?? 'customer',
        totalDebit: round2(totalDebit),
        totalCredit: round2(totalCredit),
        balance: round2(balance),
      };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

export function buildSupplierPayableReportRows(
  grouped: Map<string, SupplierLedgerRow[]>,
  suppliers: Map<string, { name: string }>,
): SupplierPayableReportRow[] {
  return Array.from(grouped.entries())
    .map(([supplierId, entryRows]) => {
      const s = suppliers.get(supplierId);
      const balance = computeSupplierBalance(entryRows);
      const totalDebit = entryRows
        .filter((r) => r.type === 'purchase')
        .reduce((sum, r) => sum + Math.abs(num(r.amount)), 0);
      const totalCredit = entryRows
        .filter((r) => r.type === 'payment')
        .reduce((sum, r) => sum + num(r.amount), 0);
      return {
        supplierId,
        supplierName: s?.name ?? '—',
        totalDebit: round2(totalDebit),
        totalCredit: round2(totalCredit),
        balance: round2(balance),
      };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

type LedgerQueryOpts = {
  customerIds?: string[];
  supplierIds?: string[];
  asOf?: string | null;
  trx?: Knex.Transaction;
};

export async function fetchCustomerLedgerEntries(
  dealerId: string,
  opts: LedgerQueryOpts = {},
): Promise<CustomerLedgerEntry[]> {
  const conn = opts.trx ?? db;
  let q = conn('customer_ledger')
    .where({ dealer_id: dealerId })
    .select('customer_id', 'amount', 'type', 'entry_date');
  if (opts.customerIds?.length) q = q.whereIn('customer_id', opts.customerIds);
  if (opts.asOf) q = q.where('entry_date', '<=', opts.asOf);
  return q as Promise<CustomerLedgerEntry[]>;
}

export async function fetchSupplierLedgerEntries(
  dealerId: string,
  opts: LedgerQueryOpts = {},
): Promise<SupplierLedgerEntry[]> {
  const conn = opts.trx ?? db;
  let q = conn('supplier_ledger')
    .where({ dealer_id: dealerId })
    .select('supplier_id', 'type', 'amount');
  if (opts.supplierIds?.length) q = q.whereIn('supplier_id', opts.supplierIds);
  if (opts.asOf) q = q.where('entry_date', '<=', opts.asOf);
  return q as Promise<SupplierLedgerEntry[]>;
}

/** Per-customer AR from read model (sales due_amount, excludes reversed). */
export async function fetchCustomerOutstandingReadRows(
  dealerId: string,
): Promise<CustomerOutstandingReadRow[]> {
  const rows = await db('mv_customer_outstanding')
    .where({ dealer_id: dealerId })
    .select(
      'customer_id',
      'outstanding',
      'oldest_unpaid_date',
      'open_invoice_count',
    );
  return (rows as CustomerOutstandingReadRow[]).map((r) => ({
    customer_id: r.customer_id,
    outstanding: round2(num(r.outstanding)),
    oldest_unpaid_date: r.oldest_unpaid_date
      ? String(r.oldest_unpaid_date).slice(0, 10)
      : null,
    open_invoice_count: Number(r.open_invoice_count) || 0,
  }));
}

/** Per-supplier AP from read model (supplier_ledger rollup). */
export async function fetchSupplierPayableReadRows(
  dealerId: string,
): Promise<SupplierPayableReadRow[]> {
  const rows = await db('mv_supplier_payable')
    .where({ dealer_id: dealerId })
    .select('supplier_id', 'outstanding');
  return (rows as SupplierPayableReadRow[]).map((r) => ({
    supplier_id: r.supplier_id,
    outstanding: round2(num(r.outstanding)),
  }));
}

export async function sumCustomerOutstandingFromReadModel(dealerId: string): Promise<number> {
  const row = await db('mv_customer_outstanding')
    .where({ dealer_id: dealerId })
    .sum({ total: 'outstanding' })
    .first();
  return round2(num(row?.total));
}

export async function sumSupplierPayableFromReadModel(dealerId: string): Promise<number> {
  const row = await db('mv_supplier_payable')
    .where({ dealer_id: dealerId })
    .sum({ total: 'outstanding' })
    .first();
  return round2(num(row?.total));
}

/** Inventory valuation at WAC (average_cost_per_unit), cost_price fallback (P4-03). */
export async function sumInventoryValuationWac(dealerId: string): Promise<number> {
  const row = await db('stock as s')
    .join('products as p', 'p.id', 's.product_id')
    .where('s.dealer_id', dealerId)
    .sum({ total: db.raw(INVENTORY_WAC_VALUATION_EXPR) })
    .first();
  return round2(num(row?.total));
}

export async function buildSupplierPayableReportRowsFromReadModel(
  dealerId: string,
): Promise<SupplierPayableReportRow[]> {
  const [readRows, suppliers, ledger] = await Promise.all([
    fetchSupplierPayableReadRows(dealerId),
    db('suppliers').where({ dealer_id: dealerId }).select('id', 'name'),
    fetchSupplierLedgerEntries(dealerId),
  ]);
  const sm = new Map(
    (suppliers as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );
  const bySupplier = groupSupplierLedger(ledger);

  return readRows
    .map((r) => {
      const entryRows = bySupplier.get(r.supplier_id) ?? [];
      const totalDebit = entryRows
        .filter((row) => row.type === 'purchase')
        .reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);
      const totalCredit = entryRows
        .filter((row) => row.type === 'payment' || row.type === 'refund')
        .reduce((sum, row) => sum + num(row.amount), 0);
      return {
        supplierId: r.supplier_id,
        supplierName: sm.get(r.supplier_id) ?? '—',
        totalDebit: round2(totalDebit),
        totalCredit: round2(totalCredit),
        balance: r.outstanding,
      };
    })
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

/** Σ positive customer ledger balances (legacy / as-of / parity). */
export async function sumCustomerOutstandingFromLedger(dealerId: string): Promise<number> {
  const entries = await fetchCustomerLedgerEntries(dealerId);
  const grouped = groupCustomerLedger(entries);
  let total = 0;
  for (const rows of grouped.values()) {
    const balance = computeCustomerBalance(rows);
    if (balance > 0) total += balance;
  }
  return round2(total);
}

/** Σ AR from read model — matches Due Aging grand total. */
export async function sumCustomerOutstandingFromSales(dealerId: string): Promise<number> {
  return sumCustomerOutstandingFromReadModel(dealerId);
}

/** Total AP — read model for current; ledger rollup when asOf is set. */
export async function sumSupplierPayable(
  dealerId: string,
  asOf?: string | null,
): Promise<number> {
  if (!asOf) {
    return sumSupplierPayableFromReadModel(dealerId);
  }
  const entries = await fetchSupplierLedgerEntries(dealerId, { asOf });
  const grouped = groupSupplierLedger(entries);
  let total = 0;
  for (const rows of grouped.values()) {
    total += computeSupplierOutstanding(rows);
  }
  return round2(total);
}

/** Map customer_id → outstanding from read model. */
export async function getCustomerOutstandingMapFromReadModel(
  dealerId: string,
): Promise<Map<string, number>> {
  const rows = await fetchCustomerOutstandingReadRows(dealerId);
  return new Map(rows.map((r) => [r.customer_id, r.outstanding]));
}

/** Map supplier_id → outstanding from read model (P4-02). */
export async function getSupplierOutstandingMapFromReadModel(
  dealerId: string,
): Promise<Map<string, number>> {
  const rows = await fetchSupplierPayableReadRows(dealerId);
  return new Map(rows.map((r) => [r.supplier_id, r.outstanding]));
}

/** Single supplier AP from read model (P4-02). */
export async function getSupplierOutstandingFromReadModel(
  dealerId: string,
  supplierId: string,
): Promise<number> {
  const row = await db('mv_supplier_payable')
    .where({ dealer_id: dealerId, supplier_id: supplierId })
    .first('outstanding');
  return row ? round2(num(row.outstanding)) : 0;
}

export interface SupplierOutstandingSummaryRow {
  supplierId: string;
  name: string;
  phone: string;
  totalPurchase: number;
  totalPaid: number;
  outstanding: number;
  payments: number;
}

/** Supplier Outstanding report rows — outstanding from read model; purchase/payment stats from ledger. */
export async function buildSupplierOutstandingSummaryRows(
  dealerId: string,
): Promise<SupplierOutstandingSummaryRow[]> {
  const [readRows, suppliers, ledger] = await Promise.all([
    fetchSupplierPayableReadRows(dealerId),
    db('suppliers')
      .where({ dealer_id: dealerId })
      .select('id', 'name', 'phone', 'status'),
    fetchSupplierLedgerEntries(dealerId),
  ]);
  const suppMap = new Map<string, { name: string; phone: string }>(
    (suppliers as Array<{ id: string; name: string; phone: string | null }>).map((s) => [
      s.id,
      { name: s.name, phone: s.phone ?? '—' },
    ]),
  );
  const bySupplier = groupSupplierLedger(ledger);

  return readRows
    .map((r) => {
      const s = suppMap.get(r.supplier_id);
      const entryRows = bySupplier.get(r.supplier_id) ?? [];
      const totalPurchase = entryRows
        .filter((row) => row.type === 'purchase')
        .reduce((sum, row) => sum + Math.abs(num(row.amount)), 0);
      const totalPaid = entryRows
        .filter((row) => row.type === 'payment')
        .reduce((sum, row) => sum + num(row.amount), 0);
      const paymentCount = entryRows.filter((row) => row.type === 'payment').length;
      return {
        supplierId: r.supplier_id,
        name: s?.name ?? '—',
        phone: s?.phone ?? '—',
        totalPurchase: round2(totalPurchase),
        totalPaid: round2(totalPaid),
        outstanding: r.outstanding,
        payments: paymentCount,
      };
    })
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

export interface PayablesOutstandingBillRow {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  supplier_id: string;
  total_amount: number;
  net_payable: number;
  paid_amount: number;
  due_amount: number;
  payment_status: string;
  suppliers: { id: string; name: string; phone: string | null } | null;
}

export interface PayablesOutstandingResult {
  rows: PayablesOutstandingBillRow[];
  summary: {
    source: 'read_model';
    totalOutstanding: number;
    billLevelTotal: number;
    suppliers: Array<{ supplierId: string; name: string; outstanding: number }>;
  };
}

/** Payables page — bills for FIFO UI; totals and supplier caps from read model (P4-02). */
export async function listPayablesOutstanding(
  dealerId: string,
): Promise<PayablesOutstandingResult> {
  const readRows = await fetchSupplierPayableReadRows(dealerId);
  const supplierIds = readRows.map((r) => r.supplier_id);

  if (!supplierIds.length) {
    return {
      rows: [],
      summary: {
        source: 'read_model',
        totalOutstanding: 0,
        billLevelTotal: 0,
        suppliers: [],
      },
    };
  }

  const [purchases, suppliers] = await Promise.all([
    // V2 Sprint 6B fix: a draft (not-yet-finalized) Purchase Invoice must
    // not be payable — only a posted bill has a real, final due amount.
    db('purchases')
      .where({ dealer_id: dealerId, document_status: 'posted' })
      .whereIn('supplier_id', supplierIds)
      .orderBy('purchase_date', 'asc')
      .select('*'),
    db('suppliers').whereIn('id', supplierIds).select('id', 'name', 'phone'),
  ]);

  const supMap = new Map(
    (suppliers as Array<{ id: string; name: string; phone: string | null }>).map((s) => [s.id, s]),
  );

  const enriched = await attachPurchasePaymentSummaries(dealerId, purchases as any[]);
  const unpaid = enriched.filter((p) => p.due_amount > 0.01);

  const rows: PayablesOutstandingBillRow[] = unpaid.map((p) => ({
    id: p.id,
    invoice_number: (p as any).invoice_number ?? null,
    purchase_date: String((p as any).purchase_date).slice(0, 10),
    supplier_id: (p as any).supplier_id,
    total_amount: num((p as any).total_amount),
    net_payable: p.net_payable,
    paid_amount: p.paid_amount,
    due_amount: p.due_amount,
    payment_status: p.payment_status,
    suppliers: (p as any).supplier_id
      ? {
          id: (p as any).supplier_id,
          name: supMap.get((p as any).supplier_id)?.name ?? '—',
          phone: supMap.get((p as any).supplier_id)?.phone ?? null,
        }
      : null,
  }));

  const billLevelTotal = round2(rows.reduce((s, r) => s + r.due_amount, 0));
  const totalOutstanding = await sumSupplierPayableFromReadModel(dealerId);

  return {
    rows,
    summary: {
      source: 'read_model',
      totalOutstanding,
      billLevelTotal,
      suppliers: readRows.map((r) => ({
        supplierId: r.supplier_id,
        name: supMap.get(r.supplier_id)?.name ?? '—',
        outstanding: r.outstanding,
      })),
    },
  };
}

/** Single customer AR from read model (P4-02). */
export async function getCustomerOutstandingFromReadModel(
  dealerId: string,
  customerId: string,
): Promise<number> {
  const row = await db('mv_customer_outstanding')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .first('outstanding');
  return row ? round2(num(row.outstanding)) : 0;
}

/** Per-customer oldest unpaid date from read model. */
export async function getCustomerOldestUnpaidMapFromReadModel(
  dealerId: string,
): Promise<Map<string, string>> {
  const rows = await fetchCustomerOutstandingReadRows(dealerId);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.oldest_unpaid_date) map.set(r.customer_id, r.oldest_unpaid_date);
  }
  return map;
}

export async function getCustomerAggById(
  dealerId: string,
  customerIds?: string[],
): Promise<Map<string, CustomerLedgerAgg>> {
  const entries = await fetchCustomerLedgerEntries(dealerId, { customerIds });
  const grouped = groupCustomerLedger(entries);
  const result = new Map<string, CustomerLedgerAgg>();
  for (const [customerId, rows] of grouped) {
    const dated = entries.filter((e) => e.customer_id === customerId);
    result.set(customerId, aggregateCustomerLedger(dated));
  }
  return result;
}

/** Matches `mv_customer_outstanding` open-invoice filter (excludes reversed). */
export function applyOpenArSalesFilter(q: Knex.QueryBuilder): Knex.QueryBuilder {
  return q
    .where('due_amount', '>', 0)
    .whereRaw("COALESCE(document_status, 'posted') <> 'reversed'");
}

export function agingDaysFromSaleDate(
  saleDate: string | Date,
  today: Date = new Date(),
): number {
  const sale = new Date(saleDate);
  return Math.max(0, Math.floor((today.getTime() - sale.getTime()) / 86_400_000));
}

export interface DueAgingBuckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
  total: number;
}

export function emptyDueAgingBuckets(): DueAgingBuckets {
  return { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
}

/** Allocate one open invoice due into aging bucket columns. */
export function addDueToAgingBuckets(
  buckets: DueAgingBuckets,
  dueAmount: number,
  days: number,
): void {
  const due = round2(num(dueAmount));
  if (due <= 0) return;
  if (days <= 0) buckets.current += due;
  else if (days <= 30) buckets.d30 += due;
  else if (days <= 60) buckets.d60 += due;
  else if (days <= 90) buckets.d90 += due;
  else buckets.d90plus += due;
  buckets.total += due;
}

export interface DueAgingInvoiceRow {
  id: string;
  invoice_number: string | null;
  sale_date: string;
  due_amount: number;
  days: number;
}

export interface DueAgingCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
  total: number;
  invoices: DueAgingInvoiceRow[];
}

export interface OpenSaleDueRow {
  id: string;
  customer_id: string;
  sale_date: string | Date;
  due_amount: number;
  total_amount: number;
  invoice_number: string | null;
  project_id?: string | null;
  paid_amount?: number;
}

/** Open AR invoice lines (same filter as mv_customer_outstanding). */
export async function fetchOpenSalesDueRows(
  dealerId: string,
  opts: { customerIds?: string[]; projectScoped?: boolean } = {},
): Promise<OpenSaleDueRow[]> {
  let q = applyOpenArSalesFilter(
    db('sales').where({ dealer_id: dealerId }),
  ).select(
    'id',
    'customer_id',
    'sale_date',
    'due_amount',
    'total_amount',
    'invoice_number',
    'project_id',
    'paid_amount',
  );
  if (opts.customerIds?.length) q = q.whereIn('customer_id', opts.customerIds);
  if (opts.projectScoped) q = q.whereNotNull('project_id');
  return q as Promise<OpenSaleDueRow[]>;
}

/** Due Aging report — invoice buckets + per-customer totals aligned with read model. */
export async function buildDueAgingReportRows(dealerId: string): Promise<DueAgingCustomerRow[]> {
  const [customers, sales, readRows] = await Promise.all([
    db('customers')
      .where({ dealer_id: dealerId, status: 'active' })
      .orderBy('name', 'asc')
      .select('id', 'name', 'phone', 'type'),
    fetchOpenSalesDueRows(dealerId),
    fetchCustomerOutstandingReadRows(dealerId),
  ]);

  const outstandingByCustomer = new Map(
    readRows.map((r) => [r.customer_id, r.outstanding]),
  );
  const today = new Date();

  const customerMap = new Map<string, DueAgingCustomerRow & { invoices: DueAgingInvoiceRow[] }>();
  for (const c of customers as Array<{
    id: string;
    name: string;
    phone: string | null;
    type: string;
  }>) {
    customerMap.set(c.id, {
      id: c.id,
      name: c.name,
      phone: c.phone,
      type: c.type,
      ...emptyDueAgingBuckets(),
      invoices: [],
    });
  }

  for (const s of sales) {
    const cust = customerMap.get(s.customer_id);
    if (!cust) continue;
    const due = num(s.due_amount);
    const days = agingDaysFromSaleDate(s.sale_date, today);
    addDueToAgingBuckets(cust, due, days);
    cust.invoices.push({
      id: s.id,
      invoice_number: s.invoice_number,
      sale_date:
        typeof s.sale_date === 'string'
          ? s.sale_date.slice(0, 10)
          : new Date(s.sale_date).toISOString().split('T')[0],
      due_amount: round2(due),
      days,
    });
  }

  return Array.from(customerMap.values())
    .filter((v) => (outstandingByCustomer.get(v.id) ?? v.total) > 0.01)
    .map((v) => {
      const readTotal = outstandingByCustomer.get(v.id);
      const total = readTotal != null ? readTotal : round2(v.total);
      return {
        ...v,
        total,
        invoices: v.invoices.sort((a, b) => b.days - a.days),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export interface SaleOverdueCheckResult {
  outstanding: number;
  daysOverdue: number;
  maxOverdueDays: number;
  creditLimit: number;
  isOverdueViolated: boolean;
  isCreditExceeded: boolean;
}

/** Credit / overdue gate for a single customer (AR from read model). */
export async function buildSaleOverdueCheckResult(
  dealerId: string,
  customerId: string,
): Promise<SaleOverdueCheckResult | null> {
  const [customer, readRow] = await Promise.all([
    db('customers')
      .where({ id: customerId, dealer_id: dealerId })
      .select('credit_limit', 'max_overdue_days')
      .first(),
    db('mv_customer_outstanding')
      .where({ dealer_id: dealerId, customer_id: customerId })
      .first('outstanding', 'oldest_unpaid_date'),
  ]);
  if (!customer) return null;

  const outstanding = readRow ? round2(num(readRow.outstanding)) : 0;
  const oldestDate = readRow?.oldest_unpaid_date
    ? String(readRow.oldest_unpaid_date).slice(0, 10)
    : null;
  const daysOverdue = oldestDate ? agingDaysFromSaleDate(oldestDate) : 0;
  const maxOverdueDays = Number(customer.max_overdue_days ?? 0);
  const creditLimit = Number(customer.credit_limit ?? 0);

  return {
    outstanding,
    daysOverdue,
    maxOverdueDays,
    creditLimit,
    isOverdueViolated: maxOverdueDays > 0 && daysOverdue > maxOverdueDays,
    isCreditExceeded: creditLimit > 0 && outstanding > creditLimit,
  };
}

export interface ProjectOutstandingRow {
  project_id: string;
  project_name: string;
  project_code: string;
  customer_name: string;
  billed: number;
  paid: number;
  due: number;
  overdue: number;
}

/** All non-reversed sales tied to a project (for project AR rollups). */
export async function fetchProjectSalesRows(dealerId: string): Promise<OpenSaleDueRow[]> {
  return db('sales')
    .where({ dealer_id: dealerId })
    .whereNotNull('project_id')
    .whereRaw("COALESCE(document_status, 'posted') <> 'reversed'")
    .select(
      'id',
      'customer_id',
      'sale_date',
      'due_amount',
      'total_amount',
      'invoice_number',
      'project_id',
      'paid_amount',
    ) as Promise<OpenSaleDueRow[]>;
}

/** Project outstanding — billed/paid/due from sales headers (project-scoped). */
export async function buildProjectOutstandingRows(
  dealerId: string,
  projects: Map<
    string,
    {
      project_name: string;
      project_code: string;
      customer_name: string | null;
      max_overdue_days?: number | null;
    }
  >,
  today: string = new Date().toISOString().split('T')[0],
): Promise<ProjectOutstandingRow[]> {
  const sales = await fetchProjectSalesRows(dealerId);

  const agg = new Map<string, { billed: number; paid: number; due: number; overdue: number }>();
  for (const r of sales) {
    if (!r.project_id) continue;
    const cur = agg.get(r.project_id) ?? { billed: 0, paid: 0, due: 0, overdue: 0 };
    const due = num(r.due_amount);
    cur.billed += num(r.total_amount);
    cur.paid += num(r.paid_amount);
    cur.due += due;
    if (due > 0 && r.sale_date) {
      const p = projects.get(r.project_id);
      const maxDays = p?.max_overdue_days ?? 0;
      const dStr =
        typeof r.sale_date === 'string'
          ? r.sale_date.slice(0, 10)
          : new Date(r.sale_date).toISOString().split('T')[0];
      const days = Math.floor(
        (new Date(today + 'T00:00:00').getTime() - new Date(dStr + 'T00:00:00').getTime()) /
          86_400_000,
      );
      if (days > (maxDays ?? 0)) cur.overdue += due;
    }
    agg.set(r.project_id, cur);
  }

  const rows: ProjectOutstandingRow[] = [];
  for (const [pid, v] of agg.entries()) {
    const p = projects.get(pid);
    if (!p) continue;
    rows.push({
      project_id: pid,
      project_name: p.project_name,
      project_code: p.project_code,
      customer_name: p.customer_name ?? '—',
      billed: round2(v.billed),
      paid: round2(v.paid),
      due: round2(v.due),
      overdue: round2(v.overdue),
    });
  }
  return rows.sort((a, b) => b.due - a.due);
}

/** Purchases report paid amounts — shared supplier_ledger rollup (P4 Tier B). */
export async function getPurchasePaidAmountMap(
  dealerId: string,
  purchaseIds: string[],
): Promise<Record<string, number>> {
  const paidMap = await sumPurchaseLedgerPayments(dealerId, purchaseIds);
  const result: Record<string, number> = {};
  for (const [id, amt] of paidMap.entries()) {
    result[id] = amt;
  }
  return result;
}

/** Oldest unpaid sale date per customer (for aging badges). */
export async function getOldestUnpaidSaleDateByCustomer(
  dealerId: string,
  customerIds?: string[],
): Promise<Map<string, string>> {
  let q = applyOpenArSalesFilter(
    db('sales').where({ dealer_id: dealerId }),
  )
    .orderBy('sale_date', 'asc')
    .select('customer_id', 'sale_date');
  if (customerIds?.length) q = q.whereIn('customer_id', customerIds);

  const sales = await q;
  const map = new Map<string, string>();
  for (const s of sales as Array<{ customer_id: string; sale_date: unknown }>) {
    if (!map.has(s.customer_id)) {
      map.set(s.customer_id, String(s.sale_date).slice(0, 10));
    }
  }
  return map;
}
