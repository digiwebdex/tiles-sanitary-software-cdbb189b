import type { Knex } from 'knex';
import { db } from '../db/connection';

export type PurchasePaymentStatus = 'paid' | 'partial' | 'pending';

export interface PurchasePaymentSummary {
  net_payable: number;
  paid_amount: number;
  due_amount: number;
  payment_status: PurchasePaymentStatus;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Net payable after voucher discount. */
export function computePurchaseNetPayable(purchase: {
  total_amount: number | string;
  voucher_discount?: number | string | null;
}): number {
  const total = Number(purchase.total_amount) || 0;
  const discount = Number(purchase.voucher_discount) || 0;
  return round2(Math.max(0, total - discount));
}

/**
 * Sum supplier_ledger payment rows linked to a purchase (includes paid_on_create).
 */
export async function sumPurchaseLedgerPayments(
  dealerId: string,
  purchaseIds: string[],
  trx?: Knex.Transaction,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!purchaseIds.length) return map;

  const conn = trx ?? db;
  const rows = await conn('supplier_ledger')
    .where({ dealer_id: dealerId, type: 'payment' })
    .whereIn('purchase_id', purchaseIds)
    .select('purchase_id', 'amount');

  for (const row of rows) {
    const pid = row.purchase_id as string;
    map.set(pid, round2((map.get(pid) || 0) + (Number(row.amount) || 0)));
  }
  return map;
}

export function buildPurchasePaymentSummary(
  purchase: {
    id: string;
    total_amount: number | string;
    voucher_discount?: number | string | null;
  },
  ledgerPaid: number,
): PurchasePaymentSummary {
  const net = computePurchaseNetPayable(purchase);
  const paid = round2(ledgerPaid);
  const due = round2(Math.max(0, net - paid));
  let payment_status: PurchasePaymentStatus = 'pending';
  if (due <= 0.01) payment_status = 'paid';
  else if (paid > 0) payment_status = 'partial';
  return { net_payable: net, paid_amount: paid, due_amount: due, payment_status };
}

export async function attachPurchasePaymentSummaries<T extends { id: string; total_amount: number | string; voucher_discount?: number | string | null }>(
  dealerId: string,
  purchases: T[],
): Promise<Array<T & PurchasePaymentSummary>> {
  const paidMap = await sumPurchaseLedgerPayments(
    dealerId,
    purchases.map((p) => p.id),
  );
  return purchases.map((p) => ({
    ...p,
    ...buildPurchasePaymentSummary(p, paidMap.get(p.id) || 0),
  }));
}
