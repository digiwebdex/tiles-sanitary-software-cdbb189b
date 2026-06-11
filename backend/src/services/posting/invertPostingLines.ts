import type { PostingLineInput } from './types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Negate amounts/qty for reversal batches (POSTING_RULES_MATRIX §8). */
export function invertPostingLines(lines: PostingLineInput[]): PostingLineInput[] {
  return lines.map((line) => ({
    ...line,
    amount: round2(-line.amount),
    qtyDelta: line.qtyDelta != null ? round4(-line.qtyDelta) : null,
    metadata: { ...(line.metadata ?? {}), reversed: true },
  }));
}

/** Map posting_lines DB rows to PostingLineInput for inversion. */
export function postingLinesFromDbRows(
  rows: Array<{
    line_domain: string;
    line_type: string;
    party_id: string | null;
    product_id: string | null;
    product_batch_id: string | null;
    warehouse_id: string | null;
    purchase_id: string | null;
    sale_id: string | null;
    qty_delta: string | number | null;
    qty_unit: string | null;
    amount: string | number;
    currency: string;
    entry_date: string | Date;
    metadata: unknown;
  }>,
): PostingLineInput[] {
  return rows.map((row) => ({
    lineDomain: row.line_domain as PostingLineInput['lineDomain'],
    lineType: row.line_type,
    partyId: row.party_id ?? undefined,
    productId: row.product_id ?? undefined,
    productBatchId: row.product_batch_id ?? undefined,
    warehouseId: row.warehouse_id ?? undefined,
    purchaseId: row.purchase_id ?? undefined,
    saleId: row.sale_id ?? undefined,
    qtyDelta: row.qty_delta != null ? Number(row.qty_delta) : undefined,
    qtyUnit: row.qty_unit ?? undefined,
    amount: Number(row.amount),
    currency: row.currency,
    entryDate:
      typeof row.entry_date === 'string'
        ? row.entry_date.slice(0, 10)
        : row.entry_date.toISOString().slice(0, 10),
    metadata:
      typeof row.metadata === 'object' && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : {},
  }));
}
