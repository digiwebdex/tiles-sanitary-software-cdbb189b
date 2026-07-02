import type { Knex } from 'knex';
import { formatBoxPiece } from '../lib/units';

async function getOrCreateStockTrx(
  trx: Knex.Transaction,
  productId: string,
  dealerId: string,
) {
  let stock = await trx('stock')
    .where({ product_id: productId, dealer_id: dealerId })
    .forUpdate()
    .first();
  if (!stock) {
    const [row] = await trx('stock')
      .insert({ product_id: productId, dealer_id: dealerId })
      .returning('*');
    stock = row;
  }
  return stock;
}

/**
 * Adjust sellable stock on the canonical `stock` table (P3-08).
 * Replaces legacy `products.current_stock` mutations for display/sample flows.
 */
export async function adjustSellableStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    productId: string;
    quantity: number;
    type: 'add' | 'deduct';
    userId?: string | null;
    txnType: string;
    referenceTable?: string;
    referenceId?: string | null;
    referenceNo?: string | null;
  },
): Promise<void> {
  const {
    dealerId,
    productId,
    quantity,
    type,
    userId,
    txnType,
    referenceTable,
    referenceId,
    referenceNo,
  } = params;

  if (quantity <= 0) throw new Error('Quantity must be > 0');

  const product = await trx('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('id', 'unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) throw new Error('Product not found');

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box ?? 1)) || 1);
  const perBoxSft = Number(product.per_box_sft ?? 0);
  const totalPiecesDelta = unitType === 'box_sft' ? quantity * ppb : quantity;
  const sign = type === 'deduct' ? -1 : 1;

  const stock = await getOrCreateStockTrx(trx, productId, dealerId);
  const beforePieces = Number(stock.total_pieces ?? 0);
  const afterPieces = beforePieces + sign * totalPiecesDelta;
  if (afterPieces < -0.0001) {
    throw new Error(
      `Insufficient stock (have ${formatBoxPiece(beforePieces, ppb)}, need ${quantity})`,
    );
  }

  const updates: Record<string, number> = { total_pieces: Math.max(0, afterPieces) };

  if (unitType === 'box_sft') {
    const newBox = Number(stock.box_qty ?? 0) + sign * quantity;
    if (newBox < -0.0001) {
      throw new Error(`Insufficient stock (have ${stock.box_qty}, need ${quantity})`);
    }
    updates.box_qty = Math.max(0, newBox);
    updates.sft_qty = Math.max(0, newBox * perBoxSft);
    updates.piece_qty = Math.max(0, afterPieces - updates.box_qty * ppb);
  } else {
    const newPiece = Number(stock.piece_qty ?? 0) + sign * quantity;
    if (newPiece < -0.0001) {
      throw new Error(`Insufficient stock (have ${stock.piece_qty}, need ${quantity})`);
    }
    updates.piece_qty = Math.max(0, newPiece);
  }

  await trx('stock')
    .where({ id: stock.id })
    .update({ ...updates, updated_at: trx.fn.now() });

  await trx('stock_ledger').insert({
    dealer_id: dealerId,
    product_id: productId,
    txn_type: txnType,
    reference_table: referenceTable ?? null,
    reference_id: referenceId ?? null,
    reference_no: referenceNo ?? null,
    box_qty: unitType === 'box_sft' ? sign * quantity : 0,
    piece_qty: unitType === 'piece' ? sign * quantity : 0,
    pieces_per_box: ppb,
    total_pieces: sign * totalPiecesDelta,
    stock_before_pieces: beforePieces,
    stock_after_pieces: Math.max(0, afterPieces),
    stock_before_display: formatBoxPiece(beforePieces, ppb),
    stock_after_display: formatBoxPiece(Math.max(0, afterPieces), ppb),
    created_by: userId ?? null,
  });
}
