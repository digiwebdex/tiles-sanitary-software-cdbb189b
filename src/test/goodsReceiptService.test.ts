/**
 * goodsReceiptService — V2 Sprint 5C. First test coverage for this new
 * service. Mirrors the vpsAuthedFetch-mock convention used throughout this
 * suite (e.g. purchaseOrderService.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { goodsReceiptService } from "@/services/goodsReceiptService";

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

describe("goodsReceiptService.create", () => {
  it("POSTs purchase_order_id/receive_date/items to /api/goods-receipts", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "gr1" } }));
    await goodsReceiptService.create(DEALER_ID, {
      purchase_order_id: "po1",
      receive_date: "2026-04-01",
      items: [{ purchase_order_item_id: "poi1", product_id: "p1", received_qty: 10 }],
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/goods-receipts?dealerId=${DEALER_ID}`);
    const body = JSON.parse(opts.body);
    expect(body.purchase_order_id).toBe("po1");
    expect(body.items[0].received_qty).toBe(10);
  });

  it("converts blank/omitted optional item fields to null", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "gr1" } }));
    await goodsReceiptService.create(DEALER_ID, {
      purchase_order_id: "po1",
      receive_date: "2026-04-01",
      items: [{ purchase_order_item_id: "poi1", product_id: "p1", received_qty: 5 }],
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.items[0].batch_no).toBeNull();
    expect(body.items[0].warehouse_id).toBeNull();
  });
});

describe("goodsReceiptService — workflow transitions", () => {
  it("complete POSTs to /:id/complete", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "gr1", status: "completed" } }));
    const row = await goodsReceiptService.complete("gr1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/goods-receipts/gr1/complete?dealerId=${DEALER_ID}`);
    expect(row.status).toBe("completed");
  });

  it("propagates an over-receive error message", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Cannot over-receive: Tile A — ordered 10, already received 5, this receipt would bring it to 12.", 409));
    await expect(goodsReceiptService.complete("gr1", DEALER_ID)).rejects.toThrow("Cannot over-receive");
  });

  it("cancel POSTs to /:id/cancel", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "gr1", status: "cancelled" } }));
    await goodsReceiptService.cancel("gr1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/goods-receipts/gr1/cancel?dealerId=${DEALER_ID}`);
  });
});

describe("goodsReceiptService.getPendingForPurchaseOrder", () => {
  it("GETs the pending-lines lookup for a purchase order", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockOk({ purchase_order: { id: "po1", po_number: "PO-00001", status: "sent", supplier_name: "Acme" }, lines: [], receivable: true }),
    );
    const result = await goodsReceiptService.getPendingForPurchaseOrder("po1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/goods-receipts/purchase-order/po1/pending?dealerId=${DEALER_ID}`);
    expect(result.receivable).toBe(true);
  });
});

describe("goodsReceiptService.list", () => {
  it("forwards search/status/purchaseOrderId as query params", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await goodsReceiptService.list(DEALER_ID, "GRN-001", 2, "draft", "po1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=GRN-001");
    expect(url).toContain("status=draft");
    expect(url).toContain("purchaseOrderId=po1");
    expect(url).toContain("page=1");
  });
});
