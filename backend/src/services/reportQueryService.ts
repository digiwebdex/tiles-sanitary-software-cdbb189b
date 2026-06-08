/**
 * Shared balance queries for reports, dashboard, collections, and financials.
 * All customer/supplier outstanding math flows through ledgerBalance helpers here.
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

/** Σ positive customer ledger balances (matches Collections grand total). */
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

/** Σ sales.due_amount — matches Due Aging report grand total. */
export async function sumCustomerOutstandingFromSales(dealerId: string): Promise<number> {
  const row = await db('sales').where({ dealer_id: dealerId }).sum({ total: 'due_amount' }).first();
  return round2(num(row?.total));
}

/** Total AP = Σ per-supplier outstanding (dashboard, financials, supplier reports). */
export async function sumSupplierPayable(
  dealerId: string,
  asOf?: string | null,
): Promise<number> {
  const entries = await fetchSupplierLedgerEntries(dealerId, { asOf });
  const grouped = groupSupplierLedger(entries);
  let total = 0;
  for (const rows of grouped.values()) {
    total += computeSupplierOutstanding(rows);
  }
  return round2(total);
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
