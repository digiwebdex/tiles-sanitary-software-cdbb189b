import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCustomerBalance, computeSupplierBalance } from '../../backend/src/lib/ledgerBalance';
import { buildPurchaseLedgerLines } from '../../backend/src/services/posting/LedgerPostingEngine';
import { buildPurchaseStockLines } from '../../backend/src/services/posting/StockPostingEngine';
import { buildSaleLedgerLines } from '../../backend/src/services/posting/LedgerPostingEngine';
import { buildSaleStockLines } from '../../backend/src/services/posting/StockPostingEngine';
import type { PostingLineInput } from '../../backend/src/services/posting/types';

const persistPostingBatch = vi.fn();

vi.mock('../../backend/src/services/posting/postingLineWriter', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../backend/src/services/posting/postingLineWriter')
  >();
  return {
    ...actual,
    persistPostingBatch: (...args: unknown[]) => persistPostingBatch(...args),
  };
});

function supplierRowsFromPosting(lines: PostingLineInput[]) {
  return lines
    .filter((l) => l.lineDomain === 'supplier')
    .map((l) => ({ type: l.lineType, amount: l.amount }));
}

function customerRowsFromPosting(lines: PostingLineInput[]) {
  return lines
    .filter((l) => l.lineDomain === 'customer')
    .map((l) => ({ type: l.lineType, amount: l.amount }));
}

function cashNetFromPosting(lines: PostingLineInput[]) {
  return lines
    .filter((l) => l.lineDomain === 'cash' || l.lineDomain === 'bank')
    .reduce((sum, l) => sum + l.amount, 0);
}

function stockQtyNetFromPosting(lines: PostingLineInput[]) {
  return lines
    .filter((l) => l.lineDomain === 'stock')
    .reduce((sum, l) => sum + (l.qtyDelta ?? 0), 0);
}

