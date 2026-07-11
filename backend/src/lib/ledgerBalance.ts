/**
 * Canonical balance helpers for customer and supplier ledgers.
 *
 * Convention (fresh data / go-forward):
 *   customer_ledger amounts are POSITIVE magnitudes; balance is computed by entry type.
 *   supplier_ledger: purchase rows are negative (we owe); payment/refund rows are positive.
 */

export type CustomerLedgerRow = { type: string; amount: number | string };
export type SupplierLedgerRow = { type: string; amount: number | string };

function num(v: number | string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Customer balance: positive = customer owes dealer. */
export function computeCustomerBalance(rows: CustomerLedgerRow[]): number {
  let balance = 0;
  for (const row of rows) {
    const amt = num(row.amount);
    if (row.type === 'sale' || row.type === 'adjustment' || row.type === 'opening_balance') {
      balance += amt;
    } else if (row.type === 'payment' || row.type === 'refund') {
      balance -= amt;
    }
  }
  return round2(balance);
}

/**
 * Supplier balance: positive = dealer owes supplier.
 * Purchases are stored as negative amounts; payments/refunds as positive.
 */
export function computeSupplierBalance(rows: SupplierLedgerRow[]): number {
  let balance = 0;
  for (const row of rows) {
    const amt = num(row.amount);
    if (row.type === 'purchase') {
      balance += -amt;
    } else if (row.type === 'payment' || row.type === 'refund') {
      balance -= amt;
    } else {
      balance += -amt;
    }
  }
  return round2(balance);
}

/** Alias: outstanding payable when balance > 0. */
export function computeSupplierOutstanding(rows: SupplierLedgerRow[]): number {
  return Math.max(0, computeSupplierBalance(rows));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
