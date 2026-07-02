/**
 * customerService — VPS API client tests (Phase 3U-17 cutover).
 *
 * customerService is VPS-only; all reads/writes go through /api/customers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: null },
}));

import { customerService } from "@/services/customerService";

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

describe("customerService — VPS API client", () => {
  it("list (no search) → GET /api/customers with paging params", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockVpsOk({ rows: [{ id: "c1", name: "Acme" }], total: 1 }),
    );

    const result = await customerService.list("dealer-1", "", "", 1);

    expect(vpsAuthedFetchMock).toHaveBeenCalledTimes(1);
    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("/api/customers?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("page=0");
    expect(url).toContain("pageSize=25");
    expect(url).toContain("orderBy=name");
    expect(url).not.toContain("search=");
    expect(result).toEqual({ data: [{ id: "c1", name: "Acme" }], total: 1 });
  });

  it("typeFilter → forwarded as f.type query param", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ rows: [], total: 0 }));

    await customerService.list("dealer-1", "", "retailer", 1);

    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("f.type=retailer");
  });

  it("search list → includes search query param", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockVpsOk({ rows: [{ id: "c2", name: "Beta" }], total: 1 }),
    );

    const result = await customerService.list("dealer-1", "bet", "", 2);

    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("search=bet");
    expect(url).toContain("page=1"); // UI page 2 → 0-indexed page 1
    expect(result).toEqual({ data: [{ id: "c2", name: "Beta" }], total: 1 });
  });

  it("propagates API errors from list", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("network down", 503));

    await expect(customerService.list("dealer-1", "", "", 1)).rejects.toThrow(
      "network down",
    );
  });
});
