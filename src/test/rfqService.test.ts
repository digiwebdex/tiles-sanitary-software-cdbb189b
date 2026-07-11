/**
 * rfqService — V2 Sprint 5A. First test coverage for this new service.
 * Mirrors the vpsAuthedFetch-mock convention used throughout this suite.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { rfqService } from "@/services/rfqService";

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

describe("rfqService.create", () => {
  it("POSTs items + optional purchase_request_id to /api/rfqs", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "rfq1" } }));
    await rfqService.create(DEALER_ID, {
      purchase_request_id: "pr1",
      notes: "Compare 3 suppliers",
      items: [{ product_id: "p1", product_name_snapshot: "Tile A", qty: 100 }],
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/rfqs?dealerId=${DEALER_ID}`);
    const body = JSON.parse(opts.body);
    expect(body.purchase_request_id).toBe("pr1");
    expect(body.items[0].qty).toBe(100);
  });

  it("omits purchase_request_id (null) when not linked to a PR", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "rfq1" } }));
    await rfqService.create(DEALER_ID, { notes: "", items: [{ product_name_snapshot: "Tile B", qty: 5 }] });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.purchase_request_id).toBeNull();
  });
});

describe("rfqService — supplier invitation and send", () => {
  it("inviteSuppliers POSTs supplier_ids", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [] }));
    await rfqService.inviteSuppliers("rfq1", DEALER_ID, ["s1", "s2"]);
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/rfqs/rfq1/suppliers?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body)).toEqual({ supplier_ids: ["s1", "s2"] });
  });

  it("send POSTs to /:id/send and propagates a 409 when no supplier is invited", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Invite at least one supplier before sending the RFQ.", 409));
    await expect(rfqService.send("rfq1", DEALER_ID)).rejects.toThrow("Invite at least one supplier");
  });
});

describe("rfqService — recording responses and comparison", () => {
  it("recordResponse POSTs the quote payload", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "resp1" } }));
    await rfqService.recordResponse("rfq1", DEALER_ID, {
      supplier_id: "s1", rfq_item_id: "item1", quoted_rate: 250, quoted_lead_time_days: 7,
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/rfqs/rfq1/responses?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body).quoted_rate).toBe(250);
  });

  it("getComparison GETs /:id/comparison", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rfq: {}, items: [], suppliers: [] }));
    await rfqService.getComparison("rfq1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/rfqs/rfq1/comparison?dealerId=${DEALER_ID}`);
  });
});

describe("rfqService.approve", () => {
  it("POSTs the per-line supplier selections", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "rfq1", status: "approved" } }));
    await rfqService.approve("rfq1", DEALER_ID, [{ rfq_item_id: "item1", supplier_id: "s1" }]);
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/rfqs/rfq1/approve?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body).selections).toEqual([{ rfq_item_id: "item1", supplier_id: "s1" }]);
  });

  it("propagates an error when a selected supplier has no recorded quote", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Selected supplier has no recorded quote for this line.", 409));
    await expect(
      rfqService.approve("rfq1", DEALER_ID, [{ rfq_item_id: "item1", supplier_id: "s1" }]),
    ).rejects.toThrow("no recorded quote");
  });
});
