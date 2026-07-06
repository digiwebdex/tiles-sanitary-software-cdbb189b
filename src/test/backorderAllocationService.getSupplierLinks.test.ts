/**
 * backorderAllocationService.getSupplierLinks — V2 Sprint 3C "Supplier
 * Backorder". Mirrors the vpsAuthedFetch-mock convention used by
 * godownService.test.ts. This service previously only had read helpers with
 * no test coverage; this file adds coverage for the one new addition.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { backorderAllocationService } from "@/services/backorderAllocationService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("backorderAllocationService.getSupplierLinks", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("calls GET /api/backorders/supplier-links with the dealer id and unwraps rows", async () => {
    const rows = [{ id: "l1", planned_qty: 10 }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await backorderAllocationService.getSupplierLinks("dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/backorders/supplier-links?dealerId=dealer-1");
    expect(result).toEqual(rows);
  });

  it("defaults to [] when rows is missing", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    const result = await backorderAllocationService.getSupplierLinks("dealer-1");
    expect(result).toEqual([]);
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Failed to load supplier backorder links"));
    await expect(backorderAllocationService.getSupplierLinks("dealer-1")).rejects.toThrow(
      "Failed to load supplier backorder links",
    );
  });
});
