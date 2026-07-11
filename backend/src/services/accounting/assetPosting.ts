/**
 * V2 Sprint 6D — Fixed Asset GL posting (Purchase / Disposal / Depreciation).
 *
 * Reuses the Posting Engine choke point exactly as Sprints 6A-6C did
 * (`mirrorToPostingTables` → `persistPostingBatch` → `glLineMapper.ts`'s new
 * 'asset' domain case) — no new posting mechanism, just three new callers.
 *
 * Sign/shape design (see glLineMapper.ts's 'asset' case for the GL side):
 *   - Purchase: one 'asset'/'purchase' line (debit Fixed Assets), optionally
 *     paired with a 'cash'/'bank' line for the funding side (mirrors the
 *     existing cash/bank domain's own sign convention exactly — no new
 *     logic). Unfunded (on-account / already-owned) purchases fall back to
 *     the existing, already-tested Clearing plug in `balanceGlDrafts`, the
 *     same documented treatment cashBankTransactions.ts's receipt/payment
 *     lines use for a miscellaneous, not-otherwise-linked money movement.
 *   - Disposal: up to four 'asset' lines (cost, accumulated depreciation,
 *     gain XOR loss) plus an optional cash/bank line for proceeds — proven
 *     to balance exactly with no Clearing plug for any proceeds/book-value
 *     combination (see the worked algebra in this file's postAssetDisposal
 *     docstring).
 *   - Depreciation: one 'asset'/'depreciation' line; glLineMapper.ts expands
 *     it into the self-balanced Dr Depreciation Expense / Cr Accumulated
 *     Depreciation pair, the same "one posting line, two GL legs" shape
 *     already used by 'customer'/'sale' and 'stock'/'sale_out'.
 *
 * Idempotency: each function's caller-visible identity check lives on the
 * legacy `assets`/`asset_depreciation_schedule` row itself (mirrors the
 * openingBalancePosting.ts precedent of checking the legacy table, not
 * posting_batches, before deciding whether to post) — a batch-level
 * `idempotencyKey` is still passed as a second line of defense.
 */
import type { Knex } from 'knex';
import { isPostingEngineEnabled, mirrorToPostingTables } from '../posting/PostingOrchestrator';
import type { PostingLineInput } from '../posting/types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Depreciation math (pure functions, no I/O) ──────────────────────────

/** Constant monthly depreciation: (cost - salvage) / useful life, in months. */
export function computeStraightLineMonthlyDepreciation(
  cost: number,
  salvageValue: number,
  usefulLifeMonths: number,
): number {
  if (!(usefulLifeMonths > 0)) return 0;
  const depreciable = Math.max(0, round2(cost) - round2(salvageValue));
  return round2(depreciable / usefulLifeMonths);
}

/**
 * Monthly depreciation = book value at period start × (annual rate / 12),
 * capped so book value never drops below salvage value.
 */
export function computeDecliningBalanceMonthlyDepreciation(
  bookValueAtPeriodStart: number,
  annualRatePercent: number,
  salvageValue: number,
): number {
  const monthlyRate = annualRatePercent / 100 / 12;
  const raw = round2(bookValueAtPeriodStart) * monthlyRate;
  const maxAllowed = Math.max(0, round2(bookValueAtPeriodStart) - round2(salvageValue));
  return round2(Math.min(Math.max(0, raw), maxAllowed));
}

// ── GL posting ───────────────────────────────────────────────────────────

export type AssetFundingSource =
  | { kind: 'cash' }
  | { kind: 'bank'; bankAccountId: string };

export interface AssetPurchaseInput {
  dealerId: string;
  assetId: string;
  amount: number;
  entryDate: string;
  costCenterId?: string | null;
  projectId?: string | null;
  fundedBy?: AssetFundingSource | null;
  postedBy?: string | null;
}

export async function postAssetPurchase(
  trx: Knex.Transaction,
  input: AssetPurchaseInput,
): Promise<{ batchId: string | null }> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Asset purchase amount must be positive');
  if (!isPostingEngineEnabled()) return { batchId: null };

  const existing = await trx('assets')
    .where({ id: input.assetId, dealer_id: input.dealerId })
    .first('purchase_posting_batch_id');
  if (existing?.purchase_posting_batch_id) return { batchId: existing.purchase_posting_batch_id };

  const lines: PostingLineInput[] = [
    {
      lineDomain: 'asset', lineType: 'purchase', amount, entryDate: input.entryDate,
      costCenterId: input.costCenterId ?? null, projectId: input.projectId ?? null,
    },
  ];
  if (input.fundedBy?.kind === 'cash') {
    lines.push({ lineDomain: 'cash', lineType: 'payment', amount: -amount, entryDate: input.entryDate });
  } else if (input.fundedBy?.kind === 'bank') {
    lines.push({
      lineDomain: 'bank', lineType: 'withdrawal', amount: -amount, entryDate: input.entryDate,
      metadata: { bank_account_id: input.fundedBy.bankAccountId },
    });
  }

  const posting = await mirrorToPostingTables(
    {
      trx, dealerId: input.dealerId, documentType: 'fixed_asset_purchase', documentId: input.assetId,
      eventType: 'posted', entryDate: input.entryDate, postedBy: input.postedBy ?? null,
      idempotencyKey: `fixed_asset_purchase:${input.assetId}`,
    },
    lines,
  );
  await trx('assets')
    .where({ id: input.assetId, dealer_id: input.dealerId })
    .update({ purchase_posting_batch_id: posting.batchId });
  return { batchId: posting.batchId };
}

