/**
 * availabilityService (frontend) — V2 Sprint 3C. Mirrors the
 * vpsAuthedFetch-mock convention used by godownService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { availabilityService } from "@/services/availabilityService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("availabilityService", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("getAvailability() calls GET /api/availability/:productId", async () => {
    const breakdown = { product_id: "p1", available_pieces: 42 };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(breakdown));
    const result = await availabilityService.getAvailability("p1", "d1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/availability/p1?dealerId=d1");
    expect(result).toEqual(breakdown);
  });

  it("getBatchAvailability() calls GET /api/availability/:productId/batches and unwraps rows", async () => {
    const rows = [{ batch_id: "b1", available_pieces: 5 }];
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows }));
    const result = await availabilityService.getBatchAvailability("p1", "d1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/availability/p1/batches?dealerId=d1");
    expect(result).toEqual(rows);
  });

  it("getBatchAvailability() defaults to [] when rows is missing", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    const result = await availabilityService.getBatchAvailability("p1", "d1");
    expect(result).toEqual([]);
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Product not found", 400));
    await expect(availabilityService.getAvailability("bad", "d1")).rejects.toThrow("Product not found");
  });
});
