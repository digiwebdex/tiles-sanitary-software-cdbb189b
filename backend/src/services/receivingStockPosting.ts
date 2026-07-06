/**
 * receivingStockPosting — V2 Sprint 5C (Goods Receipt).
 *
 * The batch find-or-create, weighted-average-cost recompute, and
 * stock_ledger insert this module implements are BEHAVIORALLY IDENTICAL to
 * the equivalent inline logic in `backend/src/routes/purchases.ts` (lines
 * ~764-928) — same null-safe batch matching, same weighted-average
 * formula, same stock_ledger shape. That logic could not be imported
 * directly: it is inline in `purchases.ts`'s POST handler body, not a
 * standalone exported function, and `purchases.ts` is a frozen file
 * (Sprint 4C/earlier). This module exists so Goods Receipt's OWN multiple
 * call sites (create-and-complete, future partial completions) share ONE
 * implementation rather than duplicating it across themselves — see
 * docs/PURCHASE_INVENTORY_INTEGRATION.md for the full reuse/duplication
 * rationale.
 *
 * Deliberately NOT included (out of Sprint 5C's stated scope):
 *   - Backorder allocation (sale_items/backorder_allocations) — the sprint's
 *     own "Stock Posting" list does not mention it, and Sales is frozen;
 *     documented as a future-sprint candidate, not built here.
 *   - Any supplier_ledger/cash_ledger/bank_ledger/tax posting write —
 *     Purchase Invoice, Supplier Payment, and Accounting Posting are all
 *     explicitly out of scope. GRN only ever moves quantity.
 *   - Landed cost (transport/labor/other cost fields) — GRN uses the
 *     Purchase Order line's own rate as the sole cost basis for the
 *     weighted-average recompute; no landed-cost UI/fields are introduced.
 */
import type { Knex } from 'knex';
import { formatBoxPiece } from '../lib/units';

export interface ReceiveLineInput {
  goodsReceiptItemId: string;
  productId: string;
  quantity: number;
  rate: number;
  batchNo: string | null;
  lotNo: string | null;
  shadeCode: string | null;
  caliber: string | null;
  warehouseId: string | null;
  godownId: string | null;
  rackId: string | null;
}

