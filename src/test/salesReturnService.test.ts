/**
 * salesReturnService — V2 Sprint 4D additions (refund_mode/refund_paid_account_id
 * pass-through on create, plus getCreditNoteBalance/applyCreditNote/linkExchange).
 * This service previously had zero test coverage; this file covers the new surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenancy", () => ({
  assertDealerId: vi.fn().mockResolvedValue(undefined),
}));

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { salesReturnService } from "@/services/salesReturnService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

const DEALER_ID = "11111111-1111-1111-1111-111111111111";
const SALE_ID = "22222222-2222-2222-2222-222222222222";
const PRODUCT_ID = "33333333-3333-3333-3333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-4444-444444444444";

describe("salesReturnService.create — refund_mode / refund_paid_account_id (V2 Sprint 4D)", () => {
  it("forwards refund_mode='credit' with no bank account", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await salesReturnService.create({
      dealer_id: DEALER_ID, sale_id: SALE_ID, product_id: PRODUCT_ID, qty: 1,
      reason: "", is_broken: false, refund_amount: 100, refund_mode: "credit", return_date: "2026-01-01",
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.refund_mode).toBe("credit");
    expect(body.refund_paid_account_id).toBeNull();
  });

  it("forwards refund_paid_account_id for a bank refund", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await salesReturnService.create({
      dealer_id: DEALER_ID, sale_id: SALE_ID, product_id: PRODUCT_ID, qty: 1,
      reason: "", is_broken: false, refund_amount: 100, refund_mode: "bank", refund_paid_account_id: ACCOUNT_ID, return_date: "2026-01-01",
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.refund_mode).toBe("bank");
    expect(body.refund_paid_account_id).toBe(ACCOUNT_ID);
  });
});

describe("salesReturnService — Credit Note (V2 Sprint 4D)", () => {
  it("getCreditNoteBalance GETs /api/returns/credit-note-balance", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ balance: 350 }));
    const balance = await salesReturnService.getCreditNoteBalance("dealer-1", "c1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("customerId=c1");
    expect(balance).toBe(350);
  });

  it("applyCreditNote POSTs to /api/returns/credit-note/apply", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true, newDue: 0 }));
    await salesReturnService.applyCreditNote("dealer-1", { customer_id: "c1", sale_id: "s1", amount: 200 });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/returns/credit-note/apply?dealerId=dealer-1");
    expect(JSON.parse(opts.body)).toEqual({ customer_id: "c1", sale_id: "s1", amount: 200 });
  });

  it("propagates an error when applying more than the unapplied balance", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Amount exceeds unapplied credit note balance (max 50.00)", 400));
    await expect(
      salesReturnService.applyCreditNote("dealer-1", { customer_id: "c1", sale_id: "s1", amount: 500 }),
    ).rejects.toThrow("Amount exceeds unapplied credit note balance");
  });
});

describe("salesReturnService.linkExchange (V2 Sprint 4D)", () => {
  it("POSTs to /api/returns/sales/:id/link-exchange with the new saleId", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true, applied: 150 }));
    const result = await salesReturnService.linkExchange("dealer-1", "return-1", "sale-2");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/returns/sales/return-1/link-exchange?dealerId=dealer-1");
    expect(JSON.parse(opts.body)).toEqual({ saleId: "sale-2" });
    expect(result.applied).toBe(150);
  });
});
