/**
 * stockService.getLedger — V2 Sprint 3A (Inventory Core).
 *
 * Mirrors the vpsAuthedFetch-mock convention already used by
 * challanService.test.ts — stockService has had zero test coverage until
 * this file (the module previously only exercised approval/quantity math
 * with no request-shape assertions).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: { dealerId: "dealer-1" } },
}));

vi.mock("@/lib/validators", () => ({
  validateInput: vi.fn(),
  stockAdjustmentServiceSchema: {},
}));

import { stockService } from "@/services/stockService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("stockService.getLedger", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("calls GET /api/stock/ledger with dealerId only when no options are given", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await stockService.getLedger("dealer-1");

    expect(vpsAuthedFetchMock).toHaveBeenCalledTimes(1);
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/stock/ledger?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).not.toContain("productId=");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("to=");
  });

  it("includes productId when scoping to one product (the Stock History use case)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await stockService.getLedger("dealer-1", { productId: "prod-1" });

    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("productId=prod-1");
  });

  it("includes from/to/page/pageSize when provided", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await stockService.getLedger("dealer-1", {
      from: "2026-01-01",
      to: "2026-01-31",
      page: 2,
      pageSize: 10,
    });

    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-31");
    expect(url).toContain("page=2");
    expect(url).toContain("pageSize=10");
  });

  it("returns { rows, total } shaped from the response body", async () => {
    const rows = [{ id: "l1", product_id: "p1", txn_type: "adj_add" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows, total: 42 }));
    const result = await stockService.getLedger("dealer-1");
    expect(result).toEqual({ rows, total: 42 });
  });

  it("defaults total to 0 and rows to [] when the API returns neither", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    const result = await stockService.getLedger("dealer-1");
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Failed to load stock ledger"));
    await expect(stockService.getLedger("dealer-1")).rejects.toThrow("Failed to load stock ledger");
  });
});
