/**
 * collectionsService — V2 Sprint 4A additions (getCustomerOutstanding,
 * recordAdjustment). This service previously had zero test coverage; this
 * file covers the two new methods.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { collectionsService } from "@/services/collectionsService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("collectionsService.getCustomerOutstanding (V2 Sprint 4A)", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("calls GET /api/collections/outstanding with both dealerId and customerId", async () => {
    const row = { id: "c1", name: "Acme", outstanding: 500 };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ customers: [row] }));
    const result = await collectionsService.getCustomerOutstanding("dealer-1", "c1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("customerId=c1");
    expect(result).toEqual(row);
  });

  it("returns null when the customer has no outstanding row", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ customers: [] }));
    const result = await collectionsService.getCustomerOutstanding("dealer-1", "c1");
    expect(result).toBeNull();
  });
});

describe("collectionsService.recordAdjustment (V2 Sprint 4A)", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("POSTs to /api/collections/adjustment with the signed amount and reason", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "l1" } }));
    await collectionsService.recordAdjustment("dealer-1", { customer_id: "c1", amount: -200, reason: "Write-off" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/adjustment?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ customer_id: "c1", amount: -200, reason: "Write-off" });
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("A reason is required", 400));
    await expect(
      collectionsService.recordAdjustment("dealer-1", { customer_id: "c1", amount: 100, reason: "" }),
    ).rejects.toThrow("A reason is required");
  });
});

describe("collectionsService — Advance Payment (V2 Sprint 4C)", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("recordAdvance POSTs to /api/collections/advance", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true, id: "l1", amount: 1000 }));
    await collectionsService.recordAdvance("dealer-1", { customer_id: "c1", amount: 1000, payment_mode: "bkash" });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/advance?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ customer_id: "c1", amount: 1000, payment_mode: "bkash" });
  });

  it("getAdvanceBalance GETs /api/collections/advance-balance and returns the balance", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ balance: 750 }));
    const balance = await collectionsService.getAdvanceBalance("dealer-1", "c1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("customerId=c1");
    expect(balance).toBe(750);
  });

  it("applyAdvance POSTs to /api/collections/advance/apply", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true, newDue: 0 }));
    await collectionsService.applyAdvance("dealer-1", { customer_id: "c1", sale_id: "s1", amount: 500 });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/advance/apply?dealerId=dealer-1");
    expect(JSON.parse(opts.body)).toEqual({ customer_id: "c1", sale_id: "s1", amount: 500 });
  });

  it("propagates an error when applying more than the unapplied balance", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Amount exceeds unapplied advance balance (max 100.00)", 400));
    await expect(
      collectionsService.applyAdvance("dealer-1", { customer_id: "c1", sale_id: "s1", amount: 500 }),
    ).rejects.toThrow("Amount exceeds unapplied advance balance");
  });
});
