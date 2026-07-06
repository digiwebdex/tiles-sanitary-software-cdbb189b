import { describe, expect, it } from 'vitest';
import {
  computeAgingBucket, computeStockAgingFromBatches,
  computeAbcClass, computeXyzClass, computeAbcXyzFromInputs,
  computeLocationValue, computeTurnoverFromInputs,
  computeLowStockStatus, computeHealthScoreFromInputs,
} from './inventoryIntelligenceService';

describe('computeAgingBucket (V2 Sprint 3D Stock Aging)', () => {
  it('buckets 0-30 / 31-60 / 61-90 / 90+ correctly at the boundaries', () => {
    expect(computeAgingBucket(0)).toBe('0-30');
    expect(computeAgingBucket(30)).toBe('0-30');
    expect(computeAgingBucket(31)).toBe('31-60');
    expect(computeAgingBucket(60)).toBe('31-60');
    expect(computeAgingBucket(61)).toBe('61-90');
    expect(computeAgingBucket(90)).toBe('61-90');
    expect(computeAgingBucket(91)).toBe('90+');
    expect(computeAgingBucket(1000)).toBe('90+');
  });
});

describe('computeStockAgingFromBatches', () => {
  const asOf = new Date('2026-06-30T00:00:00Z').getTime();

  it('computes age_days from created_at and assigns the correct bucket', () => {
    const { rows } = computeStockAgingFromBatches(
      [{
        id: 'b1', product_id: 'p1', product_name: 'Tile A', batch_no: 'B-001',
        lot_no: 'L1', shade_code: 'S1', caliber: 'C1', total_pieces: 100,
        created_at: '2026-06-01T00:00:00Z', // 29 days before asOf
      }],
      asOf,
    );
    expect(rows[0].age_days).toBe(29);
    expect(rows[0].bucket).toBe('0-30');
  });

  it('aggregates batch counts and total pieces per bucket', () => {
    const { bucketSummary } = computeStockAgingFromBatches(
      [
        { id: 'b1', product_id: 'p1', product_name: 'A', batch_no: 'B1', lot_no: null, shade_code: null, caliber: null, total_pieces: 50, created_at: '2026-06-25T00:00:00Z' },
        { id: 'b2', product_id: 'p1', product_name: 'A', batch_no: 'B2', lot_no: null, shade_code: null, caliber: null, total_pieces: 30, created_at: '2026-06-20T00:00:00Z' },
        { id: 'b3', product_id: 'p2', product_name: 'B', batch_no: 'B3', lot_no: null, shade_code: null, caliber: null, total_pieces: 200, created_at: '2026-01-01T00:00:00Z' },
      ],
      asOf,
    );
    const zeroToThirty = bucketSummary.find((b) => b.bucket === '0-30')!;
    expect(zeroToThirty.batchCount).toBe(2);
    expect(zeroToThirty.totalPieces).toBe(80);
    const ninetyPlus = bucketSummary.find((b) => b.bucket === '90+')!;
    expect(ninetyPlus.batchCount).toBe(1);
    expect(ninetyPlus.totalPieces).toBe(200);
  });

  it('always returns all four buckets, even when empty', () => {
    const { bucketSummary } = computeStockAgingFromBatches([], asOf);
    expect(bucketSummary.map((b) => b.bucket)).toEqual(['0-30', '31-60', '61-90', '90+']);
    expect(bucketSummary.every((b) => b.batchCount === 0)).toBe(true);
  });
});

describe('computeAbcClass (Pareto thresholds)', () => {
  it('classifies A at <= 70% cumulative share, B at <= 90%, C above', () => {
    expect(computeAbcClass(50)).toBe('A');
    expect(computeAbcClass(70)).toBe('A');
    expect(computeAbcClass(71)).toBe('B');
    expect(computeAbcClass(90)).toBe('B');
    expect(computeAbcClass(91)).toBe('C');
    expect(computeAbcClass(100)).toBe('C');
  });
});

describe('computeXyzClass (coefficient of variation)', () => {
  it('classifies X for stable demand (low CV)', () => {
    expect(computeXyzClass([10, 10, 10])).toBe('X');
  });
  it('classifies Z for zero demand across all windows', () => {
    expect(computeXyzClass([0, 0, 0])).toBe('Z');
  });
  it('classifies Z for highly erratic demand', () => {
    expect(computeXyzClass([100, 0, 0])).toBe('Z');
  });
});

