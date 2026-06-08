import { env } from '../../config/env';
import { persistPostingBatch } from './postingLineWriter';
import type {
  DualWritePostResult,
  PostDocumentContext,
  PostingBatchResult,
  PostingLineInput,
} from './types';

/** True when USE_POSTING_ENGINE=true|1 in environment (default: off). */
export function isPostingEngineEnabled(): boolean {
  const v = (env.USE_POSTING_ENGINE ?? '').toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * Dual-write coordinator (Phase 2 MVP):
 *   1. Runs the existing legacy post (stock + ledger tables) unchanged.
 *   2. When USE_POSTING_ENGINE is on, mirrors effects into posting_batches/lines.
 *
 * Purchase/sale routes will call this from P2-05/P2-06 after engines build lines.
 */
export async function executeDualWritePost<TLegacy>(
  ctx: PostDocumentContext,
  legacyPost: () => Promise<TLegacy>,
  buildPostingLines: (legacyResult: TLegacy) => PostingLineInput[],
): Promise<DualWritePostResult<TLegacy>> {
  const legacy = await legacyPost();

  if (!isPostingEngineEnabled()) {
    return { legacy, posting: null };
  }

  const lines = buildPostingLines(legacy);
  const posting = await mirrorToPostingTables(ctx, lines);
  return { legacy, posting };
}

/** Write posting_batches + posting_lines inside an open transaction. */
export async function mirrorToPostingTables(
  ctx: PostDocumentContext,
  lines: PostingLineInput[],
): Promise<PostingBatchResult> {
  return persistPostingBatch(
    ctx.trx,
    {
      dealerId: ctx.dealerId,
      documentType: ctx.documentType,
      documentId: ctx.documentId,
      eventType: ctx.eventType,
      postedBy: ctx.postedBy ?? null,
      idempotencyKey: ctx.idempotencyKey ?? null,
      notes: ctx.notes ?? null,
      reversesBatchId: ctx.reversesBatchId ?? null,
    },
    lines,
  );
}
