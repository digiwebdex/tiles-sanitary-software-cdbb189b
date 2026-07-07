/**
 * V2 Sprint 6B — Customer/Supplier Opening Balance posting.
 *
 * Closes the gap documented in docs/SPRINT6B_AR_AP.md's inspection: neither
 * `customers.opening_balance` nor `suppliers.opening_balance` (immutable,
 * set once at creation) was ever mirrored into a ledger row or the GL. This
 * posts exactly one `customer_ledger`/`supplier_ledger` row per party (type
 * 'opening_balance', idempotent — a second call is a safe no-op) and, when
 * the Posting Engine is enabled, one balanced GL entry against a dedicated
 * Opening Balance Equity suspense account (GL_CODES.OPENING_BALANCE_EQUITY;
 * see glLineMapper.ts's 'opening_balance' case) rather than Sales/COGS.
 *
 * Sign convention matches each ledger's own existing rule exactly, so the
 * figure lands correctly in computeCustomerBalance/computeSupplierBalance
 * and mv_customer_outstanding/mv_supplier_payable without any special-casing
 * there beyond what migration 099 / ledgerBalance.ts already added:
 *   - customer_ledger: 'sale'/'adjustment'/'opening_balance' all add directly
 *     (a positive amount = customer owes more) — stored as-is.
 *   - supplier_ledger: 'purchase' (and, by the same generic bucket,
 *     'opening_balance') stores a NEGATIVE amount for "we owe more" — the
 *     value is negated on write to match.
 */
import type { Knex } from 'knex';
import { mirrorToPostingTables } from '../posting/PostingOrchestrator';
import { isPostingEngineEnabled } from '../posting/PostingOrchestrator';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface OpeningBalancePostResult {
  posted: boolean;
  ledgerRowId?: string;
  batchId?: string | null;
}

export async function postCustomerOpeningBalance(
  trx: Knex.Transaction,
  params: { dealerId: string; customerId: string; amount: number; entryDate: string; postedBy?: string | null },
): Promise<OpeningBalancePostResult> {
  const amount = round2(params.amount);
  if (amount === 0) return { posted: false };

  const existing = await trx('customer_ledger')
    .where({ dealer_id: params.dealerId, customer_id: params.customerId, type: 'opening_balance' })
    .first('id');
  if (existing) return { posted: false };

  const [row] = await trx('customer_ledger')
    .insert({
      dealer_id: params.dealerId,
      customer_id: params.customerId,
      type: 'opening_balance',
      amount,
      description: 'Opening balance',
      entry_date: params.entryDate,
    })
    .returning('id');

  let batchId: string | null = null;
  if (isPostingEngineEnabled()) {
    const posting = await mirrorToPostingTables(
      {
        trx,
        dealerId: params.dealerId,
        documentType: 'opening_balance',
        documentId: params.customerId,
        eventType: 'posted',
        entryDate: params.entryDate,
        postedBy: params.postedBy ?? null,
        idempotencyKey: `opening_balance:customer:${params.customerId}`,
      },
      [
        {
          lineDomain: 'customer',
          lineType: 'opening_balance',
          amount,
          entryDate: params.entryDate,
          partyId: params.customerId,
        },
      ],
    );
    batchId = posting.batchId;
  }

  return { posted: true, ledgerRowId: row.id, batchId };
}

export async function postSupplierOpeningBalance(
  trx: Knex.Transaction,
  params: { dealerId: string; supplierId: string; amount: number; entryDate: string; postedBy?: string | null },
): Promise<OpeningBalancePostResult> {
  const amount = round2(params.amount);
  if (amount === 0) return { posted: false };

  const existing = await trx('supplier_ledger')
    .where({ dealer_id: params.dealerId, supplier_id: params.supplierId, type: 'opening_balance' })
    .first('id');
  if (existing) return { posted: false };

  // Negate: supplier_ledger stores "we owe more" as a negative amount
  // (matches the 'purchase' row convention — see ledgerBalance.ts).
  const ledgerAmount = -amount;

  const [row] = await trx('supplier_ledger')
    .insert({
      dealer_id: params.dealerId,
      supplier_id: params.supplierId,
      type: 'opening_balance',
      amount: ledgerAmount,
      description: 'Opening balance',
      entry_date: params.entryDate,
    })
    .returning('id');

  let batchId: string | null = null;
  if (isPostingEngineEnabled()) {
    const posting = await mirrorToPostingTables(
      {
        trx,
        dealerId: params.dealerId,
        documentType: 'opening_balance',
        documentId: params.supplierId,
        eventType: 'posted',
        entryDate: params.entryDate,
        postedBy: params.postedBy ?? null,
        idempotencyKey: `opening_balance:supplier:${params.supplierId}`,
      },
      [
        {
          lineDomain: 'supplier',
          lineType: 'opening_balance',
          amount: ledgerAmount,
          entryDate: params.entryDate,
          partyId: params.supplierId,
        },
      ],
    );
    batchId = posting.batchId;
  }

  return { posted: true, ledgerRowId: row.id, batchId };
}
