import type { Knex } from 'knex';
import {
  buildPurchasePaymentSummary,
  computePurchaseNetPayable,
  sumPurchaseLedgerPayments,
} from './purchasePaymentSummary';

export interface RecordSupplierPaymentInput {
  dealerId: string;
  purchaseId: string;
  amount: number;
  note?: string;
  /** bank_accounts.id — null/undefined = cash */
  paid_account_id?: string | null;
  entry_date?: string;
}

export interface RecordSupplierPaymentResult {
  totalApplied: number;
  dueAfter: number;
  payment_status: 'paid' | 'partial' | 'pending';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Record payment against a specific purchase bill.
 * Mirrors recordCustomerPayment for the supplier/purchase side:
 *   - supplier_ledger payment row (positive)
 *   - cash_ledger or bank_ledger outflow
 */
export async function recordSupplierPayment(
  trx: Knex.Transaction,
  input: RecordSupplierPaymentInput,
): Promise<RecordSupplierPaymentResult> {
  if (!(input.amount > 0)) {
    throw new Error('Payment amount must be positive');
  }

  const entryDate = input.entry_date ?? new Date().toISOString().slice(0, 10);

  const purchase = await trx('purchases')
    .where({ id: input.purchaseId, dealer_id: input.dealerId })
    .forUpdate()
    .first();
  if (!purchase) throw new Error('Purchase not found');

  const paidMap = await sumPurchaseLedgerPayments(input.dealerId, [input.purchaseId], trx);
  const summary = buildPurchasePaymentSummary(purchase, paidMap.get(input.purchaseId) || 0);

  if (input.amount > summary.due_amount + 0.01) {
    throw new Error(`Payment exceeds outstanding amount (max ${summary.due_amount.toFixed(2)})`);
  }

  const supplier = await trx('suppliers')
    .where({ id: purchase.supplier_id, dealer_id: input.dealerId })
    .first('name');
  if (!supplier) throw new Error('Supplier not found');

  const paidAccountId = input.paid_account_id ?? null;
  if (paidAccountId) {
    const acct = await trx('bank_accounts')
      .where({ id: paidAccountId, dealer_id: input.dealerId })
      .first('id');
    if (!acct) throw new Error('paid_account_id not found for this dealer');
  }

  const invoiceLabel = purchase.invoice_number ?? purchase.id;
  const description =
    input.note?.trim() ||
    `Payment for Purchase ${invoiceLabel}`;

  await trx('supplier_ledger').insert({
    dealer_id: input.dealerId,
    supplier_id: purchase.supplier_id,
    purchase_id: input.purchaseId,
    type: 'payment',
    amount: input.amount,
    description,
    entry_date: entryDate,
  });

  const userId = null; // optional created_by if column exists on bank_ledger

  if (paidAccountId) {
    await trx('bank_ledger').insert({
      dealer_id: input.dealerId,
      bank_account_id: paidAccountId,
      type: 'payment',
      amount: -input.amount,
      description: `Supplier payment: ${invoiceLabel}`,
      reference_type: 'purchases',
      reference_id: input.purchaseId,
      entry_date: entryDate,
      created_by: userId,
    });
  } else {
    await trx('cash_ledger').insert({
      dealer_id: input.dealerId,
      type: 'payment',
      amount: -input.amount,
      description: `Supplier payment to ${supplier.name}: ${invoiceLabel}`,
      reference_type: 'purchases',
      reference_id: input.purchaseId,
      entry_date: entryDate,
    });
  }

  const dueAfter = round2(Math.max(0, summary.due_amount - input.amount));
  const payment_status =
    dueAfter <= 0.01 ? 'paid' : summary.paid_amount + input.amount > 0 ? 'partial' : 'pending';

  return {
    totalApplied: round2(input.amount),
    dueAfter,
    payment_status,
  };
}

export { computePurchaseNetPayable, buildPurchasePaymentSummary };