export interface ReceiveLineResult {
  productBatchId: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Find-or-create a `product_batches` row using the exact same null-safe
 * identity match as `purchases.ts` (dealer_id + product_id + batch_no +
 * shade_code + caliber + lot_no, each nullable column matched with
 * whereNull when absent), then top up its quantity.
 */
async function upsertProductBatch(
  trx: Knex.Transaction,
  dealerId: string,
  productId: string,
  unitType: string,
  perBoxSft: number | null,
  totalPieces: number,
  batchNo: string,
  shadeCode: string | null,
  caliber: string | null,
  lotNo: string | null,
  quantity: number,
): Promise<string> {
  const batchQ = trx('product_batches')
    .where({ dealer_id: dealerId, product_id: productId, batch_no: batchNo })
    .forUpdate();
  if (shadeCode === null) batchQ.whereNull('shade_code');
  else batchQ.andWhere('shade_code', shadeCode);
  if (caliber === null) batchQ.whereNull('caliber');
  else batchQ.andWhere('caliber', caliber);
  if (lotNo === null) batchQ.whereNull('lot_no');
  else batchQ.andWhere('lot_no', lotNo);

  const existing = await batchQ.first();

  if (existing) {
    if (unitType === 'box_sft') {
      const newBox = Number(existing.box_qty) + quantity;
      await trx('product_batches')
        .where({ id: existing.id })
        .update({
          box_qty: newBox,
          sft_qty: newBox * (perBoxSft ?? 0),
          total_pieces: Number(existing.total_pieces) + totalPieces,
          status: 'active',
        });
    } else {
      await trx('product_batches')
        .where({ id: existing.id })
        .update({
          piece_qty: Number(existing.piece_qty) + quantity,
          total_pieces: Number(existing.total_pieces) + totalPieces,
          status: 'active',
        });
    }
    return existing.id;
  }

  const newRow: Record<string, unknown> = {
    dealer_id: dealerId,
    product_id: productId,
    batch_no: batchNo,
    lot_no: lotNo,
    shade_code: shadeCode,
    caliber,
    box_qty: 0,
    piece_qty: 0,
    sft_qty: 0,
    total_pieces: totalPieces,
    status: 'active',
  };
  if (unitType === 'box_sft') {
    newRow.box_qty = quantity;
    newRow.sft_qty = quantity * (perBoxSft ?? 0);
  } else {
    newRow.piece_qty = quantity;
  }
  const [created] = await trx('product_batches').insert(newRow).returning('id');
  return created.id;
}

/** Insert-if-absent-else-increment on a location stock table (warehouse_stock/godown_stock/rack_stock). */
async function upsertLocationStock(
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

  if (!row) {
    const insertRow: Record<string, unknown> = {
      dealer_id: dealerId,
      [locationCol]: locationId,
      product_id: productId,
      box_qty: 0,
      piece_qty: 0,
      sft_qty: 0,
      total_pieces: totalPieces,
    };
    if (unitType === 'box_sft') {
      insertRow.box_qty = quantity;
      insertRow.sft_qty = quantity * (perBoxSft ?? 0);
    } else {
      insertRow.piece_qty = quantity;
    }
    await trx(table).insert(insertRow);
    return;
  }

  if (unitType === 'box_sft') {
    const newBox = Number(row.box_qty) + quantity;
    await trx(table)
      .where({ dealer_id: dealerId, [locationCol]: locationId, product_id: productId })
      .update({
        box_qty: newBox,
        sft_qty: newBox * (perBoxSft ?? 0),
        total_pieces: Number(row.total_pieces) + totalPieces,
        updated_at: new Date(),
      });
  } else {
    await trx(table)
      .where({ dealer_id: dealerId, [locationCol]: locationId, product_id: productId })
      .update({
        piece_qty: Number(row.piece_qty) + quantity,
        total_pieces: Number(row.total_pieces) + totalPieces,
        updated_at: new Date(),
      });
  }
}

/**
 * Post one received GRN line: batch top-up, dealer-wide `stock` aggregate
 * (with weighted-average-cost recompute), location stock (warehouse/godown/
 * rack — bins are not stock-tracked, see migration 086), and a stock_ledger
 * audit row (which auto-creates a stock_movements row via the existing
 * `trg_stock_ledger_to_movements` trigger — this function then backfills
 * that row's warehouse_id/batch_id, which the trigger itself leaves null).
 */
export async function postGoodsReceiptLine(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    goodsReceiptId: string;
    grnNumber: string | null;
    entryDate: string;
    userId: string | null;
    line: ReceiveLineInput;
  },
): Promise<ReceiveLineResult> {
  const { dealerId, goodsReceiptId, grnNumber, entryDate, userId, line } = params;

  const product = await trx('products')
    .where({ id: line.productId, dealer_id: dealerId })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  if (!product) throw new Error('Product not found for this dealer');

  const unitType = product.unit_type ?? 'piece';
  const perBoxSft = product.per_box_sft ?? null;
  const piecesPerBox = Math.max(1, Math.floor(Number(product.pieces_per_box) || 1));
  const boxQty = unitType === 'box_sft' ? line.quantity : 0;
  const pieceQty = unitType === 'box_sft' ? 0 : line.quantity;
  const totalPieces = boxQty * piecesPerBox + pieceQty;
  const totalSft = unitType === 'box_sft' && perBoxSft ? line.quantity * perBoxSft : null;
  const lineCost = line.quantity * line.rate;

  const batchNo = (line.batchNo || '').trim() || `AUTO-${entryDate.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const shadeCode = (line.shadeCode || '').trim() || null;
  const caliber = (line.caliber || '').trim() || null;
  const lotNo = (line.lotNo || '').trim() || null;

  const productBatchId = await upsertProductBatch(
    trx, dealerId, line.productId, unitType, perBoxSft, totalPieces,
    batchNo, shadeCode, caliber, lotNo, line.quantity,
  );

  // ── Dealer-wide `stock` aggregate + weighted-average-cost recompute ──
  // Identical formula to purchases.ts: cost basis = incoming line total
  // (quantity * rate — no landed-cost components, see file header).
  const stockRow = await trx('stock')
    .where({ product_id: line.productId, dealer_id: dealerId })
    .forUpdate()
    .first();

  const stockBeforePieces = stockRow ? Number(stockRow.total_pieces) || 0 : 0;
  const stockAfterPieces = stockBeforePieces + totalPieces;

  if (!stockRow) {
    const newStock: Record<string, unknown> = {
      dealer_id: dealerId,
      product_id: line.productId,
      box_qty: 0,
      piece_qty: 0,
      sft_qty: 0,
      total_pieces: totalPieces,
      average_cost_per_unit: 0,
    };
    if (unitType === 'box_sft') {
      newStock.box_qty = line.quantity;
      newStock.sft_qty = line.quantity * (perBoxSft ?? 0);
    } else {
      newStock.piece_qty = line.quantity;
    }
    if (unitType === 'box_sft' && totalSft && totalSft > 0) {
      newStock.average_cost_per_unit = round2(lineCost / totalSft);
    } else if (line.quantity > 0) {
      newStock.average_cost_per_unit = round2(lineCost / line.quantity);
    }
    await trx('stock').insert(newStock);
  } else {
    const currentQtyBase = unitType === 'box_sft' ? Number(stockRow.sft_qty) : Number(stockRow.piece_qty);
    const currentTotal = currentQtyBase * Number(stockRow.average_cost_per_unit);
    const incomingQtyBase = unitType === 'box_sft' && totalSft ? totalSft : line.quantity;
    const newQtyBase = currentQtyBase + incomingQtyBase;
    const newAvg = newQtyBase > 0 ? (currentTotal + lineCost) / newQtyBase : 0;

    if (unitType === 'box_sft') {
      const newBox = Number(stockRow.box_qty) + line.quantity;
      await trx('stock')
        .where({ id: stockRow.id })
        .update({
          box_qty: newBox,
          sft_qty: newBox * (perBoxSft ?? 0),
          total_pieces: stockAfterPieces,
          average_cost_per_unit: round2(newAvg),
        });
    } else {
      await trx('stock')
        .where({ id: stockRow.id })
        .update({
          piece_qty: Number(stockRow.piece_qty) + line.quantity,
          total_pieces: stockAfterPieces,
          average_cost_per_unit: round2(newAvg),
        });
    }
  }

  // ── Warehouse Receiving — location-tier stock (Sprint 3B hierarchy) ──
  if (line.warehouseId) {
    await upsertLocationStock(trx, 'warehouse_stock', 'warehouse_id', line.warehouseId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }
  if (line.godownId) {
    await upsertLocationStock(trx, 'godown_stock', 'godown_id', line.godownId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }
  if (line.rackId) {
    await upsertLocationStock(trx, 'rack_stock', 'rack_id', line.rackId, dealerId, line.productId, unitType, perBoxSft, line.quantity, totalPieces);
  }

  // ── stock_ledger audit row (auto-creates a stock_movements row via the
  //    existing trg_stock_ledger_to_movements trigger) ──
  const [ledgerRow] = await trx('stock_ledger')
    .insert({
      dealer_id: dealerId,
      product_id: line.productId,
      txn_type: 'grn_receipt',
      reference_table: 'goods_receipts',
      reference_id: goodsReceiptId,
      reference_no: grnNumber,
      box_qty: boxQty,
      piece_qty: pieceQty,
      pieces_per_box: piecesPerBox,
      total_pieces: totalPieces,
      stock_before_pieces: stockBeforePieces,
      stock_after_pieces: stockAfterPieces,
      stock_before_display: formatBoxPiece(stockBeforePieces, piecesPerBox),
      stock_after_display: formatBoxPiece(stockAfterPieces, piecesPerBox),
      created_by: userId,
    })
    .returning('id');

  // Backfill the location/batch columns the trigger itself leaves null.
  await trx('stock_movements')
    .where({ stock_ledger_id: ledgerRow.id })
    .update({
      warehouse_id: line.warehouseId,
      godown_id: line.godownId,
      rack_id: line.rackId,
      batch_id: productBatchId,
    });

  return { productBatchId };
}
