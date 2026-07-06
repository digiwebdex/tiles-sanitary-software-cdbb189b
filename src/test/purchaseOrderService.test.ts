/**
 * purchaseOrderService — V2 Sprint 5B. First test coverage for this new
 * service. Mirrors the vpsAuthedFetch-mock convention used throughout this
 * suite (e.g. purchaseRequestService.test.ts, rfqService.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { purchaseOrderService } from "@/services/purchaseOrderService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

const DEALER_ID = "dealer-1";

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("purchaseOrderService.create", () => {
  it("POSTs supplier/discount/items to /api/purchase-orders", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "po1" } }));
    await purchaseOrderService.create(DEALER_ID, {
      supplier_id: "s1",
      order_date: "2026-04-01",
      discount_type: "flat",
      discount_value: 0,
      items: [{ product_name_snapshot: "Tile A", ordered_qty: 10, rate: 500 }],
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/purchase-orders?dealerId=${DEALER_ID}`);
    const body = JSON.parse(opts.body);
    expect(body.supplier_id).toBe("s1");
    expect(body.items[0].ordered_qty).toBe(10);
  });

  it("converts blank notes/terms to null", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "po1" } }));
    await purchaseOrderService.create(DEALER_ID, {
      supplier_id: "s1", order_date: "2026-04-01", discount_type: "flat", discount_value: 0,
      notes: "  ", terms_text: "",
      items: [{ product_name_snapshot: "Tile B", ordered_qty: 1, rate: 1 }],
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.notes).toBeNull();
    expect(body.terms_text).toBeNull();
  });
});

describe("purchaseOrderService — workflow transitions", () => {
  it("submit POSTs to /:id/submit", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "po1", status: "pending_approval" } }));
    const row = await purchaseOrderService.submit("po1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/purchase-orders/po1/submit?dealerId=${DEALER_ID}`);
    expect(row.status).toBe("pending_approval");
  });

  it("reject POSTs the reason to /:id/reject (sends back to draft)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "po1", status: "draft" } }));
    await purchaseOrderService.reject("po1", DEALER_ID, "Price too high");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/purchase-orders/po1/reject?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body)).toEqual({ reason: "Price too high" });
  });

  it("propagates a 409 error message (e.g. wrong status transition)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Only an approved purchase order can be marked as sent.", 409));
    await expect(purchaseOrderService.send("po1", DEALER_ID)).rejects.toThrow("Only an approved");
  });

  it("clone POSTs to /:id/clone", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "po2", cloned_from_id: "po1" } }));
    const row = await purchaseOrderService.clone("po1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/purchase-orders/po1/clone?dealerId=${DEALER_ID}`);
    expect(row.id).toBe("po2");
  });
});

describe("purchaseOrderService.convertFromRfq", () => {
  it("POSTs to /from-rfq/:rfqId and returns the created rows array", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [{ id: "po1" }, { id: "po2" }] }));
    const rows = await purchaseOrderService.convertFromRfq("rfq1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/purchase-orders/from-rfq/rfq1?dealerId=${DEALER_ID}`);
    expect(rows).toHaveLength(2);
  });
});

describe("purchaseOrderService.getLastPurchaseRate", () => {
  it("GETs the supplier+product scoped lookup", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ last_purchase_rate: 480, last_purchase_date: "2026-03-01" }));
    const result = await purchaseOrderService.getLastPurchaseRate(DEALER_ID, "s1", "p1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("supplierId=s1");
    expect(url).toContain("productId=p1");
    expect(result.last_purchase_rate).toBe(480);
  });
});

describe("purchaseOrderService.email", () => {
  it("POSTs to /:id/email with an optional override address", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true }));
    await purchaseOrderService.email("po1", DEALER_ID, "override@example.com");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/purchase-orders/po1/email?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body).to).toBe("override@example.com");
  });
});
