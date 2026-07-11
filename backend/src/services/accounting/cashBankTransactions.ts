/**
 * V2 Sprint 6C — Cashbook / Bank Book core operations.
 *
 * Every function here does exactly two things inside the caller's
 * transaction: (1) insert the legacy `cash_ledger`/`bank_ledger` row(s),
 * unchanged in shape from how every prior sprint has written them; (2)
 * mirror into the Posting Engine when enabled, following the exact
 * dual-write pattern established in Sprints 6A/6B.
 *
 * GL shape:
 *   - Cash Receipt / Cash Payment / Bank Deposit / Bank Withdrawal are each
 *     a SINGLE posting line (the 'cash'/'bank' domain already maps by sign
 *     alone — see glLineMapper.ts). Since there's no specific counter-
 *     account for a miscellaneous, not-otherwise-linked cash/bank movement,
 *     the batch is intentionally left as one line; `balanceGlDrafts`'s
 *     existing, already-tested "add a Clearing plug" fallback absorbs the
 *     other side — the same treatment already documented as expected for
 *     "genuine Clearing-designated events" (glLineMapper.ts's own
 *     docstring). A future sprint could let the caller pick a specific GL
 *     account/category instead; not built here (see Deferred Items).
 *   - Transfer is TWO posting lines (source -amount, destination +amount)
 *     in the SAME batch — these balance each other directly, no Clearing.
 */
import type { Knex } from 'knex';
import { isPostingEngineEnabled, mirrorToPostingTables } from '../posting/PostingOrchestrator';
import type { PostingLineInput } from '../posting/types';
import type { PaymentModeId } from '../../lib/paymentModes';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CashBankTxResult {
  ledgerRowIds: string[];
  batchId: string | null;
}

async function mirror(
  trx: Knex.Transaction,
  dealerId: string,
  documentType: Parameters<typeof mirrorToPostingTables>[0]['documentType'],
  documentId: string,
  entryDate: string,
  idempotencyKey: string,
  lines: PostingLineInput[],
  postedBy?: string | null,
): Promise<string | null> {
  if (!isPostingEngineEnabled()) return null;
  const posting = await mirrorToPostingTables(
    { trx, dealerId, documentType, documentId, eventType: 'posted', entryDate, postedBy: postedBy ?? null, idempotencyKey },
    lines,
  );
  return posting.batchId;
}

export interface CashMovementInput {
  dealerId: string;
  amount: number;
  description: string;
  entryDate: string;
  paymentMode?: PaymentModeId | null;
  referenceType?: string | null;
  referenceId?: string | null;
  postedBy?: string | null;
}

export async function recordCashReceipt(trx: Knex.Transaction, input: CashMovementInput): Promise<CashBankTxResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Receipt amount must be positive');
  const [row] = await trx('cash_ledger')
    .insert({
      dealer_id: input.dealerId,
      type: 'receipt',
      amount,
      description: input.description,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      payment_mode: input.paymentMode ?? null,
    })
    .returning('id');
  const batchId = await mirror(
    trx, input.dealerId, 'cash_receipt', row.id, input.entryDate, `cash_receipt:${row.id}`,
    [{ lineDomain: 'cash', lineType: 'receipt', amount, entryDate: input.entryDate }],
    input.postedBy,
  );
  return { ledgerRowIds: [row.id], batchId };
}

export async function recordCashPayment(trx: Knex.Transaction, input: CashMovementInput): Promise<CashBankTxResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Payment amount must be positive');
  const [row] = await trx('cash_ledger')
    .insert({
      dealer_id: input.dealerId,
      type: 'payment',
      amount: -amount,
      description: input.description,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      payment_mode: input.paymentMode ?? null,
    })
    .returning('id');
  const batchId = await mirror(
    trx, input.dealerId, 'cash_payment', row.id, input.entryDate, `cash_payment:${row.id}`,
    [{ lineDomain: 'cash', lineType: 'payment', amount: -amount, entryDate: input.entryDate }],
    input.postedBy,
  );
  return { ledgerRowIds: [row.id], batchId };
}

export interface BankMovementInput {
  dealerId: string;
  bankAccountId: string;
  amount: number;
  description: string;
  entryDate: string;
  paymentMode?: PaymentModeId | null;
  chequeNo?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  postedBy?: string | null;
}

export async function recordBankDeposit(trx: Knex.Transaction, input: BankMovementInput): Promise<CashBankTxResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Deposit amount must be positive');
  const acct = await trx('bank_accounts').where({ id: input.bankAccountId, dealer_id: input.dealerId }).first('id');
  if (!acct) throw new Error('Bank account not found');
  const [row] = await trx('bank_ledger')
    .insert({
      dealer_id: input.dealerId,
      bank_account_id: input.bankAccountId,
      type: 'deposit',
      amount,
      description: input.description,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      payment_mode: input.paymentMode ?? null,
      cheque_no: input.chequeNo ?? null,
      created_by: input.postedBy ?? null,
    })
    .returning('id');
  const batchId = await mirror(
    trx, input.dealerId, 'bank_deposit', row.id, input.entryDate, `bank_deposit:${row.id}`,
    [{ lineDomain: 'bank', lineType: 'deposit', amount, entryDate: input.entryDate, metadata: { bank_account_id: input.bankAccountId } }],
    input.postedBy,
  );
  return { ledgerRowIds: [row.id], batchId };
}

