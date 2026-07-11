/**
 * inventoryIntelligenceService (frontend) — V2 Sprint 3D. Mirrors the
 * vpsAuthedFetch-mock convention used by godownService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { inventoryIntelligenceService } from "@/services/inventoryIntelligenceService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("inventoryIntelligenceService", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("getThresholds() calls GET /api/inventory-intelligence/thresholds and unwraps rows", async () => {
    const rows = [{ id: "t1", product_id: "p1", min_stock: 5, max_stock: 50 }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await inventoryIntelligenceService.getThresholds("dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/inventory-intelligence/thresholds?dealerId=dealer-1");
    expect(result).toEqual(rows);
  });

  it("setThreshold() PUTs to /api/inventory-intelligence/thresholds/:productId", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "t1", min_stock: 5, max_stock: null }));
    await inventoryIntelligenceService.setThreshold("dealer-1", "p1", { min_stock: 5, max_stock: null });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/inventory-intelligence/thresholds/p1?dealerId=dealer-1");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ min_stock: 5, max_stock: null });
  });

  it("setThreshold() throws a readable error when min exceeds max (server-rejected)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("min_stock cannot exceed max_stock", 400));
    await expect(inventoryIntelligenceService.setThreshold("dealer-1", "p1", { min_stock: 100, max_stock: 10 }))
      .rejects.toThrow("min_stock cannot exceed max_stock");
  });

  it("getLowStock() calls GET /api/inventory-intelligence/low-stock and unwraps rows", async () => {
    const rows = [{ product_id: "p1", status: "understock" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await inventoryIntelligenceService.getLowStock("dealer-1");
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe("/api/inventory-intelligence/low-stock?dealerId=dealer-1");
    expect(result).toEqual(rows);
  });

  it("getStockAging() calls GET /api/inventory-intelligence/stock-aging", async () => {
    const payload = { rows: [], bucketSummary: [] };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(payload));
    const result = await inventoryIntelligenceService.getStockAging("dealer-1");
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe("/api/inventory-intelligence/stock-aging?dealerId=dealer-1");
    expect(result).toEqual(payload);
  });

  it("getAnalytics() calls GET /api/inventory-intelligence/analytics and unwraps rows", async () => {
    const rows = [{ product_id: "p1", combined_class: "AX" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await inventoryIntelligenceService.getAnalytics("dealer-1");
    expect(result).toEqual(rows);
  });

  it("getValue() calls GET /api/inventory-intelligence/value", async () => {
    const payload = { totalStockValue: 1000, byWarehouse: [], byGodown: [] };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(payload));
    const result = await inventoryIntelligenceService.getValue("dealer-1");
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe("/api/inventory-intelligence/value?dealerId=dealer-1");
    expect(result).toEqual(payload);
  });

  it("getTurnover() calls GET /api/inventory-intelligence/turnover", async () => {
    const payload = { turnoverRatioAnnualized: 2, daysSalesOfInventory: 182.5 };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(payload));
    const result = await inventoryIntelligenceService.getTurnover("dealer-1");
    expect(result).toEqual(payload);
  });

  it("getHealth() calls GET /api/inventory-intelligence/health", async () => {
    const payload = { score: 82, breakdown: [] };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(payload));
    const result = await inventoryIntelligenceService.getHealth("dealer-1");
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe("/api/inventory-intelligence/health?dealerId=dealer-1");
    expect(result).toEqual(payload);
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Failed to load inventory health dashboard"));
    await expect(inventoryIntelligenceService.getHealth("dealer-1")).rejects.toThrow(
      "Failed to load inventory health dashboard",
    );
  });
});
