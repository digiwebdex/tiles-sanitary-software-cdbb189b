import { describe, expect, it } from 'vitest';
import { buildPurchaseLedgerLines } from '../../backend/src/services/posting/LedgerPostingEngine';
import { buildPurchaseStockLines } from '../../backend/src/services/posting/StockPostingEngine';

/** Mirrors purchases.ts POST dual-write line assembly (P2-05). */
function buildPurchasePostLines(input: {
  purchaseId: string;
  supplierId: string;
  entryDate: string;
  netPayable: number;
  paidOnCreate: number;
  stockItems: Parameters<typeof buildPurchaseStockLines>[0]['items'];
}) {
  return [
    ...buildPurchaseStockLines({
      purchaseId: input.purchaseId,
      entryDate: input.entryDate,
      items: input.stockItems,
    }),
    ...buildPurchaseLedgerLines({
      purchaseId: input.purchaseId,
      supplierId: input.supplierId,
      entryDate: input.entryDate,
      netPayable: input.netPayable,
      paidOnCreate: input.paidOnCreate,
    }),
  ];
}

describe('purchase POST dual-write line assembly', () => {
  it('combines stock and ledger lines for a typical paid purchase', () => {
    const lines = buildPurchasePostLines({
      purchaseId: 'pur-1',
      supplierId: 'sup-1',
      entryDate: '2026-06-01',
      netPayable: 10000,
      paidOnCreate: 4000,
      stockItems: [
        {
          purchaseItemId: 'pi-1',
          productId: 'prod-1',
          productBatchId: 'batch-1',
          quantity: 5,
          unitType: 'box_sft',
          totalPieces: 50,
          totalSft: 125,
          landedCost: 10000,
        },
      ],
    });

    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.lineDomain === 'stock')).toHaveLength(1);
    expect(lines.filter((l) => l.lineDomain === 'supplier')).toHaveLength(2);
    expect(lines.filter((l) => l.lineDomain === 'cash')).toHaveLength(1);

    const purchaseLine = lines.find((l) => l.lineType === 'purchase');
    expect(purchaseLine?.amount).toBe(-10000);

    const stockLine = lines.find((l) => l.lineType === 'purchase_in');
    expect(stockLine?.qtyDelta).toBe(5);
    expect(stockLine?.amount).toBe(10000);
  });

  it('omits payment/cash lines when unpaid on create', () => {
    const lines = buildPurchasePostLines({
      purchaseId: 'pur-2',
      supplierId: 'sup-2',
      entryDate: '2026-06-01',
      netPayable: 5000,
      paidOnCreate: 0,
      stockItems: [
        {
          purchaseItemId: 'pi-2',
          productId: 'prod-2',
          productBatchId: 'batch-2',
          quantity: 2,
          unitType: 'piece',
          totalPieces: 2,
          landedCost: 5000,
        },
      ],
    });

    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.lineType === 'payment')).toBe(false);
    expect(lines.some((l) => l.lineDomain === 'cash')).toBe(false);
  });
});
