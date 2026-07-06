/**
 * reservationService — V2 Sprint 3C additions (kind/priority/location tags,
 * editReservation, kind filter on listReservations). Mirrors the
 * vpsAuthedFetch-mock convention used by godownService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { vpsAuthedFetchMock } = vi.hoisted(() => ({
  vpsAuthedFetchMock: vi.fn(),
}));

vi.mock("@/lib/vpsAuthClient", () => ({
  vpsAuthedFetch: (...args: unknown[]) => vpsAuthedFetchMock(...args),
}));

import { createReservation, editReservation, listReservations } from "@/services/reservationService";

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function mockErr(error: string, status = 500) {
  return { ok: false, status, json: async () => ({ error }) };
}

describe("reservationService.createReservation (V2 Sprint 3C)", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("defaults kind to 'reservation' and priority to 0 when omitted", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await createReservation({
      dealer_id: "d1", product_id: "p1", customer_id: "c1", reserved_qty: 5, unit_type: "piece",
    });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/reservations");
    const body = JSON.parse(opts.body);
    expect(body.kind).toBe("reservation");
    expect(body.priority).toBe(0);
    expect(body.warehouse_id).toBeNull();
  });

  it("passes through kind='allocation', priority, and location tags", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r1" }));
    await createReservation({
      dealer_id: "d1", product_id: "p1", customer_id: "c1", reserved_qty: 5, unit_type: "piece",
      kind: "allocation", priority: 50, warehouse_id: "w1", godown_id: "g1", rack_id: "rk1",
    });
    const [, opts] = vpsAuthedFetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.kind).toBe("allocation");
    expect(body.priority).toBe(50);
    expect(body.warehouse_id).toBe("w1");
    expect(body.godown_id).toBe("g1");
    expect(body.rack_id).toBe("rk1");
  });

  it("throws a readable error when the API call fails", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockErr("Insufficient free batch stock"));
    await expect(
      createReservation({ dealer_id: "d1", product_id: "p1", customer_id: "c1", reserved_qty: 5, unit_type: "piece" }),
    ).rejects.toThrow("Insufficient free batch stock");
  });
});

describe("reservationService.editReservation (V2 Sprint 3C \"Edit Reservation\")", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("PATCHes /api/reservations/:id with the dealer scoped in the query string", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ id: "r2" }));
    const newId = await editReservation("r1", "d1", { reserved_qty: 10, priority: 20 });
    const [url, opts] = vpsAuthedFetchMock.mock.calls[0];
    expect(url).toBe("/api/reservations/r1?dealerId=d1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ reserved_qty: 10, priority: 20 });
    expect(newId).toBe("r2");
  });
});

describe("reservationService.listReservations kind filter (V2 Sprint 3C)", () => {
  beforeEach(() => {
    vpsAuthedFetchMock.mockReset();
  });

  it("omits the kind param by default", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [] }));
    await listReservations("d1");
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("kind=");
  });

  it("includes kind=allocation when filtering to allocations", async () => {
    vpsAuthedFetchMock.mockResolvedValueOnce(mockOk({ rows: [] }));
    await listReservations("d1", { kind: "allocation" });
    const url = vpsAuthedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("kind=allocation");
  });
});
