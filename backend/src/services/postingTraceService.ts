/**
 * P4-05 — Posting trace queries for drill-down from balance reports.
 * Prefers posting_batches/lines when present; falls back to legacy ledgers.
 */
import { db } from '../db/connection';

export type TraceLineDomain = 'customer' | 'supplier';

export interface PostingTraceLine {
  id: string;
  lineDomain: string;
  lineType: string;
  amount: number;
  entryDate: string;
  qtyDelta: number | null;
  qtyUnit: string | null;
  saleId: string | null;
  purchaseId: string | null;
  productId: string | null;
  metadata: Record<string, unknown>;
}

export interface PostingTraceBatch {
  batchId: string;
  documentType: string;
  documentId: string;
  eventType: string;
  postedAt: string;
  notes: string | null;
  reversesBatchId: string | null;
  invoiceRef: string | null;
  lines: PostingTraceLine[];
  lineTotal: number;
}

export interface PartyPostingTraceResult {
  source: 'posting_engine' | 'legacy_ledger';
  partyId: string;
  lineDomain: TraceLineDomain;
  partyName: string | null;
  batches: PostingTraceBatch[];
  runningBalance: number;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function resolveInvoiceRef(
  dealerId: string,
  documentType: string,
  documentId: string,
): Promise<string | null> {
  if (documentType === 'sale') {
    const row = await db('sales').where({ id: documentId, dealer_id: dealerId }).first('invoice_number');
    return row?.invoice_number ? String(row.invoice_number) : null;
  }
  if (documentType === 'purchase') {
    const row = await db('purchases').where({ id: documentId, dealer_id: dealerId }).first('invoice_number');
    return row?.invoice_number ? String(row.invoice_number) : null;
  }
  return null;
}

export async function tracePartyPostings(
  dealerId: string,
  lineDomain: TraceLineDomain,
  partyId: string,
  opts: { limit?: number; from?: string | null; to?: string | null } = {},
): Promise<PartyPostingTraceResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const partyNameRow =
    lineDomain === 'customer'
      ? await db('customers').where({ id: partyId, dealer_id: dealerId }).first('name')
      : await db('suppliers').where({ id: partyId, dealer_id: dealerId }).first('name');

  let batchQ = db('posting_batches as pb')
    .join('posting_lines as pl', 'pl.posting_batch_id', 'pb.id')
    .where('pb.dealer_id', dealerId)
    .where('pl.line_domain', lineDomain)
    .where('pl.party_id', partyId)
  if (opts.from) batchQ = batchQ.where('pl.entry_date', '>=', opts.from);
  if (opts.to) batchQ = batchQ.where('pl.entry_date', '<=', opts.to);

  const batchIds = await batchQ
    .clone()
    .distinct('pb.id')
    .orderBy('pb.posted_at', 'desc')
    .limit(limit)
    .pluck('pb.id');

  if (batchIds.length > 0) {
    const batches = await db('posting_batches')
      .where({ dealer_id: dealerId })
      .whereIn('id', batchIds)
      .orderBy('posted_at', 'desc');

    const lines = await db('posting_lines')
      .where({ dealer_id: dealerId })
      .whereIn('posting_batch_id', batchIds)
      .where({ line_domain: lineDomain, party_id: partyId })
      .orderBy('entry_date', 'desc');

    const linesByBatch = new Map<string, PostingTraceLine[]>();
    for (const row of lines as any[]) {
      const bid = row.posting_batch_id as string;
      const arr = linesByBatch.get(bid) ?? [];
      arr.push({
        id: row.id,
        lineDomain: row.line_domain,
        lineType: row.line_type,
        amount: round2(num(row.amount)),
        entryDate: String(row.entry_date).slice(0, 10),
        qtyDelta: row.qty_delta != null ? num(row.qty_delta) : null,
        qtyUnit: row.qty_unit ?? null,
        saleId: row.sale_id ?? null,
        purchaseId: row.purchase_id ?? null,
        productId: row.product_id ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      });
      linesByBatch.set(bid, arr);
    }

    const resultBatches: PostingTraceBatch[] = [];
    for (const b of batches as any[]) {
      const batchLines = linesByBatch.get(b.id) ?? [];
      const invoiceRef = await resolveInvoiceRef(dealerId, b.document_type, b.document_id);
      resultBatches.push({
        batchId: b.id,
        documentType: b.document_type,
        documentId: b.document_id,
        eventType: b.event_type,
        postedAt: String(b.posted_at),
        notes: b.notes ?? null,
        reversesBatchId: b.reverses_batch_id ?? null,
        invoiceRef,
        lines: batchLines,
        lineTotal: round2(batchLines.reduce((s, l) => s + l.amount, 0)),
      });
    }

    const runningBalance = round2(
      resultBatches.reduce((s, b) => s + b.lineTotal, 0),
    );

    return {
      source: 'posting_engine',
      partyId,
      lineDomain,
      partyName: partyNameRow?.name ?? null,
      batches: resultBatches,
      runningBalance,
    };
  }

