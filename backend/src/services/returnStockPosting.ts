/**
 * returnStockPosting — V2 Sprint 5E (Purchase Return).
 *
 * Reuses `deductPurchaseReturnStock` (backend/src/services/purchaseReturnStock.ts,
 * pre-V2 "P3-04") UNMODIFIED for the dealer-wide `stock`/`product_batches`/
 * `stock_ledger` deduction — that function is already correct and standalone.
 *
 * What it does NOT do (confirmed by inspection): decrement location-tier
 * stock (`warehouse_stock`/`godown_stock`/`rack_stock`, introduced by Sprint
 * 3B and populated by Goods Receipt since Sprint 5C) — it predates that
 * hierarchy. Left as-is, a Purchase Return against GRN-received, location-
 * tracked stock would silently leave those tables overstated. This module
 * adds the missing location-tier deduction on top, reusing the exact same
 * box_sft/piece conversion the ADD side uses in `receivingStockPosting.ts`.
 */
import type { Knex } from 'knex';
import { deductPurchaseReturnStock } from './purchaseReturnStock';

export interface ReturnLineInput {
  productId: string;
  quantity: number;
  warehouseId: string | null;
  godownId: string | null;
  rackId: string | null;
}

async function deductLocationStock(
  trx: Knex.Transaction,
  table: 'warehouse_stock' | 'godown_stock' | 'rack_stock',
  locationCol: 'warehouse_id' | 'godown_id' | 'rack_id',
  locationId: string,
  dealerId: string,
  productId: string,
  unitType: string,
  perBoxSft: number | null,
  quantity: number,
  totalPieces: number,
): Promise<void> {
  const row = await trx(table)
    .where({ dealer_id: dealerId, [locationCol]: locationId, product_id: productId })
    .forUpdate()
    .first();
  if (!row) return; // Nothing recorded at this location — nothing to deduct.

  if (unitType === 'box_sft') {
    const newBox = Math.max(0, Number(row.box_qty) - quantity);
    await trx(table)
      .where({ dealer_id: dealerId, [locationCol]: locationId, product_id: productId })
      .update({
        box_qty: newBox,
        sft_qty: newBox * (perBoxSft ?? 0),
        total_pieces: Math.max(0, Number(row.total_pieces) - totalPieces),
        updated_at: new Date(),
      });
  } else {
    await trx(table)
      .where({ dealer_id: dealerId, [locationCol]: locationId, product_id: productId })
      .update({
        piece_qty: Math.max(0, Number(row.piece_qty) - quantity),
        total_pieces: Math.max(0, Number(row.total_pieces) - totalPieces),
        updated_at: new Date(),
      });
  }
}

/**
 * Posts one Purchase Return line: dealer-wide stock/batch/stock_ledger
 * deduction (via the reused, unmodified `deductPurchaseReturnStock`), plus
 * location-tier deduction if a warehouse/godown/rack was recorded for this
 * line (typically inherited from the goods-receipt line it originated from).
 */
export async function postPurchaseReturnLine(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    purchaseReturnId: string;
    returnNo: string;
    userId: string | null;
    line: ReturnLineInput;
  },
): Promise<void> {
  const { dealerId, purchaseReturnId, returnNo, userId, line } = params;

  await deductPurchaseReturnStock(trx, {
    dealerId,
    productId: line.productId,
    quantity: line.quantity,
    purchaseReturnId,
    returnNo,
    userId,
  });

  if (!line.warehouseId && !line.godownId && !line.rackId) return;

  const product = await trx('products')
    .where({ id: line.productId, dealer_id: dealerId })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) return;

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = product.per_box_sft ?? null;
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box) || 1));
  const totalPieces = unitType === 'box_sft' ? line.quantity * ppb : line.quantity;

  if (line.warehouseId) {
    await deductLocationStock(trx, 'warehouse_stock', 'warehouse_id', line.warehouseId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }
  if (line.godownId) {
    await deductLocationStock(trx, 'godown_stock', 'godown_id', line.godownId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }
  if (line.rackId) {
    await deductLocationStock(trx, 'rack_stock', 'rack_id', line.rackId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }
}
