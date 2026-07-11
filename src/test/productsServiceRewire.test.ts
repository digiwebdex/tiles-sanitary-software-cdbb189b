/**
 * Phase 3D — productService rewire integration test.
 *
 * Mirrors customersServiceRewire.test.ts. Verifies:
 *   1. productService.list() (no search) routes through dataClient
 *      (so shadow mode actually fires when configured).
 *   2. productService.list() (with search) bypasses the adapter and
 *      uses the legacy Supabase OR-ilike(sku|name|barcode) path.
 *   3. productService.list() preserves the legacy `{ data, total }`
 *      response shape so no UI consumer breaks.
 *   4. Adapter list errors propagate (no silent swallow on primary).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { adapterListMock, adapterGetByIdMock } = vi.hoisted(() => ({
  adapterListMock: vi.fn(),
  adapterGetByIdMock: vi.fn(),
}));

vi.mock("@/lib/data/dataClient", () => ({
  dataClient: () => ({
    list: adapterListMock,
    getById: adapterGetByIdMock,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/lib/validators", () => ({
  validateInput: vi.fn(),
  createProductServiceSchema: {},
  updateProductServiceSchema: {},
}));

const {
  supabaseRangeMock,
  supabaseOrderMock,
  supabaseOrMock,
  supabaseEqMock,
  supabaseFromMock,
  supabaseGetUserMock,
} = vi.hoisted(() => {
  const supabaseRangeMock = vi.fn();
  const supabaseOrderMock = vi.fn(() => ({ range: supabaseRangeMock }));
  const supabaseOrMock = vi.fn(() => ({ order: supabaseOrderMock }));
  const supabaseEqMock = vi.fn(() => ({ or: supabaseOrMock }));
  const supabaseSelectMock = vi.fn(() => ({ eq: supabaseEqMock }));
  const supabaseFromMock = vi.fn(() => ({ select: supabaseSelectMock }));
  const supabaseGetUserMock = vi.fn(async () => ({ data: { user: null } }));
  return {
    supabaseRangeMock,
    supabaseOrderMock,
    supabaseOrMock,
    supabaseEqMock,
    supabaseFromMock,
    supabaseGetUserMock,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: supabaseFromMock,
    auth: { getUser: supabaseGetUserMock },
  },
}));

import { productService } from "@/services/productService";

beforeEach(() => {
  adapterListMock.mockReset();
  adapterGetByIdMock.mockReset();
  supabaseRangeMock.mockReset();
  supabaseOrMock.mockClear();
  supabaseEqMock.mockClear();
  supabaseOrderMock.mockClear();
  supabaseFromMock.mockClear();
});

describe("Phase 3D — productService routes reads through dataClient", () => {
  it("empty-search list → uses dataClient adapter (shadow-eligible path)", async () => {
    adapterListMock.mockResolvedValueOnce({
      rows: [{ id: "p1", name: "Tile A", sku: "T-001" }],
      total: 1,
    });

    const result = await productService.list("dealer-1", "", 1);

    expect(adapterListMock).toHaveBeenCalledTimes(1);
    expect(adapterListMock).toHaveBeenCalledWith({
      dealerId: "dealer-1",
      page: 0, // 1-indexed UI → 0-indexed adapter
      pageSize: 25,
      orderBy: { column: "created_at", direction: "desc" },
    });

    // Legacy response shape preserved
    expect(result).toEqual({
      data: [{ id: "p1", name: "Tile A", sku: "T-001" }],
      total: 1,
    });

    // Supabase direct path was NOT used
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("undefined search → still uses adapter (defaults to empty string)", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list("dealer-1");
    expect(adapterListMock).toHaveBeenCalledTimes(1);
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("search list → routes through adapter with `search` param (cutover behavior)", async () => {
    adapterListMock.mockResolvedValueOnce({
      rows: [{ id: "p2", name: "Beta", sku: "B-001" }],
      total: 1,
    });

    const result = await productService.list("dealer-1", "bet", 2);

    expect(adapterListMock).toHaveBeenCalledTimes(1);
    expect(adapterListMock).toHaveBeenCalledWith({
      dealerId: "dealer-1",
      page: 1, // 1-indexed UI page 2 → 0-indexed adapter page 1
      pageSize: 25,
      search: "bet",
      orderBy: { column: "created_at", direction: "desc" },
    });
    // Direct Supabase path no longer used for search after VPS cutover.
    expect(supabaseFromMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: [{ id: "p2", name: "Beta", sku: "B-001" }],
      total: 1,
    });
  });

  it("propagates adapter errors from list (no silent swallow on primary)", async () => {
    adapterListMock.mockRejectedValueOnce(new Error("network down"));
    await expect(productService.list("dealer-1", "", 1)).rejects.toThrow(
      "network down",
    );
  });

  // ── V2 Sprint 2.1 — Product List filters ──
  it("filters omitted (3-arg call, the pre-2.1 shape) → adapter receives no `filters` key at all", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list("dealer-1", "", 1);
    const callArg = adapterListMock.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(callArg, "filters")).toBe(false);
  });

  it("filters provided → passed through to the adapter untouched", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list("dealer-1", "", 1, { brand: "RAK", active: true });
    expect(adapterListMock).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { brand: "RAK", active: true } }),
    );
  });

  it("empty filters object → treated the same as omitted (no `filters` key sent)", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list("dealer-1", "", 1, {});
    const callArg = adapterListMock.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(callArg, "filters")).toBe(false);
  });

  // ── V2 Sprint 4E — POS modernization: orderBy/pageSize overrides ──
  it("orderBy/pageSize omitted → adapter still receives the pre-4E defaults (created_at desc, 25)", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list("dealer-1", "", 1, { active: true });
    expect(adapterListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { column: "created_at", direction: "desc" },
        pageSize: 25,
      }),
    );
  });

  it("orderBy/pageSize provided → passed through to the adapter untouched (POS name-ordered lookup)", async () => {
    adapterListMock.mockResolvedValueOnce({ rows: [], total: 0 });
    await productService.list(
      "dealer-1", "tile", 1, { active: true },
      { column: "name", direction: "asc" }, 20,
    );
    expect(adapterListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { column: "name", direction: "asc" },
        pageSize: 20,
      }),
    );
  });
});
