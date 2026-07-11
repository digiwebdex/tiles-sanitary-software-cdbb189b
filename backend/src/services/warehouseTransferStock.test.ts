import { describe, expect, it } from 'vitest';
import {
  applyWarehouseTransferStock,
  applyGodownTransferStock,
  applyRackTransferStock,
} from './warehouseTransferStock';
import { createMockTrx } from '../test/mockTrx';

/**
 * V2 Sprint 3B — generic location-transfer stock mechanism. Warehouse-level
 * behaviour is unchanged (P3-06); godown/rack are new tiers reusing the same
 * box/piece/sft delta math via applyLocationTransferStock.
 */
describe('warehouseTransferStock (V2 Sprint 3B)', () => {
  it('applyWarehouseTransferStock moves box_sft qty between two existing warehouse_stock rows', async () => {
    const { trx, tables } = createMockTrx({
      products: [{ id: 'p1', dealer_id: 'd1', unit_type: 'box_sft', pieces_per_box: 10, per_box_sft: 3.5 }],
      warehouse_stock: [
        { id: 'ws1', dealer_id: 'd1', warehouse_id: 'w1', product_id: 'p1', box_qty: 5, piece_qty: 0, sft_qty: 17.5, total_pieces: 50 },
        { id: 'ws2', dealer_id: 'd1', warehouse_id: 'w2', product_id: 'p1', box_qty: 1, piece_qty: 0, sft_qty: 3.5, total_pieces: 10 },
      ],
    });

    await applyWarehouseTransferStock(trx, {
      dealerId: 'd1', fromWarehouseId: 'w1', toWarehouseId: 'w2',
      productId: 'p1', quantity: 2, unit: 'box',
      transferId: 't1', transferNo: 'TRF-1', userId: 'u1',
    });

    const from = tables.warehouse_stock.find((r: any) => r.warehouse_id === 'w1');
    const to = tables.warehouse_stock.find((r: any) => r.warehouse_id === 'w2');
    expect(from.box_qty).toBe(3);
    expect(from.total_pieces).toBe(30);
    expect(to.box_qty).toBe(3);
    expect(to.total_pieces).toBe(30);
    expect(tables.stock_movements).toHaveLength(2);
    expect(tables.stock_movements[0].movement_type).toBe('warehouse_transfer_out');
    expect(tables.stock_movements[1].movement_type).toBe('warehouse_transfer_in');
  });

  it('applyGodownTransferStock creates the destination godown_stock row when it does not exist yet', async () => {
    const { trx, tables } = createMockTrx({
      products: [{ id: 'p1', dealer_id: 'd1', unit_type: 'piece', pieces_per_box: 1, per_box_sft: 0 }],
      godown_stock: [
        { id: 'gs1', dealer_id: 'd1', godown_id: 'g1', product_id: 'p1', box_qty: 0, piece_qty: 20, sft_qty: 0, total_pieces: 20 },
      ],
    });

    await applyGodownTransferStock(trx, {
      dealerId: 'd1', fromGodownId: 'g1', toGodownId: 'g2',
      productId: 'p1', quantity: 5, unit: 'pc',
      transferId: 't2', transferNo: null, userId: 'u1',
    });

    const from = tables.godown_stock.find((r: any) => r.godown_id === 'g1');
    const to = tables.godown_stock.find((r: any) => r.godown_id === 'g2');
    expect(from.piece_qty).toBe(15);
    expect(to).toBeTruthy();
    expect(to.piece_qty).toBe(5);
    expect(to.total_pieces).toBe(5);
  });

  it('applyRackTransferStock rejects when source rack has insufficient stock', async () => {
    const { trx } = createMockTrx({
      products: [{ id: 'p1', dealer_id: 'd1', unit_type: 'piece', pieces_per_box: 1, per_box_sft: 0 }],
      rack_stock: [
        { id: 'rs1', dealer_id: 'd1', rack_id: 'r1', product_id: 'p1', box_qty: 0, piece_qty: 2, sft_qty: 0, total_pieces: 2 },
      ],
    });

    await expect(
      applyRackTransferStock(trx, {
        dealerId: 'd1', fromRackId: 'r1', toRackId: 'r2',
        productId: 'p1', quantity: 5, unit: 'pc',
        transferId: 't3', transferNo: null, userId: 'u1',
      }),
    ).rejects.toThrow('Insufficient stock at source rack');
  });

  it('rejects a transfer where source and destination are the same location', async () => {
    const { trx } = createMockTrx({
      products: [{ id: 'p1', dealer_id: 'd1', unit_type: 'piece', pieces_per_box: 1, per_box_sft: 0 }],
      rack_stock: [{ id: 'rs1', dealer_id: 'd1', rack_id: 'r1', product_id: 'p1', piece_qty: 10, total_pieces: 10 }],
    });

    await expect(
      applyRackTransferStock(trx, {
        dealerId: 'd1', fromRackId: 'r1', toRackId: 'r1',
        productId: 'p1', quantity: 1, unit: 'pc',
        transferId: 't4', transferNo: null, userId: 'u1',
      }),
    ).rejects.toThrow('Source and destination rack must differ');
  });
});
