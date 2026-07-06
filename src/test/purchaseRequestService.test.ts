/**
 * purchaseRequestService — V2 Sprint 5A. First test coverage for this new
 * service. Mirrors the vpsAuthedFetch-mock convention used throughout this
 * suite (e.g. salesReturnService.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { purchaseRequestService } from "@/services/purchaseRequestService";

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

describe("purchaseRequestService.create", () => {
  it("POSTs department/notes/items to /api/purchase-requests", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "pr1" } }));
    await purchaseRequestService.create(DEALER_ID, {
      department: "Sales",
      notes: "Restock",
      items: [{ product_id: "p1", product_name_snapshot: "Tile A", requested_qty: 10 }],
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/purchase-requests?dealerId=${DEALER_ID}`);
    const body = JSON.parse(opts.body);
    expect(body.department).toBe("Sales");
    expect(body.items[0].source).toBe("manual");
  });

  it("defaults source to manual when omitted and converts blank department/notes to null", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "pr1" } }));
    await purchaseRequestService.create(DEALER_ID, {
      department: "  ",
      notes: "",
      items: [{ product_name_snapshot: "Tile B", requested_qty: 5 }],
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.department).toBeNull();
    expect(body.notes).toBeNull();
    expect(body.items[0].source).toBe("manual");
  });
});

describe("purchaseRequestService — status transitions", () => {
  it("submit POSTs to /:id/submit", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "pr1", status: "pending_approval" } }));
    const row = await purchaseRequestService.submit("pr1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/purchase-requests/pr1/submit?dealerId=${DEALER_ID}`);
    expect(row.status).toBe("pending_approval");
  });

  it("approve POSTs to /:id/approve", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "pr1", status: "approved" } }));
    await purchaseRequestService.approve("pr1", DEALER_ID);
    expect(vpsAuthedFetchMock.mock.calls[0][0]).toBe(`/api/purchase-requests/pr1/approve?dealerId=${DEALER_ID}`);
  });

  it("reject POSTs the reason to /:id/reject", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "pr1", status: "rejected" } }));
    await purchaseRequestService.reject("pr1", DEALER_ID, "Budget exceeded");
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe(`/api/purchase-requests/pr1/reject?dealerId=${DEALER_ID}`);
    expect(JSON.parse(opts.body)).toEqual({ reason: "Budget exceeded" });
  });

  it("propagates a 409 error message (e.g. wrong status transition)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Only a pending-approval purchase request can be approved.", 409));
    await expect(purchaseRequestService.approve("pr1", DEALER_ID)).rejects.toThrow("Only a pending-approval");
  });
});

describe("purchaseRequestService.list", () => {
  it("forwards search/status/department as query params", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await purchaseRequestService.list(DEALER_ID, "PR-001", 2, "draft", "Sales");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=PR-001");
    expect(url).toContain("status=draft");
    expect(url).toContain("department=Sales");
    expect(url).toContain("page=1");
  });
});
