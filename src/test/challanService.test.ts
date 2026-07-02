/**
 * challanService — VPS API client tests (Phase 3U-17 cutover).
 *
 * Business rules (stock reserve, status transitions) live in the backend;
 * the client proxies to /api/challans and enforces dealer scope locally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAssertDealerId = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/tenancy", () => ({
  assertDealerId: (...args: unknown[]) => mockAssertDealerId(...args),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimits: { api: vi.fn() },
}));

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: null },
}));

import { challanService } from "@/services/challanService";

function mockVpsOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockVpsErr(error: string, status = 400) {
  return {
    ok: false,
    status,
    json: async () => ({ error }),
  };
}

describe("challanService — VPS API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertDealerId.mockResolvedValue(undefined);
    vpsAuthedFetchMock.mockReset();
  });

  describe("dealer scope validation", () => {
    it("create calls assertDealerId before POST", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk({ id: "ch-1", challan_no: "CH-00001" }),
      );

      await challanService.create({
        dealer_id: "dealer-1",
        sale_id: "sale-1",
        challan_date: "2026-01-01",
      });

      expect(mockAssertDealerId).toHaveBeenCalledWith("dealer-1");
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/challans",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("create rejects mismatched dealer_id", async () => {
      mockAssertDealerId.mockRejectedValueOnce(
        new Error(
          "Access denied: dealer_id mismatch. You cannot operate on another dealer's data.",
        ),
      );

      await expect(
        challanService.create({
          dealer_id: "wrong-dealer",
          sale_id: "sale-1",
          challan_date: "2026-01-01",
        }),
      ).rejects.toThrow("Access denied: dealer_id mismatch");
      expect(vpsAuthedFetchMock).not.toHaveBeenCalled();
    });

    it("markDelivered calls assertDealerId and POST /deliver", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.markDelivered("ch-1", "dealer-1");

      expect(mockAssertDealerId).toHaveBeenCalledWith("dealer-1");
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/challans/ch-1/deliver",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("convertToInvoice calls assertDealerId and POST convert endpoint", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.convertToInvoice("s1", "dealer-1");

      expect(mockAssertDealerId).toHaveBeenCalledWith("dealer-1");
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/challans/convert-invoice/s1",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("cancelChallan calls assertDealerId and POST /cancel", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.cancelChallan("ch-1", "dealer-1");

      expect(mockAssertDealerId).toHaveBeenCalledWith("dealer-1");
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/challans/ch-1/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("API error propagation", () => {
    it("create surfaces backend validation errors", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsErr("Sale is not in challan mode"),
      );

      await expect(
        challanService.create({
          dealer_id: "dealer-1",
          sale_id: "s1",
          challan_date: "2026-01-01",
        }),
      ).rejects.toThrow("Sale is not in challan mode");
    });

    it("markDelivered surfaces not-found errors", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Challan not found", 404));

      await expect(challanService.markDelivered("bad-id", "dealer-1")).rejects.toThrow(
        "Challan not found",
      );
    });

    it("convertToInvoice surfaces status errors", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsErr("Sale must be delivered or challan_created"),
      );

      await expect(challanService.convertToInvoice("s1", "dealer-1")).rejects.toThrow(
        "Sale must be delivered or challan_created",
      );
    });

    it("cancelChallan surfaces cancellation errors", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsErr("Cannot cancel this challan"),
      );

      await expect(challanService.cancelChallan("ch-1", "dealer-1")).rejects.toThrow(
        "Cannot cancel this challan",
      );
    });
  });

  describe("list", () => {
    it("GET /api/challans with dealerId", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk([
          { id: "ch-1", challan_no: "CH-00001", status: "pending" },
          { id: "ch-2", challan_no: "CH-00002", status: "delivered" },
        ]),
      );

      const result = await challanService.list("dealer-1");

      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/challans?dealerId=dealer-1"),
        expect.anything(),
      );
      expect(result).toHaveLength(2);
    });
  });
});
