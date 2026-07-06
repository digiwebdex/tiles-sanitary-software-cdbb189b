/**
 * salesOrderService — V2 Sprint 4B. Mirrors the vpsAuthedFetch-mock
 * convention used by collectionsService.test.ts / customerService.sprint4a.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { salesOrderService } from "@/services/salesOrderService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }), text: async () => JSON.stringify({ error }) };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("salesOrderService.list", () => {
  it("GETs /api/sales-orders with dealerId and pagination", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: [{ id: "so1" }], total: 1 }));
    const result = await salesOrderService.list("dealer-1", { search: "SO-1", status: "confirmed", page: 2 });
    const [url] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toContain("/api/sales-orders?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("search=SO-1");
    expect(url).toContain("status=confirmed");
    expect(url).toContain("page=2");
    expect(result).toEqual({ data: [{ id: "so1" }], total: 1 });
  });
});

describe("salesOrderService.createDraft / updateDraft", () => {
  it("POSTs to /api/sales-orders with the dealerId merged into the body", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: { id: "so1", so_number: "SO-DRAFT-1" } }));
    await salesOrderService.createDraft("dealer-1", { items: [] } as any);
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).dealerId).toBe("dealer-1");
  });

  it("PUTs to /api/sales-orders/:id for updateDraft", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true }));
    await salesOrderService.updateDraft("so1", "dealer-1", { items: [] } as any);
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders/so1");
    expect(opts.method).toBe("PUT");
  });
});

describe("salesOrderService.confirm / cancel", () => {
  it("POSTs to /:id/confirm and returns data + warnings", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: { id: "so1", status: "confirmed" }, warnings: [] }));
    const r = await salesOrderService.confirm("so1", "dealer-1");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders/so1/confirm?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(r.data.status).toBe("confirmed");
  });

  it("POSTs to /:id/cancel with the cancel_reason in the body", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true }));
    await salesOrderService.cancel("so1", "dealer-1", "Customer changed mind");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders/so1/cancel?dealerId=dealer-1");
    expect(JSON.parse(opts.body)).toEqual({ cancel_reason: "Customer changed mind" });
  });

  it("propagates API errors", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Only draft sales orders can be confirmed.", 409));
    await expect(salesOrderService.confirm("so1", "dealer-1")).rejects.toThrow("Only draft sales orders can be confirmed.");
  });
});

describe("salesOrderService.updateItemQuantity", () => {
  it("PATCHes /:id/items/:itemId with the new quantity", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ ok: true, reservation_id: "r1", reserved_qty: 5, warning: null }));
    const r = await salesOrderService.updateItemQuantity("so1", "item1", "dealer-1", 5);
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders/so1/items/item1?dealerId=dealer-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ quantity: 5 });
    expect(r.reserved_qty).toBe(5);
  });
});

describe("salesOrderService.updateDeliveryPlanning", () => {
  it("PATCHes /:id/delivery-planning with only the provided fields", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: { id: "so1", delivery_readiness: "ready" } }));
    await salesOrderService.updateDeliveryPlanning("so1", "dealer-1", { delivery_readiness: "ready" });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ delivery_readiness: "ready" });
  });
});

describe("salesOrderService.createFromQuotation", () => {
  it("POSTs to /from-quotation/:quotationId", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ data: { id: "so1", quotation_id: "q1" } }));
    const so = await salesOrderService.createFromQuotation("q1", "dealer-1");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/sales-orders/from-quotation/q1?dealerId=dealer-1");
    expect(opts.method).toBe("POST");
    expect(so.quotation_id).toBe("q1");
  });
});
