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

export type TransferLevel = 'warehouse' | 'godown' | 'rack';

const LOCATION_TABLE: Record<TransferLevel, string> = {
  warehouse: 'warehouse_stock',
  godown: 'godown_stock',
  rack: 'rack_stock',
};

const LOCATION_ID_COLUMN: Record<TransferLevel, string> = {
  warehouse: 'warehouse_id',
  godown: 'godown_id',
  rack: 'rack_id',
};

const LOCATION_LABEL: Record<TransferLevel, string> = {
  warehouse: 'warehouse',
  godown: 'godown',
  rack: 'rack',
};

/**
 * Move qty between location-scoped stock cache rows.
 *
 * V2 Sprint 3B — generic over `warehouse_stock` / `godown_stock` /
 * `rack_stock`, which all share the same shape (dealer_id, <location>_id,
 * product_id, box/piece/sft/total_pieces). This is the same mechanism
 * `applyWarehouseTransferStock` used pre-3B (P3-06), now parameterized by
 * tier so godown- and rack-level transfers reuse it unchanged rather than
 * duplicating the box/piece/sft delta math three times.
 *
 * Does not touch the aggregate `stock` table — each `<level>_stock` table is
 * a location cache, same as `warehouse_stock` always was.
 */
async function applyLocationTransferStock(
  trx: Knex.Transaction,
  level: TransferLevel,
  params: {
    dealerId: string;
    fromId: string;
    toId: string;
    productId: string;
    quantity: number;
    unit: string;
    transferId: string;
    transferNo: string | null;
    userId: string | null;
  },
): Promise<void> {
  const { dealerId, fromId, toId, productId, quantity, unit, transferId, transferNo } = params;
  const table = LOCATION_TABLE[level];
  const idCol = LOCATION_ID_COLUMN[level];
  const label = LOCATION_LABEL[level];

  if (fromId === toId) {
    throw new Error(`Source and destination ${label} must differ`);
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

  const fromRow = await trx(table)
    .where({ dealer_id: dealerId, [idCol]: fromId, product_id: productId })
    .forUpdate()
    .first();

  if (!fromRow || num(fromRow.total_pieces) < totalPieces - 0.0001) {
    throw new Error(`Insufficient stock at source ${label}`);
  }

  const upsertLocationStock = async (locationId: string, sign: 1 | -1) => {
    const existing = await trx(table)
      .where({ dealer_id: dealerId, [idCol]: locationId, product_id: productId })
      .forUpdate()
      .first();

    const b = sign * boxDelta;
    const p = sign * pieceDelta;
    const s = sign * sftDelta;
    const tp = sign * totalPieces;

    if (!existing) {
      if (sign < 0) throw new Error(`Insufficient stock at source ${label}`);
      await trx(table).insert({
        dealer_id: dealerId,
        [idCol]: locationId,
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
      throw new Error(`Insufficient stock at source ${label}`);
    }

    await trx(table)
      .where({ dealer_id: dealerId, [idCol]: locationId, product_id: productId })
      .update({
        box_qty: Math.max(0, newBox),
        piece_qty: Math.max(0, newPiece),
        sft_qty: Math.max(0, num(existing.sft_qty) + s),
        total_pieces: Math.max(0, num(existing.total_pieces) + tp),
        updated_at: trx.fn.now(),
      });
  };

  await upsertLocationStock(fromId, -1);
  await upsertLocationStock(toId, 1);

  const refNo = transferNo ?? transferId;

  await trx('stock_movements').insert([
    {
      dealer_id: dealerId,
      product_id: productId,
      [idCol]: fromId,
      movement_type: `${level}_transfer_out`,
      qty_delta: -totalPieces,
      qty_unit: 'pieces',
      reference_type: 'warehouse_transfers',
      reference_id: transferId,
      reference_no: refNo,
    },
    {
      dealer_id: dealerId,
      product_id: productId,
      [idCol]: toId,
      movement_type: `${level}_transfer_in`,
      qty_delta: totalPieces,
      qty_unit: 'pieces',
      reference_type: 'warehouse_transfers',
      reference_id: transferId,
      reference_no: refNo,
    },
  ]);
}

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
  return applyLocationTransferStock(trx, 'warehouse', {
    dealerId: params.dealerId,
    fromId: params.fromWarehouseId,
    toId: params.toWarehouseId,
    productId: params.productId,
    quantity: params.quantity,
    unit: params.unit,
    transferId: params.transferId,
    transferNo: params.transferNo,
    userId: params.userId,
  });
}

export async function applyGodownTransferStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    fromGodownId: string;
    toGodownId: string;
    productId: string;
    quantity: number;
    unit: string;
    transferId: string;
    transferNo: string | null;
    userId: string | null;
  },
): Promise<void> {
  return applyLocationTransferStock(trx, 'godown', {
    dealerId: params.dealerId,
    fromId: params.fromGodownId,
    toId: params.toGodownId,
    productId: params.productId,
    quantity: params.quantity,
    unit: params.unit,
    transferId: params.transferId,
    transferNo: params.transferNo,
    userId: params.userId,
  });
}

export async function applyRackTransferStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    fromRackId: string;
    toRackId: string;
    productId: string;
    quantity: number;
    unit: string;
    transferId: string;
    transferNo: string | null;
    userId: string | null;
  },
): Promise<void> {
  return applyLocationTransferStock(trx, 'rack', {
    dealerId: params.dealerId,
    fromId: params.fromRackId,
    toId: params.toRackId,
    productId: params.productId,
    quantity: params.quantity,
    unit: params.unit,
    transferId: params.transferId,
    transferNo: params.transferNo,
    userId: params.userId,
  });
}
