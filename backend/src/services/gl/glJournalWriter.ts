/**
 * GL account chart + journal persistence (P6-01).
 */
import type { Knex } from 'knex';
import { db } from '../../db/connection';
import { DEFAULT_GL_CHART } from '../../lib/glChart';
import { mapPostingLinesToGl, type PostingLineForGl, type TaxSplit } from './glLineMapper';

export async function ensureDealerGlChart(trx: Knex.Transaction, dealerId: string) {
  const existing = await trx('gl_accounts').where({ dealer_id: dealerId }).first('id');
  if (existing) return;

  const rows = DEFAULT_GL_CHART.map((a) => ({
    dealer_id: dealerId,
    code: a.code,
    name: a.name,
    account_type: a.account_type,
    parent_code: a.parent_code ?? null,
    normal_balance: a.normal_balance,
    is_contra: a.is_contra ?? false,
    is_group: a.is_group ?? false,
    category: a.category ?? null,
    is_system: true,
    is_active: true,
  }));
  await trx('gl_accounts').insert(rows);
}

export async function getAccountIdMap(
  trx: Knex.Transaction,
  dealerId: string,
): Promise<Map<string, string>> {
  const rows = await trx('gl_accounts').where({ dealer_id: dealerId }).select('id', 'code');
  return new Map(rows.map((r) => [r.code as string, r.id as string]));
}

export interface MirrorGlInput {
  dealerId: string;
  postingBatchId: string;
  entryDate: string;
  documentType: string;
  documentId: string;
  description?: string | null;
  postingLineIds: string[];
  postingLines: PostingLineForGl[];
  /** 'posted' | 'reversed' — determines which batch's tax_posting_lines to look up (Bug A fix). */
  eventType?: string;
  /** The original batch id, when this is a reversal (mirrors posting_batches.reverses_batch_id). */
  reversesBatchId?: string | null;
}

/**
 * Look up the output-VAT effect for a batch's customer/sale line, per the
 * approved architecture's Bug A fix: VAT is sourced from `tax_posting_lines`
 * directly rather than duplicating VAT computation into a second code path.
 *
 * For a 'reversed' batch, the tax effect is looked up against the ORIGINAL
 * batch being reversed (`reversesBatchId`), not the reversal batch's own id
 * — the reversal batch never gets its own tax_posting_lines row (that gap
 * is Sprint 6E-scoped, per the roadmap), so without this lookup a reversal
 * would post an uncorrected gross amount to Sales Revenue and never touch
 * VAT Payable, leaving both accounts permanently wrong after any reversal.
 */
async function lookupTaxSplit(
  trx: Knex.Transaction,
  dealerId: string,
  input: Pick<MirrorGlInput, 'postingBatchId' | 'eventType' | 'reversesBatchId'>,
): Promise<TaxSplit | undefined> {
  const lookupBatchId =
    input.eventType === 'reversed' && input.reversesBatchId ? input.reversesBatchId : input.postingBatchId;
  const rows = await trx('tax_posting_lines')
    .where({ dealer_id: dealerId, posting_batch_id: lookupBatchId })
    .select('tax_amount', 'sd_amount');
  if (!rows.length) return undefined;
  const taxAmount = rows.reduce((sum, r) => sum + Number(r.tax_amount || 0), 0);
  const sdAmount = rows.reduce((sum, r) => sum + Number(r.sd_amount || 0), 0);
  if (taxAmount <= 0 && sdAmount <= 0) return undefined;
  return { taxAmount, sdAmount };
}