/** Same assembly as purchases.ts P2-05 mirror payload. */
function buildPurchasePostMirrorLines(input: {
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

/** Same assembly as sales.ts P2-06 mirror payload. */
function buildSalePostMirrorLines(input: {
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

describe('posting dual-write parity (contract)', () => {
  it('purchase mirror lines match legacy supplier balance semantics', () => {
    const lines = buildPurchasePostMirrorLines({
      purchaseId: 'pur-parity-1',
      supplierId: 'sup-1',
      entryDate: '2026-06-01',
      netPayable: 50000,
      paidOnCreate: 15000,
      stockItems: [
        {
          purchaseItemId: 'pi-1',
          productId: 'prod-1',
          productBatchId: 'batch-1',
          quantity: 20,
          unitType: 'box_sft',
          totalPieces: 200,
          totalSft: 500,
          landedCost: 50000,
        },
      ],
    });

    const legacySupplier = [
      { type: 'purchase', amount: -50000 },
      { type: 'payment', amount: 15000 },
    ];

    expect(computeSupplierBalance(supplierRowsFromPosting(lines))).toBe(
      computeSupplierBalance(legacySupplier),
    );
    expect(computeSupplierBalance(supplierRowsFromPosting(lines))).toBe(35000);
    expect(stockQtyNetFromPosting(lines)).toBe(20);
    expect(cashNetFromPosting(lines)).toBe(-15000);
  });

  it('sale mirror lines match legacy customer balance semantics', () => {
    const lines = buildSalePostMirrorLines({
      saleId: 'sale-parity-1',
      customerId: 'cust-1',
      entryDate: '2026-06-02',
      totalAmount: 28800,
      paidAmount: 10000,
      stockItems: [
        {
          saleItemId: 'si-1',
          productId: 'prod-1',
          quantity: 6,
          unitType: 'box_sft',
          totalPieces: -60,
          cogsAmount: 12000,
          batchAllocations: [
            { productBatchId: 'batch-a', allocatedQty: 4, cogsAmount: 8000 },
            { productBatchId: 'batch-b', allocatedQty: 2, cogsAmount: 4000 },
          ],
        },
      ],
    });

    const legacyCustomer = [
      { type: 'sale', amount: 28800 },
      { type: 'payment', amount: 10000 },
    ];

    expect(computeCustomerBalance(customerRowsFromPosting(lines))).toBe(
      computeCustomerBalance(legacyCustomer),
    );
    expect(computeCustomerBalance(customerRowsFromPosting(lines))).toBe(18800);
    expect(stockQtyNetFromPosting(lines)).toBe(-6);
    expect(cashNetFromPosting(lines)).toBe(10000);
  });

  it('unpaid purchase has supplier payable but no cash movement', () => {
    const lines = buildPurchasePostMirrorLines({
      purchaseId: 'pur-parity-2',
      supplierId: 'sup-2',
      entryDate: '2026-06-01',
      netPayable: 12000,
      paidOnCreate: 0,
      stockItems: [
        {
          purchaseItemId: 'pi-2',
          productId: 'prod-2',
          productBatchId: 'batch-2',
          quantity: 3,
          unitType: 'piece',
          totalPieces: 3,
          landedCost: 12000,
        },
      ],
    });

    expect(computeSupplierBalance(supplierRowsFromPosting(lines))).toBe(12000);
    expect(cashNetFromPosting(lines)).toBe(0);
    expect(lines.some((l) => l.lineType === 'payment')).toBe(false);
  });

  it('challan-style sale mirror has ledger only when stock items empty', () => {
    const lines = buildSalePostMirrorLines({
      saleId: 'sale-parity-challan',
      customerId: 'cust-2',
      entryDate: '2026-06-03',
      totalAmount: 5000,
      paidAmount: 0,
      stockItems: [],
    });

    expect(lines.filter((l) => l.lineDomain === 'stock')).toHaveLength(0);
    expect(computeCustomerBalance(customerRowsFromPosting(lines))).toBe(5000);
  });
});

describe('PostingOrchestrator dual-write flag', () => {
  beforeEach(() => {
    persistPostingBatch.mockReset();
    persistPostingBatch.mockResolvedValue({ batchId: 'batch-mock', lineIds: ['line-mock'] });
    vi.resetModules();
  });

  it('does not persist when USE_POSTING_ENGINE is off', async () => {
    vi.doMock('../../backend/src/config/env', () => ({
      env: { USE_POSTING_ENGINE: 'false' },
    }));
    const { executeDualWritePost, isPostingEngineEnabled } = await import(
      '../../backend/src/services/posting/PostingOrchestrator'
    );

    expect(isPostingEngineEnabled()).toBe(false);

    const trx = {} as never;
    const result = await executeDualWritePost(
      {
        trx,
        dealerId: 'dealer-1',
        documentType: 'purchase',
        documentId: 'pur-1',
        eventType: 'posted',
        entryDate: '2026-06-01',
      },
      async () => ({ ok: true }),
      () => [{ lineDomain: 'supplier', lineType: 'purchase', amount: -100, entryDate: '2026-06-01' }],
    );

    expect(result.legacy).toEqual({ ok: true });
    expect(result.posting).toBeNull();
    expect(persistPostingBatch).not.toHaveBeenCalled();
  });

  it('persists posting batch when USE_POSTING_ENGINE is on', async () => {
    vi.doMock('../../backend/src/config/env', () => ({
      env: { USE_POSTING_ENGINE: 'true' },
    }));
    const { executeDualWritePost, isPostingEngineEnabled } = await import(
      '../../backend/src/services/posting/PostingOrchestrator'
    );

    expect(isPostingEngineEnabled()).toBe(true);

    const trx = {} as never;
    const lines = [
      { lineDomain: 'stock' as const, lineType: 'purchase_in', amount: 5000, entryDate: '2026-06-01' },
      { lineDomain: 'supplier' as const, lineType: 'purchase', amount: -5000, entryDate: '2026-06-01' },
    ];

    const result = await executeDualWritePost(
      {
        trx,
        dealerId: 'dealer-1',
        documentType: 'purchase',
        documentId: 'pur-2',
        eventType: 'posted',
        entryDate: '2026-06-01',
        idempotencyKey: 'purchase:post:pur-2',
      },
      async () => ({ purchaseId: 'pur-2' }),
      () => lines,
    );

    expect(result.posting).toEqual({ batchId: 'batch-mock', lineIds: ['line-mock'] });
    expect(persistPostingBatch).toHaveBeenCalledTimes(1);
    expect(persistPostingBatch).toHaveBeenCalledWith(
      trx,
      expect.objectContaining({
        dealerId: 'dealer-1',
        documentType: 'purchase',
        documentId: 'pur-2',
        idempotencyKey: 'purchase:post:pur-2',
      }),
      lines,
    );
  });
});

describe('posting idempotency contract', () => {
  it('createPostingBatch rejects duplicate idempotency keys', async () => {
    const { createPostingBatch } = await import(
      '../../backend/src/services/posting/postingLineWriter'
    );

    const trx = Object.assign(
      (table: string) => {
        if (table === 'posting_batches') {
          return {
            where: () => ({
              first: async () => ({ id: 'existing-batch' }),
            }),
            insert: () => {
              throw new Error('should not insert');
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      { fn: { now: () => new Date() } },
    ) as never;

    await expect(
      createPostingBatch(trx, {
        dealerId: 'dealer-1',
        documentType: 'purchase',
        documentId: 'pur-dup',
        eventType: 'posted',
        idempotencyKey: 'purchase:post:pur-dup',
      }),
    ).rejects.toThrow(/Duplicate post/);
  });
});
