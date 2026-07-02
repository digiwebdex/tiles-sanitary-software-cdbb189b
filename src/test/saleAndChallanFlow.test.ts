/**
 * Sale + Challan workflow — VPS API client tests.
 *
 * Atomic stock/ledger/status transitions run server-side in POST /api/sales
 * and /api/challans/*. These tests verify the client calls the correct
 * endpoints with the expected payloads and propagates API errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAssertDealerId = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/tenancy", () => ({
  assertDealerId: (...args: unknown[]) => mockAssertDealerId(...args),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimits: { api: vi.fn() },
}));

vi.mock("@/services/notificationService", () => ({
  notificationService: { notifySaleCreated: vi.fn() },
}));

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: null },
}));

import { salesService } from "@/services/salesService";
import { challanService } from "@/services/challanService";

const DEALER_ID = "dealer-001";
const SALE_ID = "sale-001";
const CHALLAN_ID = "challan-001";
const PRODUCT_ID = "prod-001";

const baseSaleInput = {
  dealer_id: DEALER_ID,
  customer_name: "Test Customer",
  sale_date: "2026-02-22",
  discount: 0,
  discount_reference: "",
  client_reference: "",
  fitter_reference: "",
  paid_amount: 500,
  payment_mode: "cash",
  notes: "",
  created_by: "user-1",
  items: [{ product_id: PRODUCT_ID, quantity: 10, sale_rate: 50 }],
};

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

describe("Sale + Challan workflow — VPS API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertDealerId.mockResolvedValue(undefined);
    vpsAuthedFetchMock.mockReset();
  });

  describe("salesService.create", () => {
    it("POST /api/sales for direct invoice with full payload", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk({
          id: SALE_ID,
          customer_id: "cust-001",
          sale_type: "direct_invoice",
          total_amount: 1750,
        }),
      );

      const result = await salesService.create({
        ...baseSaleInput,
        sale_type: "direct_invoice",
      });

      expect(mockAssertDealerId).toHaveBeenCalledWith(DEALER_ID);
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/sales",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"sale_type":"direct_invoice"'),
        }),
      );
      expect(result!.id).toBe(SALE_ID);
    });

    it("POST /api/sales for challan_mode", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk({
          id: SALE_ID,
          customer_id: "cust-001",
          sale_type: "challan_mode",
          sale_status: "draft",
        }),
      );

      await salesService.create({
        ...baseSaleInput,
        sale_type: "challan_mode",
      });

      const [, init] = vpsAuthedFetchMock.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.sale_type).toBe("challan_mode");
    });

    it("propagates API errors", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Insufficient stock"));

      await expect(
        salesService.create({ ...baseSaleInput, sale_type: "direct_invoice" }),
      ).rejects.toThrow("Insufficient stock");
    });
  });

  describe("challanService workflow", () => {
    it("create → POST /api/challans", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk({ id: CHALLAN_ID, challan_no: "CH-00001" }),
      );

      const result = await challanService.create({
        dealer_id: DEALER_ID,
        sale_id: SALE_ID,
        challan_date: "2026-02-22",
        driver_name: "John",
      });

      expect(result!.id).toBe(CHALLAN_ID);
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        "/api/challans",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("markDelivered → POST /api/challans/:id/deliver", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.markDelivered(CHALLAN_ID, DEALER_ID);

      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        `/api/challans/${CHALLAN_ID}/deliver`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("convertToInvoice → POST /api/challans/convert-invoice/:saleId", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.convertToInvoice(SALE_ID, DEALER_ID);

      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        `/api/challans/convert-invoice/${SALE_ID}`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("cancelChallan → POST /api/challans/:id/cancel", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsOk({ ok: true }));

      await challanService.cancelChallan(CHALLAN_ID, DEALER_ID);

      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        `/api/challans/${CHALLAN_ID}/cancel`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("list → GET /api/challans?dealerId=...", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsOk([
          { id: "ch-1", challan_no: "CH-00001", status: "pending" },
          { id: "ch-2", challan_no: "CH-00002", status: "delivered" },
        ]),
      );

      const result = await challanService.list(DEALER_ID);

      expect(result).toHaveLength(2);
      expect(vpsAuthedFetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/challans?dealerId=${DEALER_ID}`),
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("challan.create throws on sale not found", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Sale not found", 404));

      await expect(
        challanService.create({
          dealer_id: DEALER_ID,
          sale_id: "bad-id",
          challan_date: "2026-02-22",
        }),
      ).rejects.toThrow("Sale not found");
    });

    it("challan.markDelivered throws on challan not found", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Challan not found", 404));

      await expect(challanService.markDelivered("bad-id", DEALER_ID)).rejects.toThrow(
        "Challan not found",
      );
    });

    it("challan.convertToInvoice throws on sale not found", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Sale not found", 404));

      await expect(challanService.convertToInvoice("bad-id", DEALER_ID)).rejects.toThrow(
        "Sale not found",
      );
    });

    it("challan.cancelChallan throws on challan not found", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Challan not found", 404));

      await expect(challanService.cancelChallan("bad-id", DEALER_ID)).rejects.toThrow(
        "Challan not found",
      );
    });

    it("challan.create rejects non-challan_mode sale", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(
        mockVpsErr("Sale is not in challan mode"),
      );

      await expect(
        challanService.create({
          dealer_id: DEALER_ID,
          sale_id: SALE_ID,
          challan_date: "2026-02-22",
        }),
      ).rejects.toThrow("Sale is not in challan mode");
    });

    it("challan.create rejects already-created challan", async () => {
      vpsAuthedFetchMock.mockResolvedValueOnce(mockVpsErr("Challan already created"));

      await expect(
        challanService.create({
          dealer_id: DEALER_ID,
          sale_id: SALE_ID,
          challan_date: "2026-02-22",
        }),
      ).rejects.toThrow("Challan already created");
    });
  });
});
