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
  const [readRows, suppliers] = await Promise.all([
    fetchSupplierPayableReadRows(dealerId),
    db('suppliers').where({ dealer_id: dealerId }).select('id', 'name'),
  ]);
  const sm = new Map(
    (suppliers as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  );
  return readRows
    .map((r) => ({
      supplierId: r.supplier_id,
      supplierName: sm.get(r.supplier_id) ?? '—',
      totalDebit: r.outstanding,
      totalCredit: 0,
      balance: r.outstanding,
    }))
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

/** Oldest unpaid sale date per customer (for aging badges). */
export async function getOldestUnpaidSaleDateByCustomer(
  dealerId: string,
  customerIds?: string[],
): Promise<Map<string, string>> {
  let q = db('sales')
    .where({ dealer_id: dealerId })
    .where('due_amount', '>', 0)
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
