import type { Knex } from 'knex';

/** Business documents supported by the posting engine (MVP: purchase + sale). */
export type PostingDocumentType = 'purchase' | 'sale';

export type PostingEventType = 'posted' | 'reversed';

export type PostingLineDomain =
  | 'stock'
  | 'customer'
  | 'supplier'
  | 'cash'
  | 'bank'
  | 'expense'
  | 'tax';

export interface CreatePostingBatchInput {
  dealerId: string;
  documentType: PostingDocumentType;
  documentId: string;
  eventType: PostingEventType;
  postedBy?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
  reversesBatchId?: string | null;
  postedAt?: Date | string;
}

export interface PostingLineInput {
  lineDomain: PostingLineDomain;
  lineType: string;
  amount: number;
  entryDate: string;
  partyId?: string | null;
  productId?: string | null;
  productBatchId?: string | null;
  warehouseId?: string | null;
  purchaseId?: string | null;
  saleId?: string | null;
  qtyDelta?: number | null;
  qtyUnit?: string | null;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface PostingBatchResult {
  batchId: string;
  lineIds: string[];
}

/** Context for dual-write: legacy mutation + optional posting_lines mirror. */
export interface PostDocumentContext {
  trx: Knex.Transaction;
  dealerId: string;
  documentType: PostingDocumentType;
  documentId: string;
  eventType: PostingEventType;
  entryDate: string;
  postedBy?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
  reversesBatchId?: string | null;
}

export interface DualWritePostResult<TLegacy> {
  legacy: TLegacy;
  posting: PostingBatchResult | null;
}
