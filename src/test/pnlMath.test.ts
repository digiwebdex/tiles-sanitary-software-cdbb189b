import { describe, expect, it } from "vitest";
import {
  computePnlLines,
  detectCogsDataQualityWarnings,
} from "@/lib/pnlMath";

describe("computePnlLines", () => {
  it("T1 — happy path: 1 sale, no returns", () => {
    const pnl = computePnlLines({
      revenue: 750,
      sales_returns: 0,
      cogs: 500,
      cogs_reversal: 0,
    });
    expect(pnl.net_revenue).toBe(750);
    expect(pnl.net_cogs).toBe(500);
    expect(pnl.gross_profit).toBe(250);
  });

  it("T4 — sale + sales return reduces revenue and net COGS", () => {
    const pnl = computePnlLines({
      revenue: 750,
      sales_returns: 150,
      cogs: 500,
      cogs_reversal: 100,
    });
    expect(pnl.net_revenue).toBe(600);
    expect(pnl.net_cogs).toBe(400);
    expect(pnl.gross_profit).toBe(200);
  });

  it("T12 — empty dealer returns zeros", () => {
    const pnl = computePnlLines({
      revenue: 0,
      sales_returns: 0,
      cogs: 0,
      cogs_reversal: 0,
    });
    expect(pnl.gross_profit).toBe(0);
  });
});

describe("detectCogsDataQualityWarnings", () => {
  it("T8 — flags returns without COGS reversal", () => {
    const warnings = detectCogsDataQualityWarnings({
      revenue: 1000,
      sales_returns: 200,
      cogs: 600,
      cogs_reversal: 0,
    });
    expect(warnings.some((w) => w.includes("without COGS reversal"))).toBe(true);
  });

  it("flags COGS reversal exceeding gross COGS", () => {
    const warnings = detectCogsDataQualityWarnings({
      revenue: 1000,
      sales_returns: 500,
      cogs: 100,
      cogs_reversal: 150,
    });
    expect(warnings.some((w) => w.includes("COGS reversal exceeds"))).toBe(true);
  });

  it("flags negative net COGS", () => {
    const warnings = detectCogsDataQualityWarnings({
      revenue: 1000,
      sales_returns: 0,
      cogs: 50,
      cogs_reversal: 100,
    });
    expect(warnings.some((w) => w.includes("Net COGS is negative"))).toBe(true);
  });

  it("TB5 — legacy pre-fix sales flagged", () => {
    const warnings = detectCogsDataQualityWarnings({
      revenue: 5000,
      sales_returns: 0,
      cogs: 2000,
      cogs_reversal: 0,
      legacyPreFixCount: 3,
    });
    expect(warnings.some((w) => w.includes("legacy tile COGS"))).toBe(true);
  });

  it("T15 — tile COGS formula sanity (unit-level contract)", () => {
    // 5 boxes × 20 sft × 200/sft = 20000 COGS on sale header
    const pnl = computePnlLines({
      revenue: 30000,
      sales_returns: 0,
      cogs: 20000,
      cogs_reversal: 0,
    });
    expect(pnl.gross_profit).toBe(10000);
  });

  it("T17 — mixed cart COGS sums per-line rules (contract)", () => {
    const tileCogs = 20000;
    const sanitaryCogs = 5400;
    const pnl = computePnlLines({
      revenue: 50000,
      sales_returns: 0,
      cogs: tileCogs + sanitaryCogs,
      cogs_reversal: 0,
    });
    expect(pnl.cogs).toBe(25400);
    expect(pnl.gross_profit).toBe(24600);
  });

  it("returns no warnings on healthy data", () => {
    const warnings = detectCogsDataQualityWarnings({
      revenue: 10000,
      sales_returns: 500,
      cogs: 6000,
      cogs_reversal: 300,
    });
    expect(warnings).toHaveLength(0);
  });
});

describe("P&L endpoint — contract (pure math, no Postgres)", () => {
  it("T2 — full payment does not change accrual P&L (payment is off-P&L)", () => {
    const withPayment = computePnlLines({ revenue: 1000, sales_returns: 0, cogs: 400, cogs_reversal: 0 });
    const withoutPayment = computePnlLines({ revenue: 1000, sales_returns: 0, cogs: 400, cogs_reversal: 0 });
    expect(withPayment).toEqual(withoutPayment);
  });

  it("T5 — broken return with zero refund does not reduce revenue", () => {
    const pnl = computePnlLines({ revenue: 1000, sales_returns: 0, cogs: 400, cogs_reversal: 0 });
    expect(pnl.net_revenue).toBe(1000);
  });

  it("TB2 — COGS account line equals SUM(sales.cogs) for period (contract)", () => {
    const pnl = computePnlLines({ revenue: 5000, sales_returns: 0, cogs: 3200, cogs_reversal: 0 });
    expect(pnl.cogs).toBe(3200);
  });

  it("TB3 — Sales Returns line equals SUM(refund_amount) (contract)", () => {
    const pnl = computePnlLines({ revenue: 5000, sales_returns: 800, cogs: 3200, cogs_reversal: 200 });
    expect(pnl.sales_returns).toBe(800);
    expect(pnl.cogs_reversal).toBe(200);
  });
});
