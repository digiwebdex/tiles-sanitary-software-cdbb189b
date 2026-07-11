import type { Knex } from 'knex';
import {
  buildPurchasePaymentSummary,
  computePurchaseNetPayable,
  sumPurchaseLedgerPayments,
} from './purchasePaymentSummary';
import { getSupplierOutstandingFromReadModel } from '../services/reportQueryService';
import { isPostingEngineEnabled, mirrorToPostingTables } from '../services/posting/PostingOrchestrator';
import { buildSupplierPaymentLines } from '../services/posting/LedgerPostingEngine';

export interface RecordSupplierPaymentInput {
  dealerId: string;
  purchaseId: string;
  amount: number;
  note?: string;
  /** bank_accounts.id — null/undefined = cash */
  paid_account_id?: string | null;
  entry_date?: string;
}

export interface RecordSupplierFifoPaymentInput {
  dealerId: string;
  supplierId: string;
  amount: number;
  note?: string;
  paid_account_id?: string | null;
  entry_date?: string;
  /** When set, entire payment applies to this purchase only. */
  purchaseId?: string;
}

export interface SupplierPaymentAllocation {
  purchaseId: string;
  invoiceNumber: string | null;
  amount: number;
  dueAfter: number;
  payment_status: 'paid' | 'partial' | 'pending';
}

export interface RecordSupplierPaymentResult {
  totalApplied: number;
  dueAfter: number;
  payment_status: 'paid' | 'partial' | 'pending';
}

export interface RecordSupplierFifoPaymentResult {
  allocations: SupplierPaymentAllocation[];
  totalApplied: number;
}

