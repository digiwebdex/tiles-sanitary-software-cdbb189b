/**
 * Unit tests for the safeSum / safeQuery helpers introduced in
 * Track 1 Phase 1 to replace the silent `.catch(() => null)` pattern
 * inside backend/src/routes/financials.ts.
 *
 * These tests run in the frontend Vitest harness (jsdom env). The
 * helpers are pure (only depend on stderr.write), so no DB is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeSum, safeQuery } from "../../backend/src/lib/safeSum";

describe("safeSum", () => {
  let warnings: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnings = [];
    // Silence + capture structured log writes so the test output stays clean.
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("S1 — returns the inner numeric result on success", async () => {
    const result = await safeSum(
      { route: "test.s1", label: "Test", warnings },
      async () => 42,
    );
    expect(result).toBe(42);
    expect(warnings).toEqual([]);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("S1b — coerces string/number-ish to number on success", async () => {
    const a = await safeSum({ route: "t", label: "T", warnings }, async () => "100" as unknown as number);
    expect(a).toBe(100);
    const b = await safeSum({ route: "t", label: "T", warnings }, async () => null);
    expect(b).toBe(0);
    const c = await safeSum({ route: "t", label: "T", warnings }, async () => undefined);
    expect(c).toBe(0);
    const d = await safeSum({ route: "t", label: "T", warnings }, async () => Number.NaN);
    expect(d).toBe(0);
    expect(warnings).toEqual([]); // these are not errors
  });

  it("S2 — returns 0 when the inner function throws", async () => {
    const result = await safeSum(
      { route: "test.s2", label: "Test", warnings },
      async () => {
        throw new Error("boom");
      },
    );
    expect(result).toBe(0);
  });

  it("S3 — appends a descriptive warning when the inner function throws", async () => {
    await safeSum(
      { route: "test.s3", label: "COGS", warnings },
      async () => {
        throw new Error("column does not exist");
      },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("COGS");
    expect(warnings[0]).toContain("column does not exist");
  });

  it("S4 — emits a structured stderr log line on error", async () => {
    await safeSum(
      { route: "financials.pnl.cogs", label: "COGS", warnings, context: { dealerId: "abc" } },
      async () => {
        throw new Error("kaboom");
      },
    );
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const line = (stderrSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("error");
    expect(parsed.route).toBe("financials.pnl.cogs");
    expect(parsed.message).toBe("kaboom");
    expect(parsed.dealerId).toBe("abc");
    expect(typeof parsed.ts).toBe("string");
  });

  it("S5 — never throws itself, even when the inner throws a non-Error", async () => {
    await expect(
      safeSum({ route: "t", label: "T", warnings }, async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string-thrown" as unknown as Error;
      }),
    ).resolves.toBe(0);
    expect(warnings[0]).toContain("string-thrown");
  });
});

describe("safeQuery", () => {
  let warnings: string[];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnings = [];
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("returns inner array on success", async () => {
    const rows = [{ category: "Rent", total: 100 }];
    const result = await safeQuery(
      { route: "t", label: "Expenses", warnings },
      async () => rows,
      [],
    );
    expect(result).toBe(rows);
    expect(warnings).toEqual([]);
  });

  it("returns fallback + appends warning on throw", async () => {
    const result = await safeQuery<{ x: number }[]>(
      { route: "t", label: "Expenses", warnings },
      async () => {
        throw new Error("missing table");
      },
      [],
    );
    expect(result).toEqual([]);
    expect(warnings[0]).toContain("Expenses");
    expect(warnings[0]).toContain("missing table");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});
