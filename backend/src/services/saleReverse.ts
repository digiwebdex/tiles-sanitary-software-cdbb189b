import type { Knex } from 'knex';
import { formatBoxPiece } from '../lib/units';

export type SaleItemStockRow = {
  id: string;
  product_id: string;
  quantity: number | string;
  available_qty_at_sale?: number | string | null;
  box_qty?: number | string | null;
  piece_qty?: number | string | null;
  total_pieces?: number | string | null;
};

/** Restore FIFO batches + unbatched stock for one sale line (mirrors DELETE path). */
export async function restoreSaleItemStock(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    saleId: string;
    invoiceNumber: string | null;
    userId: string | null;
    item: SaleItemStockRow;
  },
): Promise<void> {
  const { dealerId, saleId, invoiceNumber, userId, item } = params;

  const prod: any = await trx('products')
    .where({ id: item.product_id })
    .first('unit_type', 'per_box_sft', 'pieces_per_box');
  const unitType = (prod?.unit_type ?? 'piece') as 'box_sft' | 'piece';
  const perBoxSft = Number(prod?.per_box_sft ?? 0);
  const ppb = Math.max(1, Math.floor(Number(prod?.pieces_per_box ?? 1)) || 1);

  const stockBeforeRow = await trx('stock')
    .where({ dealer_id: dealerId, product_id: item.product_id })
    .forUpdate()
    .first('total_pieces');
  const stockBeforePieces = Number(stockBeforeRow?.total_pieces ?? 0);

  const batchAllocs = await trx('sale_item_batches')
    .where({ sale_item_id: item.id })
    .select('allocated_qty');
  const batchAllocated = batchAllocs.reduce(
    (s: number, a: any) => s + Number(a.allocated_qty),
    0,
  );

  await trx.raw('SELECT public.restore_sale_batches(?, ?, ?, ?, ?)', [
    item.id,
    item.product_id,
    dealerId,
    unitType,
    perBoxSft,
  ]);

  const deductedQty = Math.min(
    Number(item.quantity),
    Number(item.available_qty_at_sale ?? item.quantity),
  );
  const unbatchedQty = deductedQty - batchAllocated;
  if (unbatchedQty > 0) {
    const restorePieces = unitType === 'box_sft' ? unbatchedQty * ppb : unbatchedQty;
    if (unitType === 'box_sft') {
      const stockRow = await trx('stock')
        .where({ product_id: item.product_id, dealer_id: dealerId })
        .first();
      if (stockRow) {
        const newBox = Number(stockRow.box_qty) + unbatchedQty;
        await trx('stock')
          .where({ id: stockRow.id })
          .update({
            box_qty: newBox,
            sft_qty: newBox * perBoxSft,
            total_pieces: Number(stockRow.total_pieces ?? 0) + restorePieces,
          });
      }
    } else {
      await trx('stock')
        .where({ product_id: item.product_id, dealer_id: dealerId })
        .increment({ piece_qty: unbatchedQty, total_pieces: restorePieces });
    }
  }

  const stockAfterRow = await trx('stock')
    .where({ dealer_id: dealerId, product_id: item.product_id })
    .first('total_pieces');
  const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);

  await trx('stock_ledger').insert({
    dealer_id: dealerId,
    product_id: item.product_id,
    txn_type: 'sale_cancel_in',
    reference_table: 'sales',
    reference_id: saleId,
    reference_no: invoiceNumber,
    box_qty: Number(item.box_qty ?? 0),
    piece_qty: Number(item.piece_qty ?? 0),
    pieces_per_box: ppb,
    total_pieces: Number(item.total_pieces ?? Number(item.quantity) * ppb),
    stock_before_pieces: stockBeforePieces,
    stock_after_pieces: stockAfterPieces,
    stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
    stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
    created_by: userId,
  });
}

/** Append-only ledger reversal for a posted sale (does not DELETE rows). */
export async function insertSaleReverseLedgerEntries(
  trx: Knex.Transaction,
  params: {
    dealerId: string;
    saleId: string;
    customerId: string;
    invoiceNumber: string | null;
    totalAmount: number;
    paidAmount: number;
    entryDate: string;
  },
): Promise<void> {
  const { dealerId, saleId, customerId, invoiceNumber, totalAmount, paidAmount, entryDate } =
    params;
  const label = invoiceNumber ?? saleId;

  if (totalAmount > 0) {
    await trx('customer_ledger').insert({
      dealer_id: dealerId,
      customer_id: customerId,
      sale_id: saleId,
      type: 'refund',
      amount: totalAmount,
      description: `Reversal of sale ${label}`,
      entry_date: entryDate,
    });
  }

  if (paidAmount > 0) {
    await trx('customer_ledger').insert({
      dealer_id: dealerId,
      customer_id: customerId,
      sale_id: saleId,
      type: 'adjustment',
      amount: paidAmount,
      description: `Reverse payment on reversed sale ${label}`,
      entry_date: entryDate,
    });

    await trx('cash_ledger').insert({
      dealer_id: dealerId,
      type: 'payment',
      amount: -paidAmount,
      description: `Reverse receipt: ${label}`,
      reference_type: 'sales',
      reference_id: saleId,
      entry_date: entryDate,
    });
  }
}
