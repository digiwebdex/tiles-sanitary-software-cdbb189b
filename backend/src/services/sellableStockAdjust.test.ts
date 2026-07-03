import { describe, expect, it } from 'vitest';
import { adjustSellableStock } from './sellableStockAdjust';
import { createMockTrx } from '../test/mockTrx';

describe('adjustSellableStock', () => {
  it('deducts piece stock and writes stock_ledger', async () => {
    const { trx, tables, ledger } = createMockTrx({
      products: [
        {
          id: 'p1',
          dealer_id: 'd1',
          unit_type: 'piece',
          pieces_per_box: 1,
          per_box_sft: 0,
        },
      ],
      stock: [
        {
          id: 's1',
          product_id: 'p1',
          dealer_id: 'd1',
          piece_qty: 10,
          total_pieces: 10,
        },
      ],
    });

    await adjustSellableStock(trx, {
      dealerId: 'd1',
      productId: 'p1',
      quantity: 3,
      type: 'deduct',
      txnType: 'display_move_out',
      userId: 'u1',
    });

    expect(tables.stock[0].piece_qty).toBe(7);
    expect(tables.stock[0].total_pieces).toBe(7);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].txn_type).toBe('display_move_out');
    expect(ledger[0].total_pieces).toBe(-3);
  });

  it('throws on insufficient stock', async () => {
    const { trx } = createMockTrx({
      products: [
        {
          id: 'p1',
          dealer_id: 'd1',
          unit_type: 'piece',
          pieces_per_box: 1,
          per_box_sft: 0,
        },
      ],
      stock: [
        {
          id: 's1',
          product_id: 'p1',
          dealer_id: 'd1',
          piece_qty: 2,
          total_pieces: 2,
        },
      ],
    });

    await expect(
      adjustSellableStock(trx, {
        dealerId: 'd1',
        productId: 'p1',
        quantity: 5,
        type: 'deduct',
        txnType: 'sample_issue',
      }),
    ).rejects.toThrow('Insufficient stock');
  });

  it('deducts box_sft stock in box units', async () => {
    const { trx, tables } = createMockTrx({
      products: [
        {
          id: 'p1',
          dealer_id: 'd1',
          unit_type: 'box_sft',
          pieces_per_box: 10,
          per_box_sft: 3.5,
        },
      ],
      stock: [
        {
          id: 's1',
          product_id: 'p1',
          dealer_id: 'd1',
          box_qty: 5,
          piece_qty: 0,
          sft_qty: 17.5,
          total_pieces: 50,
        },
      ],
    });

    await adjustSellableStock(trx, {
      dealerId: 'd1',
      productId: 'p1',
      quantity: 2,
      type: 'deduct',
      txnType: 'display_move_out',
    });

    expect(tables.stock[0].box_qty).toBe(3);
    expect(tables.stock[0].total_pieces).toBe(30);
    expect(tables.stock[0].sft_qty).toBe(10.5);
  });
});