export interface AssetDisposalInput {
  dealerId: string;
  assetId: string;
  entryDate: string;
  originalCost: number;
  accumulatedDepreciation: number;
  disposalProceeds: number;
  proceedsReceivedVia?: AssetFundingSource | null;
  costCenterId?: string | null;
  projectId?: string | null;
  postedBy?: string | null;
}

/**
 * Disposal always balances exactly, no Clearing plug, for any combination:
 *   bookValue = cost - accumulated
 *   gainLoss  = proceeds - bookValue
 *
 *   Debits:  accumulated (clear contra-asset) + proceeds (cash/bank) + loss (if any)
 *   Credits: cost (remove asset) + gain (if any)
 *
 *   Gain case (proceeds > bookValue): debits = accumulated + proceeds
 *     = credits = cost + (proceeds - bookValue) = accumulated + proceeds. ✓
 *   Loss case (proceeds < bookValue): debits = accumulated + proceeds + (bookValue - proceeds)
 *     = accumulated + bookValue = cost = credits. ✓
 */
export async function postAssetDisposal(
  trx: Knex.Transaction,
  input: AssetDisposalInput,
): Promise<{ batchId: string | null; gainLoss: number }> {
  const cost = round2(input.originalCost);
  const accumulated = round2(input.accumulatedDepreciation);
  const proceeds = round2(input.disposalProceeds);
  const bookValue = round2(cost - accumulated);
  const gainLoss = round2(proceeds - bookValue);

  if (!isPostingEngineEnabled()) return { batchId: null, gainLoss };

  const existing = await trx('assets')
    .where({ id: input.assetId, dealer_id: input.dealerId })
    .first('disposal_posting_batch_id');
  if (existing?.disposal_posting_batch_id) return { batchId: existing.disposal_posting_batch_id, gainLoss };

  const lines: PostingLineInput[] = [
    {
      lineDomain: 'asset', lineType: 'disposal_cost', amount: cost, entryDate: input.entryDate,
      costCenterId: input.costCenterId ?? null, projectId: input.projectId ?? null,
    },
  ];
  if (accumulated > 0) {
    lines.push({ lineDomain: 'asset', lineType: 'disposal_accumulated_depreciation', amount: accumulated, entryDate: input.entryDate });
  }
  if (gainLoss > 0) {
    lines.push({ lineDomain: 'asset', lineType: 'disposal_gain', amount: gainLoss, entryDate: input.entryDate });
  } else if (gainLoss < 0) {
    lines.push({ lineDomain: 'asset', lineType: 'disposal_loss', amount: Math.abs(gainLoss), entryDate: input.entryDate });
  }
  if (proceeds > 0) {
    if (input.proceedsReceivedVia?.kind === 'bank') {
      lines.push({
        lineDomain: 'bank', lineType: 'deposit', amount: proceeds, entryDate: input.entryDate,
        metadata: { bank_account_id: input.proceedsReceivedVia.bankAccountId },
      });
    } else {
      lines.push({ lineDomain: 'cash', lineType: 'receipt', amount: proceeds, entryDate: input.entryDate });
    }
  }

  const posting = await mirrorToPostingTables(
    {
      trx, dealerId: input.dealerId, documentType: 'fixed_asset_disposal', documentId: input.assetId,
      eventType: 'posted', entryDate: input.entryDate, postedBy: input.postedBy ?? null,
      idempotencyKey: `fixed_asset_disposal:${input.assetId}`,
    },
    lines,
  );
  await trx('assets')
    .where({ id: input.assetId, dealer_id: input.dealerId })
    .update({ disposal_posting_batch_id: posting.batchId });
  return { batchId: posting.batchId, gainLoss };
}

export interface DepreciationPostingInput {
  dealerId: string;
  assetId: string;
  periodNo: number;
  entryDate: string;
  amount: number;
  costCenterId?: string | null;
  projectId?: string | null;
  postedBy?: string | null;
}

export async function postDepreciation(
  trx: Knex.Transaction,
  input: DepreciationPostingInput,
): Promise<{ batchId: string | null }> {
  const amount = round2(input.amount);
  if (!(amount > 0)) return { batchId: null };
  if (!isPostingEngineEnabled()) return { batchId: null };

  const existing = await trx('asset_depreciation_schedule')
    .where({ dealer_id: input.dealerId, asset_id: input.assetId, period_no: input.periodNo })
    .first('posting_batch_id');
  if (existing?.posting_batch_id) return { batchId: existing.posting_batch_id };

  const posting = await mirrorToPostingTables(
    {
      trx, dealerId: input.dealerId, documentType: 'depreciation', documentId: input.assetId,
      eventType: 'posted', entryDate: input.entryDate, postedBy: input.postedBy ?? null,
      idempotencyKey: `depreciation:${input.assetId}:${input.periodNo}`,
    },
    [
      {
        lineDomain: 'asset', lineType: 'depreciation', amount, entryDate: input.entryDate,
        costCenterId: input.costCenterId ?? null, projectId: input.projectId ?? null,
      },
    ],
  );
  return { batchId: posting.batchId };
}
