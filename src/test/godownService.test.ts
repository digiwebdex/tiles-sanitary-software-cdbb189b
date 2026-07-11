/**
 * godownService — V2 Sprint 3B (Warehouse & Godown).
 * Mirrors the vpsAuthedFetch-mock convention used by stockService.getLedger.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { godownService } from "@/services/godownService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("godownService", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("list() calls GET /api/godowns scoped to the dealer", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await godownService.list("dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/godowns?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).not.toContain("warehouseId=");
  });

  it("list() adds warehouseId only when provided", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await godownService.list("dealer-1", "wh-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("warehouseId=wh-1");
  });

  it("create() POSTs to /api/godowns with the dealer-scoped body", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "g1" }));
    await godownService.create("dealer-1", { warehouse_id: "wh-1", name: "Back Godown" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/godowns?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ warehouse_id: "wh-1", name: "Back Godown" });
  });

  it("update() PUTs to /api/godowns/:id", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "g1" }));
    await godownService.update("g1", "dealer-1", { is_default: true });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/godowns/g1?dealerId=dealer-1");
    expect(opts.method).toBe("PUT");
  });

  it("remove() DELETEs to /api/godowns/:id (soft delete)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await godownService.remove("g1", "dealer-1");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/godowns/g1?dealerId=dealer-1");
    expect(opts.method).toBe("DELETE");
  });

  it("stock() calls GET /api/godowns/:id/stock", async () => {
    const rows = [{ product_id: "p1" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await godownService.stock("g1", "dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/godowns/g1/stock?dealerId=dealer-1");
    expect(result).toEqual({ rows });
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Warehouse not found", 404));
    await expect(godownService.create("dealer-1", { warehouse_id: "bad", name: "X" }))
      .rejects.toThrow("Warehouse not found");
  });
});
