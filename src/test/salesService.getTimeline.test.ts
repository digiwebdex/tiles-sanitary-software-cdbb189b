/**
 * salesService.getTimeline — V2 Sprint 4C addition (Invoice Timeline /
 * Audit Trail). salesService.ts has other, pre-existing coverage elsewhere;
 * this file covers only the new method.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { salesService } from "@/services/salesService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("salesService.getTimeline (V2 Sprint 4C)", () => {
  it("GETs /api/sales/:id/timeline and returns the event list", async () => {
    const events = [{ at: "2026-01-01T10:00:00Z", type: "sale_create", label: "Invoice created" }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: events }));
    const result = await salesService.getTimeline("sale1", "dealer-1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/sales/sale1/timeline?dealerId=dealer-1");
    expect(result).toEqual(events);
  });

  it("omits the dealerId query param when not provided", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: [] }));
    await salesService.getTimeline("sale1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/sales/sale1/timeline");
  });

  it("returns an empty array when the response has no data field", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    const result = await salesService.getTimeline("sale1", "dealer-1");
    expect(result).toEqual([]);
  });
});
