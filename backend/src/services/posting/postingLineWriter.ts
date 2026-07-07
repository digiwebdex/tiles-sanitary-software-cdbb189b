import type { Knex } from 'knex';
import type {
  CreatePostingBatchInput,
  PostingBatchResult,
  PostingLineInput,
} from './types';
import { isGlSpineEnabled } from '../gl/glConfig';
import { mirrorPostingBatchToGl } from '../gl/glJournalWriter';
import { assertPeriodOpen } from '../accounting/periodLock';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function findPostingBatchByIdempotencyKey(
  trx: Knex.Transaction,
  dealerId: string,
  idempotencyKey: string,
): Promise<{ id: string } | undefined> {
  return trx('posting_batches')
    .where({ dealer_id: dealerId, idempotency_key: idempotencyKey })
    .first('id');
}

export async function createPostingBatch(
  trx: Knex.Transaction,
  input: CreatePostingBatchInput,
): Promise<string> {
  if (input.idempotencyKey) {
    const existing = await findPostingBatchByIdempotencyKey(
      trx,
      input.dealerId,
      input.idempotencyKey,
    );
    if (existing) {
      throw new Error(`Duplicate post: idempotency key already used (batch ${existing.id})`);
    }
  }

  const [row] = await trx('posting_batches')
    .insert({
      dealer_id: input.dealerId,
      document_type: input.documentType,
      document_id: input.documentId,
      event_type: input.eventType,
      reverses_batch_id: input.reversesBatchId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      posted_by: input.postedBy ?? null,
      posted_at: input.postedAt ?? trx.fn.now(),
      notes: input.notes ?? null,
    })
    .returning('id');

  return row.id as string;
}

export async function insertPostingLines(
  trx: Knex.Transaction,
  dealerId: string,
  postingBatchId: string,
  lines: PostingLineInput[],
): Promise<string[]> {
  if (!lines.length) return [];

  const rows = lines.map((line) => ({
    posting_batch_id: postingBatchId,
    dealer_id: dealerId,
    line_domain: line.lineDomain,
    line_type: line.lineType,
    party_id: line.partyId ?? null,
    product_id: line.productId ?? null,
    product_batch_id: line.productBatchId ?? null,
    warehouse_id: line.warehouseId ?? null,
    purchase_id: line.purchaseId ?? null,
    sale_id: line.saleId ?? null,
    qty_delta: line.qtyDelta != null ? round4(line.qtyDelta) : null,
    qty_unit: line.qtyUnit ?? null,
    amount: round2(line.amount),
    currency: line.currency ?? 'BDT',
    entry_date: line.entryDate,
    metadata: JSON.stringify(line.metadata ?? {}),
  }));

  const inserted = await trx('posting_lines').insert(rows).returning('id');
  return inserted.map((r: { id: string }) => r.id);
}

export async function persistPostingBatch(
  trx: Knex.Transaction,
  batch: CreatePostingBatchInput,
  lines: PostingLineInput[],
): Promise<PostingBatchResult> {
  if (lines[0]?.entryDate) {
    await assertPeriodOpen(trx, batch.dealerId, lines[0].entryDate);
  }

  const batchId = await createPostingBatch(trx, batch);
  const lineIds = await insertPostingLines(trx, batch.dealerId, batchId, lines);

  if (isGlSpineEnabled() && lineIds.length) {
    const postingRows = await trx('posting_lines').whereIn('id', lineIds);
    const entryDate = lines[0]?.entryDate ?? new Date().toISOString().slice(0, 10);
    await mirrorPostingBatchToGl(trx, {
      dealerId: batch.dealerId,
      postingBatchId: batchId,
      entryDate,
      documentType: batch.documentType,
      documentId: batch.documentId,
      description: batch.notes ?? null,
      postingLineIds: lineIds,
      eventType: batch.eventType,
      reversesBatchId: batch.reversesBatchId ?? null,
      postingLines: postingRows.map((r) => ({
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
  }

  return { batchId, lineIds };
}
