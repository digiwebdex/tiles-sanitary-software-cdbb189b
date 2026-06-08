import { describe, expect, it } from 'vitest';
import { buildSaleLedgerLines } from '../../backend/src/services/posting/LedgerPostingEngine';
import { buildSaleStockLines } from '../../backend/src/services/posting/StockPostingEngine';

/** Mirrors sales.ts POST dual-write line assembly (P2-06). */
function buildSalePostLines(input: {
  saleId: string;
  customerId: string;
  entryDate: string;
  totalAmount: number;
  paidAmount: number;
  stockItems: Parameters<typeof buildSaleStockLines>[0]['items'];
}) {
  return [
    ...buildSaleStockLines({
      saleId: input.saleId,
      entryDate: input.entryDate,
      items: input.stockItems,
    }),
    ...buildSaleLedgerLines({
      saleId: input.saleId,
      customerId: input.customerId,
      entryDate: input.entryDate,
      totalAmount: input.totalAmount,
      paidAmount: input.paidAmount,
    }),
  ];
}

describe('sale POST dual-write line assembly', () => {
  it('combines FIFO stock and ledger lines for a paid sale', () => {
    const lines = buildSalePostLines({
      saleId: 'sale-1',
      customerId: 'cust-1',
      entryDate: '2026-06-02',
      totalAmount: 20000,
      paidAmount: 5000,
      stockItems: [
        {
          saleItemId: 'si-1',
          productId: 'prod-1',
          quantity: 4,
          unitType: 'box_sft',
          totalPieces: -40,
          cogsAmount: 8000,
          batchAllocations: [
            { productBatchId: 'batch-a', allocatedQty: 2, cogsAmount: 4000 },
            { productBatchId: 'batch-b', allocatedQty: 2, cogsAmount: 4000 },
          ],
        },
      ],
    });

    expect(lines.filter((l) => l.lineDomain === 'stock')).toHaveLength(2);
    expect(lines.filter((l) => l.lineDomain === 'customer')).toHaveLength(2);
    expect(lines.filter((l) => l.lineDomain === 'cash')).toHaveLength(1);

    const saleLine = lines.find((l) => l.lineType === 'sale');
    expect(saleLine?.amount).toBe(20000);

    const stockLines = lines.filter((l) => l.lineType === 'sale_out');
    expect(stockLines.every((l) => (l.qtyDelta ?? 0) < 0)).toBe(true);
  });

  it('skips stock lines when nothing deducted (challan-style empty stock)', () => {
    const lines = buildSalePostLines({
      saleId: 'sale-2',
      customerId: 'cust-2',
      entryDate: '2026-06-02',
      totalAmount: 1000,
      paidAmount: 0,
      stockItems: [],
    });

    expect(lines.filter((l) => l.lineDomain === 'stock')).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0].lineType).toBe('sale');
  });
});