export async function recordBankWithdrawal(trx: Knex.Transaction, input: BankMovementInput): Promise<CashBankTxResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Withdrawal amount must be positive');
  const acct = await trx('bank_accounts').where({ id: input.bankAccountId, dealer_id: input.dealerId }).first('id');
  if (!acct) throw new Error('Bank account not found');
  // A withdrawal made by cheque enters the Cheque Register as 'issued' — the
  // starting state of the outstanding-cheques lifecycle this sprint adds.
  const chequeStatus = input.chequeNo ? 'issued' : null;
  const [row] = await trx('bank_ledger')
    .insert({
      dealer_id: input.dealerId,
      bank_account_id: input.bankAccountId,
      type: 'withdrawal',
      amount: -amount,
      description: input.description,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      payment_mode: input.paymentMode ?? null,
      cheque_no: input.chequeNo ?? null,
      cheque_status: chequeStatus,
      created_by: input.postedBy ?? null,
    })
    .returning('id');
  const batchId = await mirror(
    trx, input.dealerId, 'bank_withdrawal', row.id, input.entryDate, `bank_withdrawal:${row.id}`,
    [{ lineDomain: 'bank', lineType: 'withdrawal', amount: -amount, entryDate: input.entryDate, metadata: { bank_account_id: input.bankAccountId } }],
    input.postedBy,
  );
  return { ledgerRowIds: [row.id], batchId };
}

export type TransferEndpoint =
  | { kind: 'cash' }
  | { kind: 'bank'; bankAccountId: string };

export interface TransferInput {
  dealerId: string;
  from: TransferEndpoint;
  to: TransferEndpoint;
  amount: number;
  description: string;
  entryDate: string;
  postedBy?: string | null;
}

function sameEndpoint(a: TransferEndpoint, b: TransferEndpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cash') return true;
  return a.bankAccountId === (b as { kind: 'bank'; bankAccountId: string }).bankAccountId;
}

/** Cash<->Bank or Bank<->Bank transfer — one balanced 2-line GL batch, no Clearing. */
export async function recordTransfer(trx: Knex.Transaction, input: TransferInput): Promise<CashBankTxResult> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Transfer amount must be positive');
  if (sameEndpoint(input.from, input.to)) throw new Error('Transfer source and destination must differ');

  if (input.from.kind === 'bank') {
    const acct = await trx('bank_accounts').where({ id: input.from.bankAccountId, dealer_id: input.dealerId }).first('id');
    if (!acct) throw new Error('Source bank account not found');
  }
  if (input.to.kind === 'bank') {
    const acct = await trx('bank_accounts').where({ id: input.to.bankAccountId, dealer_id: input.dealerId }).first('id');
    if (!acct) throw new Error('Destination bank account not found');
  }

  async function insertLeg(endpoint: TransferEndpoint, signedAmount: number, otherRefId: string | null): Promise<{ id: string; table: 'cash_ledger' | 'bank_ledger' }> {
    if (endpoint.kind === 'cash') {
      const [row] = await trx('cash_ledger')
        .insert({
          dealer_id: input.dealerId,
          type: 'transfer',
          amount: signedAmount,
          description: input.description,
          reference_type: 'transfer',
          reference_id: otherRefId,
          entry_date: input.entryDate,
        })
        .returning('id');
      return { id: row.id, table: 'cash_ledger' };
    }
    const [row] = await trx('bank_ledger')
      .insert({
        dealer_id: input.dealerId,
        bank_account_id: endpoint.bankAccountId,
        type: 'transfer',
        amount: signedAmount,
        description: input.description,
        reference_type: 'transfer',
        reference_id: otherRefId,
        entry_date: input.entryDate,
        created_by: input.postedBy ?? null,
      })
      .returning('id');
    return { id: row.id, table: 'bank_ledger' };
  }

  const fromLeg = await insertLeg(input.from, -amount, null);
  const toLeg = await insertLeg(input.to, amount, fromLeg.id);
  await trx(fromLeg.table).where({ id: fromLeg.id }).update({ reference_id: toLeg.id });

  const lines: PostingLineInput[] = [
    input.from.kind === 'cash'
      ? { lineDomain: 'cash', lineType: 'transfer', amount: -amount, entryDate: input.entryDate }
      : { lineDomain: 'bank', lineType: 'transfer', amount: -amount, entryDate: input.entryDate, metadata: { bank_account_id: input.from.bankAccountId } },
    input.to.kind === 'cash'
      ? { lineDomain: 'cash', lineType: 'transfer', amount, entryDate: input.entryDate }
      : { lineDomain: 'bank', lineType: 'transfer', amount, entryDate: input.entryDate, metadata: { bank_account_id: input.to.bankAccountId } },
  ];
  const batchId = await mirror(
    trx, input.dealerId, 'transfer', fromLeg.id, input.entryDate, `transfer:${fromLeg.id}`,
    lines, input.postedBy,
  );

  return { ledgerRowIds: [fromLeg.id, toLeg.id], batchId };
}
