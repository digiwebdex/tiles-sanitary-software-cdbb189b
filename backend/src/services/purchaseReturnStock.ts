import type { Knex } from 'knex';
import { formatBoxPiece } from '../lib/units';

/**
 * Deduct returned qty from product_batches FIFO (oldest active first), then aggregate stock.
 * P3-04 purchase return batch deduct.
 */
export async function deductPurchaseReturnStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    productId: string;
    quantity: number;
    purchaseReturnId: string;
    returnNo: string;
    userId: string | null;
  },
): Promise<void> {
  const { dealerId, productId, quantity, purchaseReturnId, returnNo, userId } = params;

  const product = await trx('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) throw new Error(`Product not found: ${productId}`);

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = Number(product.per_box_sft ?? 0);
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box ?? 1)) || 1);
  const totalPieces = unitType === 'box_sft' ? quantity * ppb : quantity;

  const stockRow = await trx('stock')
    .where({ product_id: productId, dealer_id: dealerId })
    .forUpdate()
    .first('total_pieces', 'box_qty', 'piece_qty', 'sft_qty');
  if (!stockRow) throw new Error('Insufficient stock to deduct');

  const stockBeforePieces = Number(stockRow.total_pieces ?? 0);
  if (stockBeforePieces < totalPieces - 0.0001) {
    throw new Error('Insufficient stock to deduct');
  }

  let remaining = quantity;
  const batches = await trx('product_batches')
    .where({ dealer_id: dealerId, product_id: productId, status: 'active' })
    .orderBy('created_at', 'asc')
    .select('id', 'box_qty', 'piece_qty', 'total_pieces')
    .forUpdate();

  for (const batch of batches) {
    if (remaining <= 0) break;
    const available =
      unitType === 'box_sft' ? Number(batch.box_qty) : Number(batch.piece_qty);
    if (available <= 0) continue;

    const deductQty = Math.min(remaining, available);
    const deltaPieces = unitType === 'box_sft' ? deductQty * ppb : deductQty;

    if (unitType === 'box_sft') {
      const newBox = Number(batch.box_qty) - deductQty;
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          box_qty: Math.max(0, newBox),
          sft_qty: Math.max(0, newBox * perBoxSft),
          total_pieces: Math.max(0, Number(batch.total_pieces ?? 0) - deltaPieces),
          status: newBox <= 0 ? 'depleted' : 'active',
        });
    } else {
      const newPiece = Number(batch.piece_qty) - deductQty;
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          piece_qty: Math.max(0, newPiece),
          total_pieces: Math.max(0, Number(batch.total_pieces ?? 0) - deltaPieces),
          status: newPiece <= 0 ? 'depleted' : 'active',
        });
    }

    remaining -= deductQty;
  }

  if (remaining > 0.0001) {
    throw new Error('Insufficient batch stock to deduct');
  }

  const stockAfterPieces = stockBeforePieces - totalPieces;

  if (unitType === 'box_sft') {
    const newBox = Number(stockRow.box_qty) - quantity;
    if (newBox < -0.0001) throw new Error('Insufficient box stock');
    await trx('stock')
      .where({ product_id: productId, dealer_id: dealerId })
      .update({
        box_qty: Math.max(0, newBox),
        sft_qty: Math.max(0, newBox * perBoxSft),
        total_pieces: stockAfterPieces,
      });
  } else {
    const newPiece = Number(stockRow.piece_qty) - quantity;
    if (newPiece < -0.0001) throw new Error('Insufficient piece stock');
    await trx('stock')
      .where({ product_id: productId, dealer_id: dealerId })
      .update({
        piece_qty: Math.max(0, newPiece),
        total_pieces: stockAfterPieces,
      });
  }

  await trx('stock_ledger').insert({
    dealer_id: dealerId,
    product_id: productId,
    txn_type: 'purchase_return_out',
    reference_table: 'purchase_returns',
    reference_id: purchaseReturnId,
    reference_no: returnNo,
    box_qty: unitType === 'box_sft' ? quantity : 0,
    piece_qty: unitType === 'piece' ? quantity : 0,
    pieces_per_box: ppb,
    total_pieces: totalPieces,
    stock_before_pieces: stockBeforePieces,
    stock_after_pieces: stockAfterPieces,
    stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
    stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
    created_by: userId,
  });
}
