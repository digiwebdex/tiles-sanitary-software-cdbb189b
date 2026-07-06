/**
 * productService — VPS-only.
 * All reads + writes served by the self-hosted API via dataClient.
 * Public function signatures unchanged.
 */
import type { Database } from "@/integrations/supabase/types";
import { validateInput, createProductServiceSchema, updateProductServiceSchema } from "@/lib/validators";
import { dataClient } from "@/lib/data/dataClient";
import { vpsTokenStore, vpsAuthedFetch } from "@/lib/vpsAuthClient";

type Product = Database["public"]["Tables"]["products"]["Row"];
type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

const PAGE_SIZE = 25;

// Memoized per (resource, backend) inside dataClient itself.
const productsAdapter = dataClient<Product>("PRODUCTS");

/**
 * Resolve a dealerId for write/getById calls from the VPS token store.
 * super_admin (no dealer) → return null so callers can fall back.
 */
function resolveCurrentDealerId(): string | null {
  return vpsTokenStore.user?.dealerId ?? null;
}

export const productService = {
  /**
   * `filters` is new in V2 Sprint 2.1 — optional, so every existing call
   * site (Damage, Pricing Tiers, CommandPalette, QuotationForm,
   * AreaCalculatorDialog, ProductList's own prior calls) that only passes
   * (dealerId, search, page) behaves exactly as before: the adapter simply
   * never receives a `filters` key, byte-for-byte the same request as today.
   *
   * `orderBy`/`pageSize` are new in V2 Sprint 4E — both optional, default to
   * the existing `created_at desc` / 25-row behavior, so every existing call
   * site is unaffected.
   */
  async list(
    dealerId: string,
    search?: string,
    page = 1,
    filters?: Record<string, string | number | boolean | null>,
    orderBy: { column: string; direction: "asc" | "desc" } = { column: "created_at", direction: "desc" },
    pageSize = PAGE_SIZE,
  ) {
    const trimmed = search?.trim() ?? "";

    const result = await productsAdapter.list({
      dealerId,
      page: Math.max(0, page - 1),
      pageSize,
      search: trimmed || undefined,
      orderBy,
      ...(filters && Object.keys(filters).length > 0 ? { filters } : {}),
    });
    return { data: result.rows, total: result.total };
  },

  /**
   * V2 Sprint 2.1 — distinct values (brand/series/collection/tile_type/
   * finish/size/country_of_origin) across ALL of the dealer's products, for
   * the Product List's filter dropdowns. GET /api/products/facets.
   */
  async facets(dealerId: string): Promise<Record<string, string[]>> {
    const res = await vpsAuthedFetch(`/api/products/facets?dealerId=${encodeURIComponent(dealerId)}`);
    if (!res.ok) throw new Error("Failed to load product filter options");
    return (await res.json()) as Record<string, string[]>;
  },

  async getById(id: string, dealerIdOverride?: string) {
    const dealerId = dealerIdOverride || (await resolveCurrentDealerId());

    if (!dealerId) {
      throw new Error("Cannot load product: no dealer context found.");
    }

    const row = await productsAdapter.getById(id, dealerId);
    if (!row) throw new Error("Product not found");
    return row;
  },

  async create(product: ProductInsert) {
    validateInput(createProductServiceSchema, product);

    // dealer_id may be passed in by the caller; prefer it, else resolve.
    const dealerId =
      (product.dealer_id as string | undefined) ??
      (await resolveCurrentDealerId());
    if (!dealerId) {
      throw new Error("Cannot create product: no dealer context found.");
    }

    // Strip dealer_id from the payload — adapter sends it separately so the
    // VPS route can verify tenant scope server-side.
    const { dealer_id: _omit, ...rest } = product as Record<string, unknown>;
    // Auto-generate barcode from SKU when missing (mirrors legacy behavior).
    const payload = {
      ...rest,
      barcode: (rest as any).barcode ?? (rest as any).sku,
    };

    return productsAdapter.create(payload as Partial<Product>, dealerId) as Promise<Product>;
  },

  async update(id: string, product: ProductUpdate) {
    validateInput(updateProductServiceSchema, product);

    const dealerId = await resolveCurrentDealerId();
    if (!dealerId) {
      throw new Error("Cannot update product: no dealer context found.");
    }

    // Never let a caller silently retarget the dealer_id of an existing row.
    const { dealer_id: _omit, ...rest } = product as Record<string, unknown>;

    return productsAdapter.update(id, rest as Partial<Product>, dealerId) as Promise<Product>;
  },

  async remove(id: string, dealerId?: string) {
    const resolvedDealerId = dealerId ?? (await resolveCurrentDealerId());
    if (!resolvedDealerId) {
      throw new Error("Cannot delete product: no dealer context found.");
    }

    await productsAdapter.remove(id, resolvedDealerId);
  },

  async isSkuUnique(sku: string, dealerId: string, productId?: string) {
    const result = await productsAdapter.list({
      dealerId,
      page: 0,
      pageSize: 1,
      filters: { sku: sku.trim() },
    });
    const existing = result.rows[0];
    return !existing || existing.id === productId;
  },

  async isBarcodeUnique(barcode: string, dealerId: string, productId?: string) {
    const result = await productsAdapter.list({
      dealerId,
      page: 0,
      pageSize: 1,
      filters: { barcode: barcode.trim() },
    });
    const existing = result.rows[0];
    return !existing || existing.id === productId;
  },

  async toggleActive(id: string, active: boolean) {
    return this.update(id, { active });
  },
};