  return tracePartyLedgerFallback(dealerId, lineDomain, partyId, partyNameRow?.name ?? null, opts);
}

async function tracePartyLedgerFallback(
  dealerId: string,
  lineDomain: TraceLineDomain,
  partyId: string,
  partyName: string | null,
  opts: { limit?: number; from?: string | null; to?: string | null },
): Promise<PartyPostingTraceResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const table = lineDomain === 'customer' ? 'customer_ledger' : 'supplier_ledger';
  const partyCol = lineDomain === 'customer' ? 'customer_id' : 'supplier_id';

  let q = db(table)
    .where({ dealer_id: dealerId, [partyCol]: partyId })
    .orderBy('entry_date', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit);

  if (opts.from) q = q.where('entry_date', '>=', opts.from);
  if (opts.to) q = q.where('entry_date', '<=', opts.to);

  const rows = await q.select(
    'id',
    'type',
    'amount',
    'entry_date',
    'description',
    'sale_id',
    'purchase_id',
    'sales_return_id',
  );

  const lines: PostingTraceLine[] = (rows as any[]).map((r) => ({
    id: r.id,
    lineDomain,
    lineType: r.type,
    amount: round2(num(r.amount)),
    entryDate: String(r.entry_date).slice(0, 10),
    qtyDelta: null,
    qtyUnit: null,
    saleId: r.sale_id ?? null,
    purchaseId: r.purchase_id ?? null,
    productId: null,
    metadata: { description: r.description, sales_return_id: r.sales_return_id, legacy: true },
  }));

  const batch: PostingTraceBatch = {
    batchId: 'legacy-ledger',
    documentType: 'ledger',
    documentId: partyId,
    eventType: 'posted',
    postedAt: lines[0]?.entryDate ?? new Date().toISOString(),
    notes: 'Legacy ledger entries (posting engine batches not recorded for these transactions)',
    reversesBatchId: null,
    invoiceRef: null,
    lines,
    lineTotal: round2(lines.reduce((s, l) => s + l.amount, 0)),
  };

  return {
    source: 'legacy_ledger',
    partyId,
    lineDomain,
    partyName,
    batches: lines.length ? [batch] : [],
    runningBalance: batch.lineTotal,
  };
}

export async function getPostingBatchDetail(
  dealerId: string,
  batchId: string,
): Promise<PostingTraceBatch | null> {
  const batch = await db('posting_batches').where({ id: batchId, dealer_id: dealerId }).first();
  if (!batch) return null;

  const lines = await db('posting_lines')
    .where({ posting_batch_id: batchId, dealer_id: dealerId })
    .orderBy('entry_date', 'asc');

  const mapped: PostingTraceLine[] = (lines as any[]).map((row) => ({
    id: row.id,
    lineDomain: row.line_domain,
    lineType: row.line_type,
    amount: round2(num(row.amount)),
    entryDate: String(row.entry_date).slice(0, 10),
    qtyDelta: row.qty_delta != null ? num(row.qty_delta) : null,
    qtyUnit: row.qty_unit ?? null,
    saleId: row.sale_id ?? null,
    purchaseId: row.purchase_id ?? null,
    productId: row.product_id ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));

  const invoiceRef = await resolveInvoiceRef(
    dealerId,
    (batch as any).document_type,
    (batch as any).document_id,
  );

  return {
    batchId: (batch as any).id,
    documentType: (batch as any).document_type,
    documentId: (batch as any).document_id,
    eventType: (batch as any).event_type,
    postedAt: String((batch as any).posted_at),
    notes: (batch as any).notes ?? null,
    reversesBatchId: (batch as any).reverses_batch_id ?? null,
    invoiceRef,
    lines: mapped,
    lineTotal: round2(mapped.reduce((s, l) => s + l.amount, 0)),
  };
}
