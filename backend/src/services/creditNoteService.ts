import type { Knex } from 'knex';
import { db } from '../db/connection';

/**
 * V2 Sprint 4D — Credit Note.
 *
 * A "Credit Note" in this system is simply a Sales Return whose
 * `refund_mode = 'credit'`: no cash/bank leaves the till (returns.ts skips
 * the cash_ledger/bank_ledger posting for that mode), but the
 * `customer_ledger` 'refund' row it ALREADY inserts unconditionally is
 * exactly the credit — customerStatements.ts's due-balance formula already
 * treats any 'refund' row as reducing due_balance regardless of mode, so
 * the credit is correctly reflected the moment the return is recorded,
 * without touching that frozen file.
 *
 * This mirrors Sprint 4C's `advancePaymentService.ts` pattern exactly (a
 * separate, parallel table — not a shared one — so Sprint 4C's own frozen
 * file is never modified): `customer_credit_note_applications` tracks how
 * much of a customer's aggregate credit-note balance has been applied
 * against a specific invoice.
 */

/** Pure — never negative, rounded to 2dp. Mirrors advancePaymentService's own helper. */
export function computeUnappliedCreditNoteBalance(received: number, applied: number): number {
  return Math.max(0, Math.round((received - applied) * 100) / 100);
}

/**
 * Aggregate unapplied credit-note balance for a customer = SUM of
 * refund_amount across all their credit-mode sales_returns − SUM of
 * applications made so far.
 */
export async function getCreditNoteBalance(dealerId: string, customerId: string): Promise<number> {
  const [receivedRow, appliedRow] = await Promise.all([
    db('sales_returns as sr')
      .join('sales as s', 's.id', 'sr.sale_id')
      .where({ 's.dealer_id': dealerId, 's.customer_id': customerId, 'sr.refund_mode': 'credit' })
      .sum<{ sum: string | null }[]>('sr.refund_amount as sum')
      .first(),
    db('customer_credit_note_applications')
      .where({ dealer_id: dealerId, customer_id: customerId })
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
  ]);
  return computeUnappliedCreditNoteBalance(Number(receivedRow?.sum ?? 0), Number(appliedRow?.sum ?? 0));
}

export interface ApplyCreditNoteInput {
  dealerId: string;
  customerId: string;
  saleId: string;
  amount: number;
  appliedBy?: string | null;
}

export async function applyCreditNoteToSale(trx: Knex.Transaction, input: ApplyCreditNoteInput): Promise<{ newDue: number }> {
  if (!(input.amount > 0)) throw new Error('Amount to apply must be positive');

  const sale = await trx('sales')
    .where({ id: input.saleId, dealer_id: input.dealerId, customer_id: input.customerId })
    .forUpdate()
    .first('id', 'due_amount', 'paid_amount', 'total_amount', 'discount');
  if (!sale) throw new Error('Sale not found');

  const due = Number(sale.due_amount) || 0;
  if (input.amount > due + 0.01) {
    throw new Error(`Amount exceeds this invoice's outstanding balance (max ${due.toFixed(2)})`);
  }

  // Re-check balance under lock (via the customer row) to avoid a
  // concurrent application over-spending the same credit note pool.
  await trx('customers').where({ id: input.customerId, dealer_id: input.dealerId }).forUpdate().first('id');
  const [receivedRow, appliedRow] = await Promise.all([
    trx('sales_returns as sr')
      .join('sales as s', 's.id', 'sr.sale_id')
      .where({ 's.dealer_id': input.dealerId, 's.customer_id': input.customerId, 'sr.refund_mode': 'credit' })
      .sum<{ sum: string | null }[]>('sr.refund_amount as sum')
      .first(),
    trx('customer_credit_note_applications')
      .where({ dealer_id: input.dealerId, customer_id: input.customerId })
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
  ]);
  const balance = computeUnappliedCreditNoteBalance(Number(receivedRow?.sum ?? 0), Number(appliedRow?.sum ?? 0));
  if (input.amount > balance + 0.01) {
    throw new Error(`Amount exceeds unapplied credit note balance (max ${balance.toFixed(2)})`);
  }

  const newPaid = (Number(sale.paid_amount) || 0) + input.amount;
  const maxPayable = Math.max(0, Number(sale.total_amount) - Number(sale.discount));
  const newDue = Math.max(0, maxPayable - newPaid);

  await trx('sales').where({ id: sale.id }).update({ paid_amount: newPaid, due_amount: newDue });
  await trx('customer_credit_note_applications').insert({
    dealer_id: input.dealerId,
    customer_id: input.customerId,
    sale_id: input.saleId,
    amount: input.amount,
    applied_by: input.appliedBy ?? null,
  });

  return { newDue };
}