export async function mirrorPostingBatchToGl(trx: Knex.Transaction, input: MirrorGlInput) {
  if (!input.postingLines.length) return null;

  const existing = await trx('gl_journal_entries')
    .where({ posting_batch_id: input.postingBatchId })
    .first('id');
  if (existing) return existing.id as string;

  await ensureDealerGlChart(trx, input.dealerId);
  const accountMap = await getAccountIdMap(trx, input.dealerId);

  const taxSplit = await lookupTaxSplit(trx, input.dealerId, input);
  const { drafts, wasUnbalanced } = mapPostingLinesToGl(input.postingLines, taxSplit);
  if (wasUnbalanced) {
    // eslint-disable-next-line no-console
    console.warn(
      `[gl] posting batch ${input.postingBatchId} (${input.documentType}/${input.documentId}) required a Clearing plug — expected only for expense/landed-cost/cost-adjustment events, investigate if this fires for a plain sale/purchase.`,
    );
  }
  if (!drafts.length) return null;

  const [entry] = await trx('gl_journal_entries')
    .insert({
      dealer_id: input.dealerId,
      posting_batch_id: input.postingBatchId,
      entry_date: input.entryDate,
      description: input.description ?? null,
      document_type: input.documentType,
      document_id: input.documentId,
    })
    .returning('id');

  const journalId = entry.id as string;
  const lineRows = drafts
    .map((d) => {
      const accountId = accountMap.get(d.accountCode);
      if (!accountId) return null;
      return {
        dealer_id: input.dealerId,
        journal_entry_id: journalId,
        account_id: accountId,
        debit: d.debit,
        credit: d.credit,
        posting_line_id: d.postingLineId !== 'balance' ? d.postingLineId : null,
        metadata: JSON.stringify(d.metadata ?? {}),
      };
    })
    .filter(Boolean);

  if (lineRows.length) {
    await trx('gl_journal_lines').insert(lineRows);
  }

  return journalId;
}

/** Backfill GL journals for posting batches that have no journal entry yet. */
export async function backfillGlForDealer(
  dealerId: string,
  opts: { dryRun?: boolean; limit?: number } = {},
) {
  await db.transaction(async (trx) => {
    await ensureDealerGlChart(trx, dealerId);
  });

  const limit = opts.limit ?? 5000;
  const batches = await db('posting_batches as pb')
    .leftJoin('gl_journal_entries as je', 'je.posting_batch_id', 'pb.id')
    .where('pb.dealer_id', dealerId)
    .whereNull('je.id')
    .orderBy('pb.posted_at', 'asc')
    .limit(limit)
    .select('pb.id', 'pb.dealer_id', 'pb.document_type', 'pb.document_id', 'pb.notes', 'pb.event_type', 'pb.reverses_batch_id');

  let mirrored = 0;
  let skipped = 0;

  for (const batch of batches) {
    const lines = await db('posting_lines').where({ posting_batch_id: batch.id });
    if (!lines.length) {
      skipped++;
      continue;
    }
    if (opts.dryRun) {
      mirrored++;
      continue;
    }
    const entryDate =
      (lines[0]?.entry_date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    await db.transaction(async (trx) => {
      await mirrorPostingBatchToGl(trx, {
        dealerId: batch.dealer_id as string,
        postingBatchId: batch.id as string,
        entryDate,
        documentType: batch.document_type as string,
        documentId: batch.document_id as string,
        description: (batch.notes as string) ?? null,
        postingLineIds: lines.map((l) => l.id as string),
        eventType: batch.event_type as string,
        reversesBatchId: (batch.reverses_batch_id as string) ?? null,
        postingLines: lines.map((r) => ({
          id: r.id as string,
          line_domain: r.line_domain as string,
          line_type: r.line_type as string,
          amount: Number(r.amount),
          metadata:
            typeof r.metadata === 'string'
              ? (JSON.parse(r.metadata) as Record<string, unknown>)
              : ((r.metadata as Record<string, unknown>) ?? {}),
        })),
      });
    });
    mirrored++;
  }

  return { batches_found: batches.length, mirrored, skipped, dry_run: !!opts.dryRun };
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number;
}

export async function getTrialBalance(
  dealerId: string,
  asOf?: string,
): Promise<TrialBalanceRow[]> {
  let q = db('gl_journal_lines as jl')
    .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
    .join('gl_accounts as a', 'a.id', 'jl.account_id')
    .where('je.dealer_id', dealerId)
    .groupBy('a.id', 'a.code', 'a.name', 'a.account_type')
    .select(
      'a.code',
      'a.name',
      'a.account_type',
      db.raw('COALESCE(SUM(jl.debit), 0) as debit'),
      db.raw('COALESCE(SUM(jl.credit), 0) as credit'),
    );

  if (asOf) {
    q = q.where('je.entry_date', '<=', asOf);
  }

  const rows = await q;
  return rows.map((r) => {
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);
    const balance = Math.round((debit - credit) * 100) / 100;
    return {
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      debit,
      credit,
      balance,
    };
  });
}
