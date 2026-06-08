import { describe, expect, it } from 'vitest';
import {
  buildPurchaseStockLines,
  buildSaleStockLines,
  resolveQtyUnit,
} from '../../backend/src/services/posting/StockPostingEngine';

describe('StockPostingEngine', () => {
  describe('resolveQtyUnit', () => {
    it('maps box_sft to box', () => {
      expect(resolveQtyUnit('box_sft')).toBe('box');
    });

    it('maps piece types to piece', () => {
      expect(resolveQtyUnit('piece')).toBe('piece');
    });
  });

  describe('buildPurchaseStockLines', () => {
    it('emits positive purchase_in lines per item', () => {
      const lines = buildPurchaseStockLines({
        purchaseId: 'pur-1',
        entryDate: '2026-06-01',
        items: [
          {
            purchaseItemId: 'pi-1',
            productId: 'prod-1',
            productBatchId: 'batch-1',
            quantity: 10,
            unitType: 'box_sft',
            totalPieces: 100,
            totalSft: 250,
            landedCost: 50000,
          },
        ],
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        lineDomain: 'stock',
        lineType: 'purchase_in',
        qtyDelta: 10,
        qtyUnit: 'box',
        amount: 50000,
        productId: 'prod-1',
        productBatchId: 'batch-1',
        purchaseId: 'pur-1',
        entryDate: '2026-06-01',
      });
    });

    it('skips zero-qty items', () => {
      const lines = buildPurchaseStockLines({
        purchaseId: 'pur-1',
        entryDate: '2026-06-01',
        items: [
          {
            purchaseItemId: 'pi-1',
            productId: 'prod-1',
            productBatchId: 'batch-1',
            quantity: 0,
            unitType: 'piece',
            totalPieces: 0,
            landedCost: 0,
          },
        ],
      });
      expect(lines).toHaveLength(0);
    });
  });

  describe('buildSaleStockLines', () => {
    it('emits negative sale_out line for unbatched deduction', () => {
      const lines = buildSaleStockLines({
        saleId: 'sale-1',
        entryDate: '2026-06-02',
        items: [
          {
            saleItemId: 'si-1',
            productId: 'prod-1',
            quantity: 5,
            unitType: 'box_sft',
            totalPieces: -50,
            cogsAmount: 12000,
          },
        ],
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        lineDomain: 'stock',
        lineType: 'sale_out',
        qtyDelta: -5,
        amount: 12000,
        saleId: 'sale-1',
      });
      expect(lines[0].metadata?.unbatched).toBe(true);
    });

    it('emits one line per FIFO batch allocation', () => {
      const lines = buildSaleStockLines({
        saleId: 'sale-2',
        entryDate: '2026-06-02',
        items: [
          {
            saleItemId: 'si-2',
            productId: 'prod-2',
            quantity: 6,
            unitType: 'piece',
            totalPieces: -6,
            cogsAmount: 900,
            batchAllocations: [
              { productBatchId: 'b-a', allocatedQty: 4, cogsAmount: 600 },
              { productBatchId: 'b-b', allocatedQty: 2, cogsAmount: 300 },
            ],
          },
        ],
      });

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        productBatchId: 'b-a',
        qtyDelta: -4,
        amount: 600,
      });
      expect(lines[1]).toMatchObject({
        productBatchId: 'b-b',
        qtyDelta: -2,
        amount: 300,
      });
    });

    it('prorates COGS when batch slice amounts omitted', () => {
      const lines = buildSaleStockLines({
        saleId: 'sale-3',
        entryDate: '2026-06-02',
        items: [
          {
            saleItemId: 'si-3',
            productId: 'prod-3',
            quantity: 4,
            unitType: 'piece',
            totalPieces: -4,
            cogsAmount: 1000,
            batchAllocations: [
              { productBatchId: 'b-x', allocatedQty: 1 },
              { productBatchId: 'b-y', allocatedQty: 3 },
            ],
          },
        ],
      });

      expect(lines[0].amount).toBe(250);
      expect(lines[1].amount).toBe(750);
    });

    it('adds unbatched remainder line when allocations do not cover full qty', () => {
      const lines = buildSaleStockLines({
        saleId: 'sale-4',
        entryDate: '2026-06-02',
        items: [
          {
            saleItemId: 'si-4',
            productId: 'prod-4',
            quantity: 5,
            unitType: 'piece',
            totalPieces: -5,
            cogsAmount: 500,
            batchAllocations: [{ productBatchId: 'b-z', allocatedQty: 3, cogsAmount: 300 }],
          },
        ],
      });

      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({
        qtyDelta: -2,
        amount: 200,
      });
      expect(lines[1].metadata?.unbatched).toBe(true);
    });
  });
});
