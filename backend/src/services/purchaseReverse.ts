import type { Knex } from 'knex';
import { formatBoxPiece } from '../lib/units';

export type PurchaseItemStockRow = {
  id: string;
  product_id: string;
  batch_id: string | null;
  quantity: number | string;
  box_qty?: number | string | null;
  piece_qty?: number | string | null;
  total_pieces?: number | string | null;
  landed_cost: number | string;
  total_sft?: number | string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Undo WAC after removing an incoming purchase line (mirror of purchases POST). */
export function reverseWeightedAverageCost(params: {
  currentQtyBase: number;
  currentAvg: number;
  incomingQtyBase: number;
  incomingTotal: number;
}): number {
  const { currentQtyBase, currentAvg, incomingQtyBase, incomingTotal } = params;
  const newQtyBase = currentQtyBase - incomingQtyBase;
  if (newQtyBase <= 0) return 0;
  return round2((currentQtyBase * currentAvg - incomingTotal) / newQtyBase);
}

/** Release backorder allocations created when this purchase was posted. */
export async function releaseBackorderAllocationsForPurchaseItems(
  trx: Knex.Transaction,
  dealerId: string,
  purchaseItemIds: string[],
): Promise<void> {
  if (!purchaseItemIds.length) return;

  const allocations = await trx('backorder_allocations')
    .whereIn('purchase_item_id', purchaseItemIds)
    .select('id', 'sale_item_id', 'allocated_qty')
    .forUpdate();

  const touchedSaleIds = new Set<string>();

  for (const alloc of allocations) {
    const qty = Number(alloc.allocated_qty);
    if (qty <= 0) continue;

    const si = await trx('sale_items')
      .where({ id: alloc.sale_item_id, dealer_id: dealerId })
      .forUpdate()
      .first('id', 'sale_id', 'allocated_qty', 'backorder_qty');

    if (!si) continue;

    const newAllocated = Math.max(0, Number(si.allocated_qty) - qty);
    const newBackorder = Number(si.backorder_qty) + qty;

    let newStatus: string;
    if (newBackorder <= 0) newStatus = 'in_stock';
    else if (newAllocated <= 0) newStatus = 'pending';
    else if (newAllocated >= newBackorder) newStatus = 'ready_for_delivery';
    else newStatus = 'partially_allocated';

    await trx('sale_items').where({ id: si.id }).update({
      allocated_qty: newAllocated,
      backorder_qty: newBackorder,
      fulfillment_status: newStatus,
    });

    touchedSaleIds.add(si.sale_id);
  }

  await trx('backorder_allocations').whereIn('purchase_item_id', purchaseItemIds).delete();

  for (const saleId of touchedSaleIds) {
    const items = await trx('sale_items')
      .where({ sale_id: saleId })
      .select('backorder_qty', 'fulfillment_status');
    const hasBackorder = items.some(
      (i: { backorder_qty: number | string; fulfillment_status: string }) =>
        Number(i.backorder_qty) > 0 ||
        !['in_stock', 'fulfilled', 'ready_for_delivery'].includes(i.fulfillment_status),
    );
    await trx('sales').where({ id: saleId }).update({ has_backorder: hasBackorder });
  }
}

/** Deduct batch + aggregate stock for one purchase line (inverse of purchase POST). */
export async function reversePurchaseItemStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    purchaseId: string;
    invoiceNumber: string | null;
    userId: string | null;
    item: PurchaseItemStockRow;
    product: { unit_type: string; per_box_sft: number | null; pieces_per_box: number | null };
  },
): Promise<void> {
  const { dealerId, purchaseId, invoiceNumber, userId, item, product } = params;

  const unitType = (product.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = Number(product.per_box_sft ?? 0);
  const ppb = Math.max(1, Math.floor(Number(product.pieces_per_box ?? 1)) || 1);
  const qty = Number(item.quantity);
  const totalPieces = Number(item.total_pieces ?? qty * ppb);
  const landed = Number(item.landed_cost);
  const totalSft =
    item.total_sft != null ? Number(item.total_sft) : unitType === 'box_sft' ? qty * perBoxSft : null;

  if (item.batch_id) {
    const batch = await trx('product_batches')
      .where({ id: item.batch_id, dealer_id: dealerId })
      .forUpdate()
      .first('id', 'box_qty', 'piece_qty', 'sft_qty', 'total_pieces');

    if (!batch) {
      throw new Error('BATCH_NOT_FOUND');
    }

    const batchPieces = Number(batch.total_pieces ?? 0);
    if (batchPieces < totalPieces - 0.0001) {
      throw new Error('INSUFFICIENT_BATCH_STOCK');
    }

    if (unitType === 'box_sft') {
      const newBox = Number(batch.box_qty) - qty;
      if (newBox < -0.0001) throw new Error('INSUFFICIENT_BATCH_STOCK');
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          box_qty: Math.max(0, newBox),
          sft_qty: Math.max(0, newBox * perBoxSft),
          total_pieces: Math.max(0, batchPieces - totalPieces),
          status: newBox <= 0 ? 'depleted' : 'active',
        });
    } else {
      const newPiece = Number(batch.piece_qty) - qty;
      if (newPiece < -0.0001) throw new Error('INSUFFICIENT_BATCH_STOCK');
      await trx('product_batches')
        .where({ id: batch.id })
        .update({
          piece_qty: Math.max(0, newPiece),
          total_pieces: Math.max(0, batchPieces - totalPieces),
          status: newPiece <= 0 ? 'depleted' : 'active',
        });
    }
  }

  const stockRow = await trx('stock')
    .where({ product_id: item.product_id, dealer_id: dealerId })
    .forUpdate()
    .first();

  if (!stockRow) {
    throw new Error('INSUFFICIENT_STOCK');
  }

  const stockBeforePieces = Number(stockRow.total_pieces ?? 0);
  if (stockBeforePieces < totalPieces - 0.0001) {
    throw new Error('INSUFFICIENT_STOCK');
  }

  const stockAfterPieces = stockBeforePieces - totalPieces;
  const currentQtyBase =
    unitType === 'box_sft' ? Number(stockRow.sft_qty) : Number(stockRow.piece_qty);
  const incomingQtyBase = unitType === 'box_sft' && totalSft ? totalSft : qty;

  if (currentQtyBase < incomingQtyBase - 0.0001) {
    throw new Error('INSUFFICIENT_STOCK');
  }

  const newQtyBase = currentQtyBase - incomingQtyBase;
  const newAvg = reverseWeightedAverageCost({
    currentQtyBase,
    currentAvg: Number(stockRow.average_cost_per_unit ?? 0),
    incomingQtyBase,
    incomingTotal: landed,
  });

  if (unitType === 'box_sft') {
    const newBox = Number(stockRow.box_qty) - qty;
    if (newBox < -0.0001) throw new Error('INSUFFICIENT_STOCK');
    await trx('stock')
      .where({ id: stockRow.id })
      .update({
        box_qty: Math.max(0, newBox),
        sft_qty: Math.max(0, newBox * perBoxSft),
        total_pieces: stockAfterPieces,
        average_cost_per_unit: newAvg,
      });
  } else {
    const newPiece = Number(stockRow.piece_qty) - qty;
    if (newPiece < -0.0001) throw new Error('INSUFFICIENT_STOCK');
    await trx('stock')
      .where({ id: stockRow.id })
      .update({
        piece_qty: Math.max(0, newPiece),
        total_pieces: stockAfterPieces,
        average_cost_per_unit: newAvg,
      });
  }

  await trx('stock_ledger').insert({
    dealer_id: dealerId,
    product_id: item.product_id,
    txn_type: 'purchase_cancel_out',
    reference_table: 'purchases',
    reference_id: purchaseId,
    reference_no: invoiceNumber,
    box_qty: Number(item.box_qty ?? (unitType === 'box_sft' ? qty : 0)),
    piece_qty: Number(item.piece_qty ?? (unitType === 'piece' ? qty : 0)),
    pieces_per_box: ppb,
    total_pieces: totalPieces,
    stock_before_pieces: stockBeforePieces,
    stock_after_pieces: stockAfterPieces,
    stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
    stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
    created_by: userId,
  });
}

