/**
 * customerService — V2 Sprint 4E additions (statusFilter/pageSize overrides
 * on list(), added for the POS customer dropdown to reproduce the old
 * unbounded active-customer lookup without truncating at the default
 * 25-row page). Mirrors the vpsAuthedFetch-mock convention used by
 * customerService.sprint4a.test.ts.
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

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("customerService.list — statusFilter/pageSize (V2 Sprint 4E)", () => {
  it("statusFilter/pageSize omitted → request is byte-for-byte the pre-4E shape (no f.status, default pageSize)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await customerService.list("dealer-1", "", "", 1);
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("pageSize=25");
    expect(url).not.toContain("f.status");
  });

  it("statusFilter provided → forwarded as f.status", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await customerService.list("dealer-1", "", "", 1, "active");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("f.status=active");
  });

  it("pageSize provided → overrides the default 25 (POS's unbounded-lookup case)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await customerService.list("dealer-1", "", "", 1, "active", 200);
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("pageSize=200");
    expect(url).toContain("f.status=active");
  });
});
