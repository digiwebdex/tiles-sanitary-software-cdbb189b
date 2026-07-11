import type { Knex } from 'knex';
import { db } from '../db/connection';
import { postCustomerReceipt } from '../lib/customerPayment';
import { normalizePaymentMode, paymentModeRequiresBankAccount } from '../lib/paymentModes';

/**
 * V2 Sprint 4C — Advance Payment.
 *
 * `recordCustomerPayment()` (customerPayment.ts, Sprint 4A/P1-04, frozen)
 * REQUIRES at least one outstanding due sale — a customer literally cannot
 * pay in advance today ("No outstanding invoices to apply payment"). This
 * fills that gap while reusing everything else:
 *
 *   - An advance receipt is just a `customer_ledger` 'payment' row with
 *     `sale_id = NULL`, posted via the SAME `postCustomerReceipt()` used by
 *     every other payment — so it already reduces the customer's
 *     `due_balance` correctly in customerStatements.ts's formula
 *     (`type IN ('payment','refund')` is a credit) WITHOUT touching that
 *     frozen file at all.
 *   - "Applying" an advance to a specific invoice must NOT insert another
 *     customer_ledger credit (the cash was already counted once, at
 *     receipt). It only updates that one sale's own paid_amount/due_amount
 *     (same math recordCustomerPayment uses) and records the application in
 *     the new `customer_advance_applications` table so the remaining
 *     unapplied balance can be computed.
 */

export interface ReceiveAdvancePaymentInput {
  dealerId: string;
  customerId: string;
  amount: number;
  note?: string;
  payment_mode?: string;
  paid_account_id?: string | null;
  entry_date?: string;
}

export async function receiveAdvancePayment(
  trx: Knex.Transaction,
  input: ReceiveAdvancePaymentInput,
): Promise<{ id: string; amount: number }> {
  if (!(input.amount > 0)) throw new Error('Advance amount must be positive');

  const customer = await trx('customers').where({ id: input.customerId, dealer_id: input.dealerId }).first('name');
  if (!customer) throw new Error('Customer not found');

  const paidAccountId = input.paid_account_id ?? null;
  const paymentMode = normalizePaymentMode(input.payment_mode);
  if (paymentModeRequiresBankAccount(paymentMode) && !paidAccountId) {
    throw new Error('Bank account is required for bank, cheque, or card payments');
  }

  const entryDate = input.entry_date ?? new Date().toISOString().slice(0, 10);
  const description = input.note?.trim() || `Advance payment from ${customer.name}`;

  const [row] = await trx('customer_ledger')
    .insert({
      dealer_id: input.dealerId,
      customer_id: input.customerId,
      sale_id: null,
      type: 'payment',
      amount: input.amount,
      description,
      entry_date: entryDate,
    })
    .returning(['id', 'amount']);

  await postCustomerReceipt(trx, {
    dealerId: input.dealerId,
    amount: input.amount,
    description,
    referenceType: 'customer_advance',
    referenceId: row.id,
    entryDate,
    paidAccountId,
    payment_mode: paymentMode,
  });

  return { id: row.id, amount: Number(row.amount) };
}

/** Pure — never negative, rounded to 2dp. Split out for testability. */
export function computeUnappliedBalance(received: number, applied: number): number {
  return Math.max(0, Math.round((received - applied) * 100) / 100);
}

/** Unapplied advance balance = advances received (sale_id IS NULL) − applications made so far. */
export async function getAdvanceBalance(dealerId: string, customerId: string): Promise<number> {
  const [receivedRow, appliedRow] = await Promise.all([
    db('customer_ledger')
      .where({ dealer_id: dealerId, customer_id: customerId, type: 'payment' })
      .whereNull('sale_id')
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
    db('customer_advance_applications')
      .where({ dealer_id: dealerId, customer_id: customerId })
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
  ]);
  return computeUnappliedBalance(Number(receivedRow?.sum ?? 0), Number(appliedRow?.sum ?? 0));
}

export interface ApplyAdvanceInput {
  dealerId: string;
  customerId: string;
  saleId: string;
  amount: number;
  appliedBy?: string | null;
}

export async function applyAdvanceToSale(trx: Knex.Transaction, input: ApplyAdvanceInput): Promise<{ newDue: number }> {
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
  // concurrent application over-spending the same advance.
  await trx('customers').where({ id: input.customerId, dealer_id: input.dealerId }).forUpdate().first('id');
  const [receivedRow, appliedRow] = await Promise.all([
    trx('customer_ledger')
      .where({ dealer_id: input.dealerId, customer_id: input.customerId, type: 'payment' })
      .whereNull('sale_id')
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
    trx('customer_advance_applications')
      .where({ dealer_id: input.dealerId, customer_id: input.customerId })
      .sum<{ sum: string | null }[]>('amount as sum')
      .first(),
  ]);
  const balance = computeUnappliedBalance(Number(receivedRow?.sum ?? 0), Number(appliedRow?.sum ?? 0));
  if (input.amount > balance + 0.01) {
    throw new Error(`Amount exceeds unapplied advance balance (max ${balance.toFixed(2)})`);
  }

  const newPaid = (Number(sale.paid_amount) || 0) + input.amount;
  const maxPayable = Math.max(0, Number(sale.total_amount) - Number(sale.discount));
  const newDue = Math.max(0, maxPayable - newPaid);

  await trx('sales').where({ id: sale.id }).update({ paid_amount: newPaid, due_amount: newDue });
  await trx('customer_advance_applications').insert({
    dealer_id: input.dealerId,
    customer_id: input.customerId,
    sale_id: input.saleId,
    amount: input.amount,
    applied_by: input.appliedBy ?? null,
  });

  return { newDue };
}
