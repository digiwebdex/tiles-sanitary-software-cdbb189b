import { describe, expect, it } from 'vitest';
import { deductPurchaseReturnStock } from './purchaseReturnStock';
import { createMockTrx } from '../test/mockTrx';

describe('deductPurchaseReturnStock', () => {
  it('deducts FIFO from oldest batch and updates aggregate stock', async () => {
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
          piece_qty: 20,
          total_pieces: 20,
        },
      ],
      product_batches: [
        {
          id: 'b1',
          dealer_id: 'd1',
          product_id: 'p1',
          status: 'active',
          piece_qty: 8,
          total_pieces: 8,
          created_at: '2026-01-01',
        },
        {
          id: 'b2',
          dealer_id: 'd1',
          product_id: 'p1',
          status: 'active',
          piece_qty: 12,
          total_pieces: 12,
          created_at: '2026-01-02',
        },
      ],
    });

    await deductPurchaseReturnStock(trx, {
      dealerId: 'd1',
      productId: 'p1',
      quantity: 10,
      purchaseReturnId: 'pr1',
      returnNo: 'PR-001',
      userId: 'u1',
    });

    const b1 = tables.product_batches.find((b) => b.id === 'b1')!;
    const b2 = tables.product_batches.find((b) => b.id === 'b2')!;
    expect(b1.piece_qty).toBe(0);
    expect(b1.status).toBe('depleted');
    expect(b2.piece_qty).toBe(10);
    expect(tables.stock[0].piece_qty).toBe(10);
    expect(tables.stock[0].total_pieces).toBe(10);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].txn_type).toBe('purchase_return_out');
  });

  it('throws when batch stock is insufficient', async () => {
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
          piece_qty: 20,
          total_pieces: 20,
        },
      ],
      product_batches: [
        {
          id: 'b1',
          dealer_id: 'd1',
          product_id: 'p1',
          status: 'active',
          piece_qty: 5,
          total_pieces: 5,
          created_at: '2026-01-01',
        },
      ],
    });

    await expect(
      deductPurchaseReturnStock(trx, {
        dealerId: 'd1',
        productId: 'p1',
        quantity: 10,
        purchaseReturnId: 'pr1',
        returnNo: 'PR-001',
        userId: null,
      }),
    ).rejects.toThrow('Insufficient batch stock');
  });
});
