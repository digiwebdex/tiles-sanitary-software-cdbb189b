/**
 * Unit tests for computeLineCogs — the Phase 1A fix for the tile COGS
 * unit-mismatch bug in routes/sales.ts.
 *
 * Every case below traces back to a numeric example in:
 *   docs/PHASE_1A_BACKFILL_NOTES.md
 *
 * These tests would have caught the original bug instantly: C1 alone
 * locks the canonical 5 boxes × 20 sft/box × ৳200/sft = ৳20,000 example
 * that the brutal review used to surface the defect.
 */
import { describe, it, expect } from "vitest";
import {
  computeLineCogs,
  InvalidProductPerBoxSftError,
} from "../../backend/src/lib/cogsLine";

describe("computeLineCogs — tile (box_sft)", () => {
  it("C1 — whole-box tile sale (canonical worked example)", () => {
    // 5 boxes × 20 sft/box × ৳200/sft = ৳20,000
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 5,
      perBoxSft: 20,
      avgCost: 200,
    });
    expect(cogs).toBe(20_000);
  });

  it("C2 — fractional-box tile sale (5 boxes + 6 pieces at ppb=12 → 5.5 boxes)", () => {
    // effectiveQty = 5 + 6/12 = 5.5
    // cogs = 5.5 × 20 × 200 = ৳22,000
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 5.5,
      perBoxSft: 20,
      avgCost: 200,
    });
    expect(cogs).toBe(22_000);
  });

  it("C3 — small per_box_sft (12×12 floor tile, 4 sft/box)", () => {
    // 10 boxes × 4 sft × ৳100/sft = ৳4,000
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 10,
      perBoxSft: 4,
      avgCost: 100,
    });
    expect(cogs).toBe(4_000);
  });

  it("C4 — large per_box_sft (60×60 GVT, 25 sft/box)", () => {
    // 2 × 25 × 350 = ৳17,500
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 2,
      perBoxSft: 25,
      avgCost: 350,
    });
    expect(cogs).toBe(17_500);
  });

  it("C5 — avgCost = 0 (legacy product with no purchase history)", () => {
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 5,
      perBoxSft: 20,
      avgCost: 0,
    });
    expect(cogs).toBe(0);
  });

  it("C6 — perBoxSft = 0 throws InvalidProductPerBoxSftError", () => {
    expect(() =>
      computeLineCogs({
        unitType: "box_sft",
        effectiveQty: 5,
        perBoxSft: 0,
        avgCost: 200,
      }),
    ).toThrow(InvalidProductPerBoxSftError);
  });

  it("C7 — perBoxSft = null throws InvalidProductPerBoxSftError", () => {
    expect(() =>
      computeLineCogs({
        unitType: "box_sft",
        effectiveQty: 5,
        perBoxSft: null,
        avgCost: 200,
      }),
    ).toThrow(InvalidProductPerBoxSftError);
  });

  it("C7b — perBoxSft = undefined throws (defensive)", () => {
    expect(() =>
      computeLineCogs({
        unitType: "box_sft",
        effectiveQty: 5,
        perBoxSft: undefined,
        avgCost: 200,
      }),
    ).toThrow(InvalidProductPerBoxSftError);
  });

  it("C12 — negative effectiveQty (return-reversal scenario)", () => {
    // -5 × 20 × 200 = -৳20,000
    const cogs = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: -5,
      perBoxSft: 20,
      avgCost: 200,
    });
    expect(cogs).toBe(-20_000);
  });
});

describe("computeLineCogs — piece-unit products (sanitary)", () => {
  it("C8 — integer-qty piece sale (commode, ৳3,500 each)", () => {
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: 7,
      perBoxSft: 0,
      avgCost: 3500,
    });
    expect(cogs).toBe(24_500);
  });

  it("C9 — piece sale with avgCost = 0", () => {
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: 7,
      perBoxSft: 0,
      avgCost: 0,
    });
    expect(cogs).toBe(0);
  });

  it("C10 — piece sale ignores perBoxSft entirely (even if set)", () => {
    // perBoxSft must NOT influence piece-product COGS.
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: 7,
      perBoxSft: 20, // bogus value — must be ignored
      avgCost: 150,
    });
    expect(cogs).toBe(1050);
  });

  it("C11 — unknown unitType falls through to piece-like behaviour", () => {
    const cogs = computeLineCogs({
      unitType: "something_new",
      effectiveQty: 7,
      perBoxSft: 0,
      avgCost: 150,
    });
    expect(cogs).toBe(1050);
  });

  it("piece — null/undefined unitType defaults to piece behaviour", () => {
    const a = computeLineCogs({
      unitType: null,
      effectiveQty: 4,
      perBoxSft: 0,
      avgCost: 250,
    });
    expect(a).toBe(1000);

    const b = computeLineCogs({
      unitType: undefined,
      effectiveQty: 4,
      perBoxSft: 0,
      avgCost: 250,
    });
    expect(b).toBe(1000);
  });
});

describe("computeLineCogs — defensive numeric coercion", () => {
  it("non-finite avgCost falls back to 0", () => {
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: 5,
      perBoxSft: 0,
      avgCost: Number.NaN,
    });
    expect(cogs).toBe(0);
  });

  it("non-finite effectiveQty falls back to 0", () => {
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: Number.NaN,
      perBoxSft: 0,
      avgCost: 250,
    });
    expect(cogs).toBe(0);
  });

  it("null avgCost on piece returns 0 (no throw)", () => {
    const cogs = computeLineCogs({
      unitType: "piece",
      effectiveQty: 5,
      perBoxSft: 0,
      avgCost: null,
    });
    expect(cogs).toBe(0);
  });
});

describe("Comparison to the original bug — sanity demonstration", () => {
  // These two assertions document what the bug WAS vs what the fix DOES.
  // If both pass, the fix is correct AND the bug is real.

  it("BUG vs FIX — tile sale: old formula was off by factor of per_box_sft", () => {
    const OLD_buggy = 5 * 200; // effectiveQty (boxes) × avgCost (৳/sft) — silently wrong
    const NEW_correct = computeLineCogs({
      unitType: "box_sft",
      effectiveQty: 5,
      perBoxSft: 20,
      avgCost: 200,
    });
    // The new value is exactly per_box_sft times the old (buggy) value.
    expect(NEW_correct).toBe(OLD_buggy * 20);
    expect(NEW_correct).toBe(20_000);
    expect(OLD_buggy).toBe(1_000); // confirms the original understatement
  });

  it("FIX preserves piece-product behaviour bit-for-bit", () => {
    const OLD_correct = 7 * 3500;
    const NEW = computeLineCogs({
      unitType: "piece",
      effectiveQty: 7,
      perBoxSft: 0,
      avgCost: 3500,
    });
    expect(NEW).toBe(OLD_correct);
  });
});
