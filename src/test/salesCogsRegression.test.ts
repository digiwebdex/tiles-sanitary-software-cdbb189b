/**
 * Canonical Bangladesh tile + sanitary product fixtures.
 * Locks the COGS math against future refactors of routes/sales.ts.
 *
 * Each fixture is a real-world catalogue entry; the expected COGS is
 * computed by hand and embedded in the test source so any silent
 * regression is a one-line diff that fails CI loudly.
 */
import { describe, it, expect } from "vitest";
import { computeLineCogs } from "../../backend/src/lib/cogsLine";

interface Fixture {
  name: string;
  unitType: "box_sft" | "piece";
  perBoxSft: number;
  avgCost: number;       // per SFT for tile, per piece for sanitary
  effectiveQty: number;  // boxes for tile, pieces for sanitary
  expected: number;      // computed by hand below
}

const fixtures: Fixture[] = [
  // ───────── Tile catalogue (typical BD showroom SKUs) ─────────
  {
    name: "12×12 ceramic floor (1 sft × 12 pieces per box = 12 sft/box)",
    unitType: "box_sft", perBoxSft: 12, avgCost: 60,
    effectiveQty: 10, expected: 10 * 12 * 60, // 7,200
  },
  {
    name: "18×18 ceramic floor (2.25 sft × 8 pieces = 18 sft/box)",
    unitType: "box_sft", perBoxSft: 18, avgCost: 90,
    effectiveQty: 4, expected: 4 * 18 * 90, // 6,480
  },
  {
    name: "24×24 vitrified (4 sft × 4 pieces = 16 sft/box)",
    unitType: "box_sft", perBoxSft: 16, avgCost: 150,
    effectiveQty: 6, expected: 6 * 16 * 150, // 14,400
  },
  {
    name: "32×32 polished (~7 sft × 3 pieces ≈ 21 sft/box)",
    unitType: "box_sft", perBoxSft: 21, avgCost: 220,
    effectiveQty: 3, expected: 3 * 21 * 220, // 13,860
  },
  {
    name: "60×60 GVT (~3.88 sft × 4 pieces ≈ 15.5 sft/box)",
    unitType: "box_sft", perBoxSft: 15.5, avgCost: 350,
    effectiveQty: 2, expected: 2 * 15.5 * 350, // 10,850
  },

  // ───────── Sanitary (piece-unit) ─────────
  {
    name: "Wall-hung commode (single piece, ৳4,200 cost)",
    unitType: "piece", perBoxSft: 0, avgCost: 4200,
    effectiveQty: 1, expected: 1 * 4200, // 4,200
  },
  {
    name: "Pillar tap (12 pieces, ৳650 cost each)",
    unitType: "piece", perBoxSft: 0, avgCost: 650,
    effectiveQty: 12, expected: 12 * 650, // 7,800
  },
  {
    name: "Wash basin pedestal (3 pieces, ৳1,800 cost each)",
    unitType: "piece", perBoxSft: 0, avgCost: 1800,
    effectiveQty: 3, expected: 3 * 1800, // 5,400
  },
];

describe("Canonical product fixtures — COGS regression lock", () => {
  for (const fx of fixtures) {
    it(`${fx.name} → COGS = ৳${fx.expected.toLocaleString()}`, () => {
      const result = computeLineCogs({
        unitType: fx.unitType,
        effectiveQty: fx.effectiveQty,
        perBoxSft: fx.perBoxSft,
        avgCost: fx.avgCost,
      });
      expect(result).toBeCloseTo(fx.expected, 6);
    });
  }
});
