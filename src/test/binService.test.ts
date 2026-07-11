/**
 * binService — V2 Sprint 3B (Warehouse & Godown).
 * Mirrors the vpsAuthedFetch-mock convention used by godownService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { binService } from "@/services/binService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("binService", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("list() calls GET /api/bins scoped to the dealer", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await binService.list("dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/bins?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).not.toContain("rackId=");
  });

  it("list() adds rackId only when provided", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk([]));
    await binService.list("dealer-1", "r1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("rackId=r1");
  });

  it("create() POSTs to /api/bins with the dealer-scoped body", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "b1" }));
    await binService.create("dealer-1", { rack_id: "r1", bin_code: "A1" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/bins?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ rack_id: "r1", bin_code: "A1" });
  });

  it("update() PUTs to /api/bins/:id", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "b1" }));
    await binService.update("b1", "dealer-1", { storage_location: "Aisle 3" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/bins/b1?dealerId=dealer-1");
    expect(opts.method).toBe("PUT");
  });

  it("remove() DELETEs to /api/bins/:id (soft delete)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await binService.remove("b1", "dealer-1");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/bins/b1?dealerId=dealer-1");
    expect(opts.method).toBe("DELETE");
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Rack not found", 404));
    await expect(binService.create("dealer-1", { rack_id: "bad", bin_code: "X" }))
      .rejects.toThrow("Rack not found");
  });
});