/** Append-only ledger reversal for a posted purchase. */
export async function insertPurchaseReverseLedgerEntries(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    purchaseId: string;
    supplierId: string;
    invoiceNumber: string | null;
    netPayable: number;
    paidOnCreate: number;
    paidAccountId: string | null;
    entryDate: string;
  },
): Promise<void> {
  const {
    dealerId,
    purchaseId,
    supplierId,
    invoiceNumber,
    netPayable,
    paidOnCreate,
    paidAccountId,
    entryDate,
  } = params;
  const label = invoiceNumber ?? purchaseId;

  if (netPayable > 0) {
    await trx('supplier_ledger').insert({
      dealer_id: dealerId,
      supplier_id: supplierId,
      purchase_id: purchaseId,
      type: 'adjustment',
      amount: netPayable,
      description: `Reversal of purchase ${label}`,
      entry_date: entryDate,
    });
  }

  if (paidOnCreate > 0) {
    await trx('supplier_ledger').insert({
      dealer_id: dealerId,
      supplier_id: supplierId,
      purchase_id: purchaseId,
      type: 'adjustment',
      amount: -paidOnCreate,
      description: `Reverse payment on reversed purchase ${label}`,
      entry_date: entryDate,
    });

    if (paidAccountId) {
      await trx('bank_ledger').insert({
        dealer_id: dealerId,
        bank_account_id: paidAccountId,
        type: 'payment',
        amount: paidOnCreate,
        description: `Reverse purchase payment: ${label}`,
        reference_type: 'purchases',
        reference_id: purchaseId,
        entry_date: entryDate,
      });
    } else {
      await trx('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'payment',
        amount: paidOnCreate,
        description: `Reverse purchase payment: ${label}`,
        reference_type: 'purchases',
        reference_id: purchaseId,
        entry_date: entryDate,
      });
    }
  }
}
