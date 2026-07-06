/**
 * rackService — V2 Sprint 3B (Warehouse & Godown).
 * Mirrors the vpsAuthedFetch-mock convention used by godownService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { rackService } from "@/services/rackService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("rackService", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("list() calls GET /api/racks scoped to the dealer", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await rackService.list("dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/racks?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).not.toContain("godownId=");
  });

  it("list() adds godownId only when provided", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await rackService.list("dealer-1", "g1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("godownId=g1");
  });

  it("create() POSTs to /api/racks with the dealer-scoped body", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await rackService.create("dealer-1", { godown_id: "g1", name: "Rack A" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/racks?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ godown_id: "g1", name: "Rack A" });
  });

  it("update() PUTs to /api/racks/:id", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await rackService.update("r1", "dealer-1", { is_active: false });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/racks/r1?dealerId=dealer-1");
    expect(opts.method).toBe("PUT");
  });

  it("remove() DELETEs to /api/racks/:id (soft delete)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await rackService.remove("r1", "dealer-1");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/racks/r1?dealerId=dealer-1");
    expect(opts.method).toBe("DELETE");
  });

  it("stock() calls GET /api/racks/:id/stock", async () => {
    const rows = [{ product_id: "p1" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await rackService.stock("r1", "dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/racks/r1/stock?dealerId=dealer-1");
    expect(result).toEqual({ rows });
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Godown not found", 404));
    await expect(rackService.create("dealer-1", { godown_id: "bad", name: "X" }))
      .rejects.toThrow("Godown not found");
  });
});