describe('computeAbcXyzFromInputs', () => {
  it('ranks by stock value descending and computes cumulative share', () => {
    const rows = computeAbcXyzFromInputs([
      { product_id: 'p1', name: 'Low', sku: 'L', stock_value: 100, sold_0_30: 5, sold_31_60: 5, sold_61_90: 5 },
      { product_id: 'p2', name: 'High', sku: 'H', stock_value: 900, sold_0_30: 5, sold_31_60: 5, sold_61_90: 5 },
    ]);
    expect(rows[0].product_id).toBe('p2'); // highest value first
    expect(rows[0].value_share_pct).toBe(90);
    expect(rows[0].cumulative_value_share_pct).toBe(90);
    expect(rows[0].abc_class).toBe('B'); // 90% cumulative -> B (<=90)
    expect(rows[1].cumulative_value_share_pct).toBe(100);
    expect(rows[1].abc_class).toBe('C');
  });

  it('produces a combined_class string of ABC+XYZ', () => {
    // A single product is necessarily 100% of cumulative value share, which
    // falls in the C bucket under the 70/90 Pareto thresholds — ABC analysis
    // assumes a portfolio of several items; this just checks the string format.
    const rows = computeAbcXyzFromInputs([
      { product_id: 'p1', name: 'Steady', sku: 'S', stock_value: 1000, sold_0_30: 10, sold_31_60: 10, sold_61_90: 10 },
    ]);
    expect(rows[0].combined_class).toBe('CX');
  });

  it('handles zero total value without dividing by zero', () => {
    const rows = computeAbcXyzFromInputs([
      { product_id: 'p1', name: 'Empty', sku: 'E', stock_value: 0, sold_0_30: 0, sold_31_60: 0, sold_61_90: 0 },
    ]);
    expect(rows[0].value_share_pct).toBe(0);
  });
});

describe('computeLocationValue (per-SFT for box_sft, per-piece otherwise)', () => {
  it('values box_sft products by SFT quantity, not box or piece quantity', () => {
    // 3.5 SFT/box * cost 100/SFT should NOT equal box_qty(1) * 100
    expect(computeLocationValue('box_sft', 3.5, 0, 100)).toBe(350);
  });
  it('values piece products by piece quantity', () => {
    expect(computeLocationValue('piece', 0, 20, 15)).toBe(300);
  });
});

describe('computeTurnoverFromInputs', () => {
  it('annualizes 90-day COGS (x4) and divides by current stock value', () => {
    const r = computeTurnoverFromInputs(2500, 10000);
    expect(r.turnoverRatioAnnualized).toBe(1); // 2500*4 / 10000 = 1
    expect(r.daysSalesOfInventory).toBe(365);
  });
  it('returns zero/null when current stock value is zero', () => {
    const r = computeTurnoverFromInputs(500, 0);
    expect(r.turnoverRatioAnnualized).toBe(0);
    expect(r.daysSalesOfInventory).toBeNull();
  });
});

describe('computeLowStockStatus', () => {
  it('flags understock when free stock is below min_stock', () => {
    expect(computeLowStockStatus(5, 10, 8, null)).toBe('understock');
  });
  it('flags overstock when free stock exceeds max_stock', () => {
    expect(computeLowStockStatus(150, 10, null, 100)).toBe('overstock');
  });
  it('flags reorder when free stock is at/below reorder_level and no thresholds set', () => {
    expect(computeLowStockStatus(10, 10, null, null)).toBe('reorder');
  });
  it('defaults to ok when nothing is triggered', () => {
    expect(computeLowStockStatus(50, 10, 5, 100)).toBe('ok');
  });
  it('understock takes priority over overstock when both somehow apply', () => {
    expect(computeLowStockStatus(3, 10, 5, 2)).toBe('understock');
  });
});

describe('computeHealthScoreFromInputs', () => {
  it('scores 100 when there are no issues at all', () => {
    const r = computeHealthScoreFromInputs({
      totalActiveProducts: 100, understockCount: 0, overstockCount: 0,
      stockoutRiskCount: 0, slowMovingCount: 0, deadStockValue: 0, totalStockValue: 100000,
    });
    expect(r.score).toBe(100);
    expect(r.breakdown.every((b) => b.penalty === 0)).toBe(true);
  });

  it('subtracts weighted penalties proportional to affected ratio', () => {
    const r = computeHealthScoreFromInputs({
      totalActiveProducts: 100, understockCount: 0, overstockCount: 0,
      stockoutRiskCount: 100, // 100% of products at stockout risk -> full 25pt penalty
      slowMovingCount: 0, deadStockValue: 0, totalStockValue: 100000,
    });
    expect(r.score).toBe(75);
  });

  it('never goes below 0', () => {
    const r = computeHealthScoreFromInputs({
      totalActiveProducts: 10, understockCount: 10, overstockCount: 10,
      stockoutRiskCount: 10, slowMovingCount: 10, deadStockValue: 100000, totalStockValue: 100000,
    });
    expect(r.score).toBe(0);
  });
});
