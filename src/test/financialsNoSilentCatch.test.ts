/**
 * Lint-style static-source-code tests for backend/src/routes/financials.ts.
 *
 * Track 1 Phase 1 acceptance criteria (#5 and #6 in the plan):
 *
 *   5. The string `.catch(() => null)` does not appear anywhere in
 *      backend/src/routes/financials.ts.
 *   6. The string `/​* ignore *​/` does not appear anywhere in
 *      backend/src/routes/financials.ts.
 *
 * These tests are the structural defense: they ensure the next engineer
 * to touch this file cannot silently swallow another column-name bug.
 *
 * If you intentionally want to ignore an error here, you must replace
 * the silent catch with `safeSum(...)` / `safeQuery(...)` / a logged
 * `try { ... } catch (err) { logRouteError(...) }`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FINANCIALS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "src",
  "routes",
  "financials.ts",
);

function readFinancials(): string {
  return readFileSync(FINANCIALS_PATH, "utf8");
}

describe("financials.ts — silent-catch lint", () => {
  it("L1 — file exists and is readable", () => {
    const src = readFinancials();
    expect(src.length).toBeGreaterThan(100);
    expect(src).toContain("router");
  });

  it("L2 — no `.catch(() => null)` pattern", () => {
    const src = readFinancials();
    const matches = src.match(/\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)/g);
    expect(matches, "found a silent .catch(() => null) — use safeSum/safeQuery instead").toBeNull();
  });

  it("L3 — no `.catch(() => 0)` or similar number-swallowing pattern", () => {
    const src = readFinancials();
    const matches = src.match(/\.catch\s*\(\s*\(\s*\)\s*=>\s*0\s*\)/g);
    expect(matches, "found a silent .catch(() => 0) — use safeSum instead").toBeNull();
  });

  it("L4 — no `catch { /​* ignore *​/ }` blocks", () => {
    const src = readFinancials();
    // Match `catch {` (no err binding) followed by an `ignore` comment.
    const pattern = /catch\s*\{\s*\/\*\s*ignore\s*\*\//g;
    const matches = src.match(pattern);
    expect(matches, "found a `catch { /​* ignore *​/ }` block — replace with safeSum or logRouteError").toBeNull();
  });

  it("L5 — every catch block either uses safeSum / safeQuery or calls logRouteError", () => {
    const src = readFinancials();
    // Find every `catch` keyword that opens a block.
    // For each, look at the next ~200 chars and ensure it references one of:
    //   - logRouteError / logRouteWarn
    //   - safeSum / safeQuery (acceptable when the catch is INSIDE the helper)
    //   - res.status (legitimate top-level error responses)
    const matches = [...src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]{0,300}?)\}/g)];
    for (const m of matches) {
      const body = m[1];
      const ok =
        /logRouteError|logRouteWarn|res\.status|res\.json|throw\b/.test(body);
      expect(
        ok,
        `found a catch block that neither logs nor responds — body was:\n${body.trim()}`,
      ).toBe(true);
    }
  });

  it("L6 — uses the new safeSum helper", () => {
    const src = readFinancials();
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/safeSum['"]/);
    expect(src).toMatch(/\bsafeSum\b/);
  });

  it("L7 — imports the structured logger helper", () => {
    const src = readFinancials();
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/logger['"]/);
  });
});

describe("financials.ts — correct column references", () => {
  it("C1 — COGS query reads from sales.cogs (not sale_items.cost_price)", () => {
    const src = readFinancials();
    // The fix: P&L COGS now sums sales.cogs, not si.cost_price.
    expect(src).toMatch(/sales\.cogs|sum\s*\(\s*\{?\s*total\s*:?\s*['"`]?cogs/i);
    // The bug: must not reference sale_items.cost_price anywhere.
    expect(src).not.toMatch(/sale_items.*cost_price/);
    expect(src).not.toMatch(/si\.cost_price/);
  });

  it("C2 — Sales Returns query reads sales_returns.refund_amount (not qty * rate)", () => {
    const src = readFinancials();
    expect(src).toMatch(/refund_amount/);
    // The bug: must not reference a `rate` column on sales_returns.
    expect(src).not.toMatch(/qty\s*\*\s*COALESCE\s*\(\s*rate/);
    expect(src).not.toMatch(/sales_returns.*\brate\b/);
  });

  it("C3 — legacy-cogs detector uses cogs_method, not the dead NULL check", () => {
    // Phase 1A: the previous `WHERE cogs IS NULL` detector was effectively
    // dead code because sales.cogs is NOT NULL DEFAULT 0. The real legacy
    // signal is the new sales.cogs_method column.
    const src = readFinancials();
    expect(src).toMatch(/cogs_method/);
    expect(src).toMatch(/legacy_pre_fix/);
  });
});

// ─── Phase 1A — routes/sales.ts unit-conversion lint ──────────────────────
//
// Re-introducing `effectiveQty * avgCost` inside the tile branch would
// silently bring back the bug. These tests are the structural defense.

const SALES_PATH = resolve(
  __dirname,
  "..",
  "..",
  "backend",
  "src",
  "routes",
  "sales.ts",
);

function readSales(): string {
  return readFileSync(SALES_PATH, "utf8");
}

describe("routes/sales.ts — Phase 1A tile-COGS conversion lint", () => {
  it("S1 — sales.ts imports and uses computeLineCogs", () => {
    const src = readSales();
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/cogsLine['"]/);
    expect(src).toMatch(/\bcomputeLineCogs\s*\(/);
  });

  it("S2 — the bare `effectiveQty * avgCost` pattern is gone", () => {
    const src = readSales();
    // Allow it inside comments by stripping single-line and block comments first.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    // Catches: effectiveQty * avgCost, effectiveQty*avgCost, with arbitrary whitespace.
    expect(stripped).not.toMatch(/effectiveQty\s*\*\s*avgCost/);
  });

  it("S3 — both POST and PUT handlers stamp cogs_method='post_fix'", () => {
    const src = readSales();
    // Each of the two write paths must set cogs_method to 'post_fix'.
    const occurrences = src.match(/cogs_method\s*:\s*['"]post_fix['"]/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
