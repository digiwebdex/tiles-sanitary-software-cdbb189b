/**
 * vatReportService — V2 Sprint 4C. Thin client over the existing,
 * unmodified /api/reports/vat/* endpoints (Phase 5 P5-04) — no VAT
 * calculation logic lives here, purely request-shape tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { vatReportService } from "@/services/vatReportService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("vatReportService.getSalesRegister", () => {
  it("GETs /api/reports/vat/sales-register with dealerId + period", async () => {
    const body = { rows: [], totals: { taxable: 0, vat: 0, sd: 0, total: 0 }, period: { from: "2026-01-01", to: "2026-01-31" }, form: "mushak-6.3" };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(body));
    const result = await vatReportService.getSalesRegister("dealer-1", "2026-01-01", "2026-01-31");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/reports/vat/sales-register?");
    expect(url).toContain("dealerId=dealer-1");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-01-31");
    expect(result.form).toBe("mushak-6.3");
  });

  it("propagates a role-guard error (dealer_admin only)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("VAT reports require dealer_admin role", 403));
    await expect(vatReportService.getSalesRegister("dealer-1", "2026-01-01", "2026-01-31")).rejects.toThrow(
      "VAT reports require dealer_admin role",
    );
  });
});

describe("vatReportService.getPurchaseRegister", () => {
  it("GETs /api/reports/vat/purchase-register with dealerId + period", async () => {
    const body = { rows: [], totals: { taxable: 0, vat: 0, sd: 0, total: 0 }, period: { from: "2026-01-01", to: "2026-01-31" }, form: "mushak-6.1" };
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk(body));
    const result = await vatReportService.getPurchaseRegister("dealer-1", "2026-01-01", "2026-01-31");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/reports/vat/purchase-register?");
    expect(result.form).toBe("mushak-6.1");
  });
});
