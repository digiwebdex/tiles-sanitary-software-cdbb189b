import type { PostingLineInput } from './types';

/** Canonical unit label stored on posting_lines.qty_unit. */
export function resolveQtyUnit(unitType: string): string {
  if (unitType === 'box_sft') return 'box';
  return 'piece';
}

/** One purchase line after legacy batch + stock top-up. */
export interface PurchaseStockPostedItem {
  purchaseItemId: string;
  productId: string;
  productBatchId: string;
  /** Boxes or pieces (matches legacy item.quantity). */
  quantity: number;
  unitType: string;
  totalPieces: number;
  totalSft?: number | null;
  /** Landed line total used for WAC / inventory value. */
  landedCost: number;
}

export interface PurchaseStockPostContext {
  purchaseId: string;
  entryDate: string;
  items: PurchaseStockPostedItem[];
}

/** FIFO batch slice consumed on a sale line. */
export interface SaleBatchAllocation {
  productBatchId: string;
  allocatedQty: number;
  /** COGS attributed to this batch slice (optional; prorated from line if omitted). */
  cogsAmount?: number;
}

/** One sale line after legacy FIFO / unbatched deduction. */
export interface SaleStockPostedItem {
  saleItemId: string;
  productId: string;
  /** Total qty deducted from stock (boxes or pieces). */
  quantity: number;
  unitType: string;
  /** Negative pieces delta (matches stock_ledger.total_pieces sign). */
  totalPieces: number;
  cogsAmount: number;
  /** Empty or omitted → single aggregate stock line (legacy unbatched). */
  batchAllocations?: SaleBatchAllocation[];
}

export interface SaleStockPostContext {
  saleId: string;
  entryDate: string;
  items: SaleStockPostedItem[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function prorateCogs(totalCogs: number, partQty: number, totalQty: number): number {
  if (totalQty <= 0) return 0;
  return round2((totalCogs * partQty) / totalQty);
}

/**
 * Build stock-domain posting lines for purchase.posted.
 * Mirrors stock_ledger txn_type=purchase_in (positive qty_delta).
 */
export function buildPurchaseStockLines(ctx: PurchaseStockPostContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];

  for (const item of ctx.items) {
    if (item.quantity <= 0) continue;

    const qtyUnit = resolveQtyUnit(item.unitType);
    lines.push({
      lineDomain: 'stock',
      lineType: 'purchase_in',
      amount: round2(item.landedCost),
      entryDate: ctx.entryDate,
      productId: item.productId,
      productBatchId: item.productBatchId,
      purchaseId: ctx.purchaseId,
      qtyDelta: round4(item.quantity),
      qtyUnit,
      metadata: {
        purchase_item_id: item.purchaseItemId,
        total_pieces: item.totalPieces,
        total_sft: item.totalSft ?? null,
        unit_type: item.unitType,
      },
    });
  }

  return lines;
}

/**
 * Build stock-domain posting lines for sale.posted.
 * Mirrors stock_ledger txn_type=sale_out (negative qty_delta).
 * Emits one line per FIFO batch slice when allocations are present.
 */
export function buildSaleStockLines(ctx: SaleStockPostContext): PostingLineInput[] {
  const lines: PostingLineInput[] = [];

  for (const item of ctx.items) {
    if (item.quantity <= 0) continue;

    const qtyUnit = resolveQtyUnit(item.unitType);
    const allocations = item.batchAllocations?.filter((a) => a.allocatedQty > 0) ?? [];

    if (allocations.length === 0) {
      lines.push({
        lineDomain: 'stock',
        lineType: 'sale_out',
        amount: round2(item.cogsAmount),
        entryDate: ctx.entryDate,
        productId: item.productId,
        saleId: ctx.saleId,
        qtyDelta: round4(-item.quantity),
        qtyUnit,
        metadata: {
          sale_item_id: item.saleItemId,
          total_pieces: item.totalPieces,
          unit_type: item.unitType,
          unbatched: true,
        },
      });
      continue;
    }

    const allocatedTotal = allocations.reduce((s, a) => s + a.allocatedQty, 0);
    for (const alloc of allocations) {
      const cogs =
        alloc.cogsAmount != null
          ? round2(alloc.cogsAmount)
          : prorateCogs(item.cogsAmount, alloc.allocatedQty, allocatedTotal);

      lines.push({
        lineDomain: 'stock',
        lineType: 'sale_out',
        amount: cogs,
        entryDate: ctx.entryDate,
        productId: item.productId,
        productBatchId: alloc.productBatchId,
        saleId: ctx.saleId,
        qtyDelta: round4(-alloc.allocatedQty),
        qtyUnit,
        metadata: {
          sale_item_id: item.saleItemId,
          total_pieces: item.totalPieces,
          unit_type: item.unitType,
          batch_allocation: true,
        },
      });
    }

    const unbatchedRemainder = round4(item.quantity - allocatedTotal);
    if (unbatchedRemainder > 0) {
      lines.push({
        lineDomain: 'stock',
        lineType: 'sale_out',
        amount: prorateCogs(item.cogsAmount, unbatchedRemainder, item.quantity),
        entryDate: ctx.entryDate,
        productId: item.productId,
        saleId: ctx.saleId,
        qtyDelta: round4(-unbatchedRemainder),
        qtyUnit,
        metadata: {
          sale_item_id: item.saleItemId,
          total_pieces: item.totalPieces,
          unit_type: item.unitType,
          unbatched: true,
        },
      });
    }
  }

  return lines;
}
