import type { Knex } from 'knex';
import type {
  CreatePostingBatchInput,
  PostingBatchResult,
  PostingLineInput,
} from './types';

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
  const batchId = await createPostingBatch(trx, batch);
  const lineIds = await insertPostingLines(trx, batch.dealerId, batchId, lines);
  return { batchId, lineIds };
}
