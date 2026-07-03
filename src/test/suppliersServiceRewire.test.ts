/**
 * supplierService — VPS API client tests (Phase 3U-17 cutover).
 *
 * supplierService is VPS-only; all reads/writes go through /api/suppliers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: null },
}));

import { supplierService } from "@/services/supplierService";

function mockVpsOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockVpsErr(error: string, status = 400) {
  return {
    ok: false,
    status,
    json: async () => ({ error }),
  };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("supplierService — VPS API client", () => {
  it("list (no search) → GET /api/suppliers with paging params", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockVpsOk({ rows: [{ id: "s1", name: "Alpha" }], total: 1 }),
    );

    const result = await supplierService.list("dealer-1", "", 1);

    expect(vpsAuthedFetchMock).toHaveBeenCalledTimes(1);
    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("/api/suppliers?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("page=0");
    expect(url).toContain("pageSize=25");
    expect(url).not.toContain("search=");
    expect(result).toEqual({ data: [{ id: "s1", name: "Alpha" }], total: 1 });
  });

  it("search list → includes search query param", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockVpsOk({ rows: [{ id: "s2", name: "Beta" }], total: 1 }),
    );

    const result = await supplierService.list("dealer-1", "bet", 2);

    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("search=bet");
    expect(url).toContain("page=1");
    expect(result).toEqual({ data: [{ id: "s2", name: "Beta" }], total: 1 });
  });

  it("propagates API errors from list", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("network down", 503));

    await expect(supplierService.list("dealer-1", "", 1)).rejects.toThrow(
      "network down",
    );
  });
});
