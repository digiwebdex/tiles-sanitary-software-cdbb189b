/**
 * customerService — V2 Sprint 4A additions (customer_group,
 * default_discount_type, default_discount_value flow through create/update).
 * Mirrors the vpsAuthedFetch-mock convention used by customersServiceRewire.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
  vpsTokenStore: { user: null },
}));

import { customerService } from "@/services/customerService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  vpsAuthedFetchMock.mockReset();
});

describe("customerService — V2 Sprint 4A fields", () => {
  it("create() forwards customer_group and default_discount_type/value", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ row: { id: "c1" } }));

    await customerService.create("dealer-1", {
      name: "Acme Builders", type: "builder", phone: "", email: "", address: "",
      reference_name: "", opening_balance: 0, status: "active", credit_limit: 0,
      max_overdue_days: 0, price_tier_id: null, tax_id: "",
      customer_group: "VIP", default_discount_type: "percent", default_discount_value: 5,
    });

    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.customer_group).toBe("VIP");
    expect(body.data.default_discount_type).toBe("percent");
    expect(body.data.default_discount_value).toBe(5);
  });

  it("update() omits customer_group when not supplied (partial update)", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await customerService.update("c1", { credit_limit: 1000 });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.customer_group).toBeUndefined();
    expect(body.data.credit_limit).toBe(1000);
  });

  it("update() trims customer_group and converts empty string to null", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({}));
    await customerService.update("c1", { customer_group: "  " });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.data.customer_group).toBeNull();
  });
});