type PurchaseRow = {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  total_amount: number | string;
  voucher_discount?: number | string | null;
  supplier_id: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function validatePaidAccount(
  trx: Knex.Transaction,
  dealerId: string,
  paidAccountId: string | null,
): Promise<void> {
  if (!paidAccountId) return;
  const acct = await trx('bank_accounts')
    .where({ id: paidAccountId, dealer_id: dealerId })
    .first('id');
  if (!acct) throw new Error('paid_account_id not found for this dealer');
}

async function postSupplierOutflow(
  trx: Knex.Transaction,
  input: {
    dealerId: string;
    paidAccountId: string | null;
    amount: number;
    supplierName: string;
    description: string;
    referenceId: string | null;
    entryDate: string;
  },
): Promise<void> {
  const userId = null;

  if (input.paidAccountId) {
    await trx('bank_ledger').insert({
      dealer_id: input.dealerId,
      bank_account_id: input.paidAccountId,
      type: 'payment',
      amount: -input.amount,
      description: input.description,
      reference_type: 'purchases',
      reference_id: input.referenceId,
      entry_date: input.entryDate,
      created_by: userId,
    });
  } else {
    await trx('cash_ledger').insert({
      dealer_id: input.dealerId,
      type: 'payment',
      amount: -input.amount,
      description: input.description,
      reference_type: 'purchases',
      reference_id: input.referenceId,
      entry_date: input.entryDate,
    });
  }
}

async function loadPurchasesToPay(
  trx: Knex.Transaction,
  dealerId: string,
  supplierId: string,
  purchaseId?: string,
): Promise<Array<PurchaseRow & { due_amount: number; paid_amount: number }>> {
  // V2 Sprint 6B fix: a draft (not-yet-finalized) Purchase Invoice must not
  // be payable, whether reached via FIFO or targeted by purchaseId — only a
  // posted bill has a real, final due amount.
  let q = trx('purchases')
    .where({ dealer_id: dealerId, supplier_id: supplierId, document_status: 'posted' })
    .orderBy('purchase_date', 'asc')
    .orderBy('invoice_number', 'asc')
    .forUpdate();

  if (purchaseId) q = q.where({ id: purchaseId });

  const purchases = (await q.select(
    'id',
    'invoice_number',
    'purchase_date',
    'total_amount',
    'voucher_discount',
    'supplier_id',
  )) as PurchaseRow[];

  if (purchaseId && !purchases.length) {
    throw new Error('Purchase not found');
  }

  const paidMap = await sumPurchaseLedgerPayments(
    dealerId,
    purchases.map((p) => p.id),
    trx,
  );

  return purchases
    .map((p) => {
      const summary = buildPurchasePaymentSummary(p, paidMap.get(p.id) || 0);
      return { ...p, due_amount: summary.due_amount, paid_amount: summary.paid_amount };
    })
    .filter((p) => (purchaseId ? true : p.due_amount > 0.01));
}

/**
 * Pay a supplier; allocates to oldest due purchase bills first (FIFO).
 * Mirrors recordCustomerPayment on the customer/collections side.
 */
export async function recordSupplierPaymentFifo(
  trx: Knex.Transaction,
  input: RecordSupplierFifoPaymentInput,
): Promise<RecordSupplierFifoPaymentResult> {
  if (!(input.amount > 0)) {
    throw new Error('Payment amount must be positive');
  }

  const entryDate = input.entry_date ?? new Date().toISOString().slice(0, 10);
  const paidAccountId = input.paid_account_id ?? null;

  const supplier = await trx('suppliers')
    .where({ id: input.supplierId, dealer_id: input.dealerId })
    .first('name');
  if (!supplier) throw new Error('Supplier not found');

  await validatePaidAccount(trx, input.dealerId, paidAccountId);

  const purchasesToPay = await loadPurchasesToPay(
    trx,
    input.dealerId,
    input.supplierId,
    input.purchaseId,
  );

  const billDue = purchasesToPay.reduce((sum, p) => sum + p.due_amount, 0);
  const readModelDue = await getSupplierOutstandingFromReadModel(input.dealerId, input.supplierId);
  const maxPayable = input.purchaseId ? billDue : readModelDue;
  if (input.amount > maxPayable + 0.01) {
    throw new Error(`Payment exceeds supplier outstanding (max ${maxPayable.toFixed(2)})`);
  }

  let remaining = input.amount;
  const allocations: SupplierPaymentAllocation[] = [];
  let firstLedgerRowId: string | undefined;

  for (const purchase of purchasesToPay) {
    if (remaining <= 0) break;
    const due = purchase.due_amount;
    if (due <= 0) continue;

    const apply = input.purchaseId ? remaining : Math.min(remaining, due);
    if (apply <= 0) continue;

    const invoiceLabel = purchase.invoice_number ?? purchase.id;
    const description =
      input.note?.trim() ||
      (input.purchaseId
        ? `Payment for Purchase ${invoiceLabel}`
        : `Payment allocated to Purchase ${invoiceLabel}`);

    const [ledgerRow] = await trx('supplier_ledger')
      .insert({
        dealer_id: input.dealerId,
        supplier_id: input.supplierId,
        purchase_id: purchase.id,
        type: 'payment',
        amount: apply,
        description,
        entry_date: entryDate,
      })
      .returning('id');
    firstLedgerRowId ??= ledgerRow.id as string;

    const dueAfter = round2(Math.max(0, due - apply));
    const payment_status =
      dueAfter <= 0.01 ? 'paid' : purchase.paid_amount + apply > 0 ? 'partial' : 'pending';

    allocations.push({
      purchaseId: purchase.id,
      invoiceNumber: purchase.invoice_number,
      amount: apply,
      dueAfter,
      payment_status,
    });

    remaining -= apply;
    if (input.purchaseId) break;
  }

  if (allocations.length === 0) {
    throw new Error('No outstanding purchase bills to apply payment');
  }

  const totalApplied = round2(input.amount - remaining);
  const firstLabel = allocations[0]?.invoiceNumber ?? allocations[0]?.purchaseId ?? '';

  await postSupplierOutflow(trx, {
    dealerId: input.dealerId,
    paidAccountId,
    amount: totalApplied,
    supplierName: supplier.name,
    description: paidAccountId
      ? `Supplier payment: ${firstLabel}`
      : `Supplier payment to ${supplier.name}: ${firstLabel}`,
    referenceId: allocations[0]?.purchaseId ?? null,
    entryDate,
  });

  // V2 Sprint 6B — mirror into the Posting Engine (buildSupplierPaymentLines
  // already existed, unused, since Sprint 6A; this is its first caller).
  if (isPostingEngineEnabled() && firstLedgerRowId) {
    await mirrorToPostingTables(
      {
        trx,
        dealerId: input.dealerId,
        documentType: 'payment',
        documentId: firstLedgerRowId,
        eventType: 'posted',
        entryDate,
        idempotencyKey: `supplier_payment:${firstLedgerRowId}`,
      },
      buildSupplierPaymentLines({
        supplierId: input.supplierId,
        entryDate,
        paidAccountId,
        allocations: allocations.map((a) => ({ purchaseId: a.purchaseId, amount: a.amount })),
        totalApplied,
      }),
    );
  }

  return { allocations, totalApplied };
}

/**
 * Record payment against a specific purchase bill.
 */
export async function recordSupplierPayment(
  trx: Knex.Transaction,
  input: RecordSupplierPaymentInput,
): Promise<RecordSupplierPaymentResult> {
  const purchase = await trx('purchases')
    .where({ id: input.purchaseId, dealer_id: input.dealerId })
    .first('supplier_id');
  if (!purchase?.supplier_id) throw new Error('Purchase not found');

  const result = await recordSupplierPaymentFifo(trx, {
    dealerId: input.dealerId,
    supplierId: purchase.supplier_id,
    amount: input.amount,
    note: input.note,
    paid_account_id: input.paid_account_id,
    entry_date: input.entry_date,
    purchaseId: input.purchaseId,
  });

  const alloc = result.allocations[0];
  if (!alloc) throw new Error('No outstanding purchase bills to apply payment');

  return {
    totalApplied: result.totalApplied,
    dueAfter: alloc.dueAfter,
    payment_status: alloc.payment_status,
  };
}

export { computePurchaseNetPayable, buildPurchasePaymentSummary };
