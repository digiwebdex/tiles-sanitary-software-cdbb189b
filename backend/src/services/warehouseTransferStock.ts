import type { Knex } from 'knex';

function num(v: unknown): number {
  return Number(v) || 0;
}

/** Resolve default warehouse for a dealer (Main Godown). */
export async function getDefaultWarehouseId(
  trx: Knex.Transaction,
  dealerId: string,
): Promise<string | null> {
  const row = await trx('warehouses')
    .where({ dealer_id: dealerId, is_active: true })
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'asc')
    .first('id');
  return row?.id ?? null;
}

/**
 * Move qty between warehouse_stock rows (P3-06).
 * Does not touch aggregate `stock` — warehouse_stock is location cache.
 */
export async function applyWarehouseTransferStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    productId: string;
    quantity: number;
    unit: string;
    transferId: string;
    transferNo: string | null;
    userId: string | null;
  },
): Promise<void> {
  const {
    dealerId,
    fromWarehouseId,
    toWarehouseId,
    productId,
    quantity,
    unit,
    transferId,
    transferNo,
  } = params;

  if (fromWarehouseId === toWarehouseId) {
    throw new Error('Source and destination warehouse must differ');
  }

  const product = await trx('products')
    .where({ id: productId, dealer_id: dealerId })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) throw new Error('Product not found');

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = Number(product.per_box_sft ?? 0);
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box ?? 1)) || 1);

  let boxDelta = 0;
  let pieceDelta = 0;
  if (unitType === 'box_sft' || unit === 'box') {
    boxDelta = quantity;
  } else {
    pieceDelta = quantity;
  }
  const totalPieces = boxDelta * ppb + pieceDelta;
  const sftDelta = boxDelta * perBoxSft;

  const fromRow = await trx('warehouse_stock')
    .where({ dealer_id: dealerId, warehouse_id: fromWarehouseId, product_id: productId })
    .forUpdate()
    .first();

  if (!fromRow || num(fromRow.total_pieces) < totalPieces - 0.0001) {
    throw new Error('Insufficient stock at source warehouse');
  }

  const upsertWhStock = async (warehouseId: string, sign: 1 | -1) => {
    const existing = await trx('warehouse_stock')
      .where({ dealer_id: dealerId, warehouse_id: warehouseId, product_id: productId })
      .forUpdate()
      .first();

    const b = sign * boxDelta;
    const p = sign * pieceDelta;
    const s = sign * sftDelta;
    const tp = sign * totalPieces;

    if (!existing) {
      if (sign < 0) throw new Error('Insufficient stock at source warehouse');
      await trx('warehouse_stock').insert({
        dealer_id: dealerId,
        warehouse_id: warehouseId,
        product_id: productId,
        box_qty: Math.max(0, b),
        piece_qty: Math.max(0, p),
        sft_qty: Math.max(0, s),
        total_pieces: Math.max(0, tp),
      });
      return;
    }

    const newBox = num(existing.box_qty) + b;
    const newPiece = num(existing.piece_qty) + p;
    if (newBox < -0.0001 || newPiece < -0.0001 || num(existing.total_pieces) + tp < -0.0001) {
      throw new Error('Insufficient stock at source warehouse');
    }

    await trx('warehouse_stock')
      .where({ dealer_id: dealerId, warehouse_id: warehouseId, product_id: productId })
      .update({
        box_qty: Math.max(0, newBox),
        piece_qty: Math.max(0, newPiece),
        sft_qty: Math.max(0, num(existing.sft_qty) + s),
        total_pieces: Math.max(0, num(existing.total_pieces) + tp),
        updated_at: trx.fn.now(),
      });
  };

  await upsertWhStock(fromWarehouseId, -1);
  await upsertWhStock(toWarehouseId, 1);

  const refNo = transferNo ?? transferId;

  await trx('stock_movements').insert([
    {
      dealer_id: dealerId,
      product_id: productId,
      warehouse_id: fromWarehouseId,
      movement_type: 'warehouse_transfer_out',
      qty_delta: -totalPieces,
      qty_unit: 'pieces',
      reference_type: 'warehouse_transfers',
      reference_id: transferId,
      reference_no: refNo,
    },
    {
      dealer_id: dealerId,
      product_id: productId,
      warehouse_id: toWarehouseId,
      movement_type: 'warehouse_transfer_in',
      qty_delta: totalPieces,
      qty_unit: 'pieces',
      reference_type: 'warehouse_transfers',
      reference_id: transferId,
      reference_no: refNo,
    },
  ]);
}
