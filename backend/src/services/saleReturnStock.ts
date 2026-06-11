import type { Knex } from 'knex';
import { computeLineCogs } from '../lib/cogsLine';
import { formatBoxPiece } from '../lib/units';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type RestoreSaleReturnStockResult = {
  cogsReversal: number;
  batchRestoredQty: number;
  unbatchedRestoredQty: number;
};

/**
 * Restore stock for a partial sales return — LIFO batch restore then unbatched remainder.
 * P3-01 batch-aware return path.
 */
export async function restoreSaleReturnStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    saleItemId: string;
    productId: string;
    returnQty: number;
    saleReturnId: string;
    invoiceNumber: string | null;
    userId: string | null;
  },
): Promise<RestoreSaleReturnStockResult> {
  const { dealerId, saleItemId, productId, returnQty, saleReturnId, invoiceNumber, userId } =
    params;

  const product = await trx('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) throw new Error(`Product not found: ${productId}`);

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = Number(product.per_box_sft ?? 0);
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box ?? 1)) || 1);

  const stockRow = await trx('stock')
    .where({ product_id: productId, dealer_id: dealerId })
    .forUpdate()
    .first('average_cost_per_unit', 'total_pieces');
  const avgCost = Number(stockRow?.average_cost_per_unit ?? 0);
  const stockBeforePieces = Number(stockRow?.total_pieces ?? 0);

  const cogsReversal = round2(
    computeLineCogs({
      unitType,
      effectiveQty: returnQty,
      perBoxSft,
      avgCost,
    }),
  );

  let remaining = returnQty;
  let batchRestoredQty = 0;

  const allocs = await trx('sale_item_batches')
    .where({ sale_item_id: saleItemId, dealer_id: dealerId })
    .orderBy('created_at', 'desc')
    .select('id', 'batch_id', 'allocated_qty')
    .forUpdate();

  for (const alloc of allocs) {
    if (remaining <= 0) break;
    const allocQty = Number(alloc.allocated_qty);
    if (allocQty <= 0) continue;

    const restoreQty = Math.min(remaining, allocQty);
    const batch = await trx('product_batches')
      .where({ id: alloc.batch_id, dealer_id: dealerId })
      .forUpdate()
      .first('id', 'box_qty', 'piece_qty', 'sft_qty', 'total_pieces');

    if (!batch) continue;

    const deltaPieces = unitType === 'box_sft' ? restoreQty * ppb : restoreQty;

    if (unitType === 'box_sft') {
      const newBox = Number(batch.box_qty) + restoreQty;
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          box_qty: newBox,
          sft_qty: newBox * perBoxSft,
          total_pieces: Number(batch.total_pieces ?? 0) + deltaPieces,
          status: 'active',
        });
    } else {
      const newPiece = Number(batch.piece_qty) + restoreQty;
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          piece_qty: newPiece,
          total_pieces: Number(batch.total_pieces ?? 0) + deltaPieces,
          status: 'active',
        });
    }

    const newAllocQty = allocQty - restoreQty;
    if (newAllocQty <= 0.0001) {
      await trx('sale_item_batches').where({ id: alloc.id }).delete();
    } else {
      await trx('sale_item_batches')
        .where({ id: alloc.id })
        .update({ allocated_qty: newAllocQty });
    }

    batchRestoredQty += restoreQty;
    remaining -= restoreQty;
  }

  const unbatchedRestoredQty = remaining;
  const totalRestorePieces = unitType === 'box_sft' ? returnQty * ppb : returnQty;

  if (returnQty > 0) {
    if (unitType === 'box_sft') {
      const row = await trx('stock')
        .where({ product_id: productId, dealer_id: dealerId })
        .forUpdate()
        .first('id', 'box_qty', 'sft_qty', 'total_pieces');
      if (row) {
        const newBox = Number(row.box_qty) + returnQty;
        await trx('stock')
          .where({ id: row.id })
          .update({
            box_qty: newBox,
            sft_qty: newBox * perBoxSft,
            total_pieces: Number(row.total_pieces ?? 0) + totalRestorePieces,
          });
      }
    } else {
      await trx('stock')
        .where({ product_id: productId, dealer_id: dealerId })
        .increment({
          piece_qty: returnQty,
          total_pieces: returnQty,
        });
    }
  }

  const saleItem = await trx('sale_items')
    .where({ id: saleItemId })
    .first('allocated_qty', 'box_qty', 'piece_qty');
  if (saleItem) {
    const newAllocated = Math.max(0, Number(saleItem.allocated_qty) - returnQty);
    await trx('sale_items').where({ id: saleItemId }).update({ allocated_qty: newAllocated });
  }

  const stockAfterRow = await trx('stock')
    .where({ dealer_id: dealerId, product_id: productId })
    .first('total_pieces');
  const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);

  const boxQty = unitType === 'box_sft' ? returnQty : 0;
  const pieceQty = unitType === 'piece' ? returnQty : 0;

  await trx('stock_ledger').insert({
    dealer_id: dealerId,
    product_id: productId,
    txn_type: 'sale_return_in',
    reference_table: 'sales_returns',
    reference_id: saleReturnId,
    reference_no: invoiceNumber,
    box_qty: boxQty,
    piece_qty: pieceQty,
    pieces_per_box: ppb,
    total_pieces: totalRestorePieces,
    stock_before_pieces: stockBeforePieces,
    stock_after_pieces: stockAfterPieces,
    stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
    stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
    created_by: userId,
  });

  return { cogsReversal, batchRestoredQty, unbatchedRestoredQty };
}
