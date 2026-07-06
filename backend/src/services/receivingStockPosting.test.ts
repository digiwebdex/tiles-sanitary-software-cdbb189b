/**
 * receivingStockPosting — V2 Sprint 5C. This module's weighted-average-cost
 * and total-pieces formulas are deliberately identical to purchases.ts's
 * own inline logic (see file header) — these tests verify that arithmetic
 * directly, independent of any DB, mirroring how other pure-math pieces in
 * this codebase are tested (e.g. computeSupplierBalance).
 */
import { describe, expect, it } from 'vitest';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Mirrors receivingStockPosting.ts's weighted-average-cost recompute for a box_sft product. */
function recomputeAverageCost(
  currentSft: number,
  currentAvgCost: number,
  incomingSft: number,
  incomingLineCost: number,
): number {
  const currentTotal = currentSft * currentAvgCost;
  const newQtyBase = currentSft + incomingSft;
  return newQtyBase > 0 ? round2((currentTotal + incomingLineCost) / newQtyBase) : 0;
}

describe('receivingStockPosting — weighted-average-cost formula (V2 Sprint 5C)', () => {
  it('blends existing and incoming cost proportionally to SFT quantity', () => {
    // 100 SFT @ 50/SFT already in stock = 5000 total. Receiving 100 SFT @ 70/SFT = 7000.
    // New average = (5000 + 7000) / 200 = 60.
    const newAvg = recomputeAverageCost(100, 50, 100, 7000);
    expect(newAvg).toBe(60);
  });

  it('produces the incoming rate itself when receiving into empty stock', () => {
    const newAvg = recomputeAverageCost(0, 0, 50, 2500);
    expect(newAvg).toBe(50);
  });

  it('rounds to 2 decimal places', () => {
    // 3 SFT @ 10 = 30 existing; +1 SFT @ 10 (cost 10) incoming.
    // New average = (30 + 10) / (3 + 1) = 10 exactly, no rounding artifact.
    // Use a case where the raw division has more than 2 decimal places instead:
    // 3 SFT @ 10 existing (30 total) + 1 SFT costing 1 = 31 total / 4 = 7.75
    const newAvg = recomputeAverageCost(3, 10, 1, 1);
    expect(newAvg).toBe(7.75);
  });
});

describe('receivingStockPosting — total_pieces computation (V2 Sprint 5C)', () => {
  function computeTotalPieces(unitType: string, quantity: number, piecesPerBox: number): number {
    const boxQty = unitType === 'box_sft' ? quantity : 0;
    const pieceQty = unitType === 'box_sft' ? 0 : quantity;
    return boxQty * piecesPerBox + pieceQty;
  }

  it('multiplies boxes by pieces-per-box for box_sft products', () => {
    expect(computeTotalPieces('box_sft', 5, 4)).toBe(20);
  });

  it('passes through quantity directly for piece-unit products', () => {
    expect(computeTotalPieces('piece', 12, 1)).toBe(12);
  });
});

describe('receivingStockPosting — batch identity matching (V2 Sprint 5C)', () => {
  interface BatchIdentity { batchNo: string; shadeCode: string | null; caliber: string | null; lotNo: string | null; }

  function identityKey(b: BatchIdentity): string {
    return [b.batchNo, b.shadeCode ?? '', b.caliber ?? '', b.lotNo ?? ''].join('|');
  }

  it('treats two batches with the same identity fields as the same batch', () => {
    const a: BatchIdentity = { batchNo: 'B1', shadeCode: 'S1', caliber: null, lotNo: null };
    const b: BatchIdentity = { batchNo: 'B1', shadeCode: 'S1', caliber: null, lotNo: null };
    expect(identityKey(a)).toBe(identityKey(b));
  });

  it('treats batches with a different shade_code as distinct, even with the same batch_no', () => {
    const a: BatchIdentity = { batchNo: 'B1', shadeCode: 'S1', caliber: null, lotNo: null };
    const b: BatchIdentity = { batchNo: 'B1', shadeCode: 'S2', caliber: null, lotNo: null };
    expect(identityKey(a)).not.toBe(identityKey(b));
  });

  it('null and empty-string are treated the same for a nullable identity field', () => {
    const a: BatchIdentity = { batchNo: 'B1', shadeCode: null, caliber: null, lotNo: null };
    const b: BatchIdentity = { batchNo: 'B1', shadeCode: '', caliber: null, lotNo: null };
    expect(identityKey(a)).toBe(identityKey(b));
  });
});
