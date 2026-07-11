/**
 * supplierService — V2 Sprint 5A additions (category/supplier_group/
 * credit_limit on list()/create()/update(), plus getLedgerSummary()).
 * Mirrors the vpsAuthedFetch-mock convention used elsewhere in this suite.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { supplierService } from "@/services/supplierService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("supplierService.list — categoryFilter/groupFilter (V2 Sprint 5A)", () => {
  it("filters omitted → request is byte-for-byte the pre-5A shape (no f.category/f.supplier_group)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await supplierService.list("dealer-1", "", 1);
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("f.category");
    expect(url).not.toContain("f.supplier_group");
  });

  it("categoryFilter/groupFilter provided → forwarded as f.category/f.supplier_group", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [], total: 0 }));
    await supplierService.list("dealer-1", "", 1, "Manufacturer", "Preferred");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("f.category=Manufacturer");
    expect(url).toContain("f.supplier_group=Preferred");
  });
});

describe("supplierService — create/update forward category/supplier_group/credit_limit (V2 Sprint 5A)", () => {
  it("create() forwards the new fields", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "s1" } }));
    await supplierService.create("dealer-1", {
      name: "Acme Tiles", contact_person: "", phone: "", email: "", address: "", gstin: "",
      opening_balance: 0, status: "active", category: "Manufacturer", supplier_group: "Preferred", credit_limit: 50000,
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.category).toBe("Manufacturer");
    expect(body.data.supplier_group).toBe("Preferred");
    expect(body.data.credit_limit).toBe(50000);
  });

  it("update() omits the new fields when not supplied (partial update)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await supplierService.update("s1", { name: "Renamed" });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.category).toBeUndefined();
    expect(body.data.supplier_group).toBeUndefined();
    expect(body.data.credit_limit).toBeUndefined();
  });

  it("update() converts an empty category/supplier_group to null", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await supplierService.update("s1", { category: "  ", supplier_group: "" });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.category).toBeNull();
    expect(body.data.supplier_group).toBeNull();
  });
});

describe("supplierService.getLedgerSummary (V2 Sprint 5A)", () => {
  it("GETs /api/suppliers/:id/ledger-summary", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(
      mockOk({
        supplier: { id: "s1", name: "Acme", opening_balance: 0 },
        outstanding: 600, balance: 600, total_purchased: 1000, total_paid: 400, entries: [],
      }),
    );
    const summary = await supplierService.getLedgerSummary("s1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/suppliers/s1/ledger-summary");
    expect(summary.outstanding).toBe(600);
  });
});
