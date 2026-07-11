/**
 * V2 Sprint 2 / 2.1 — Product Master pure helpers.
 *
 * Small, dependency-free functions extracted out of routes/products.ts so
 * the arithmetic/shaping logic is unit-testable without mocking Knex.
 */

/**
 * Outstanding (unfulfilled) backorder quantity for a product, using the same
 * formula as GET /api/backorders/shortage-demand: backorder_qty - allocated_qty,
 * summed across sale_items, clamped at 0 (a product can never have "negative"
 * outstanding backorder — over-allocation, if it ever happened, should read
 * as fully resolved, not as a negative shortage).
 */
export function computeBackorderOutstanding(
  totalBackorderQty: number,
  totalAllocatedQty: number,
): number {
  const outstanding = (totalBackorderQty || 0) - (totalAllocatedQty || 0);
  return Math.max(0, outstanding);
}

export interface PriceTierRow {
  tier_id: string;
  tier_name: string;
  is_default: boolean | null;
  rate: number | string | null | undefined;
}

export interface PriceLevel {
  tierId: string;
  tierName: string;
  isDefault: boolean;
  /** null = no rate set for this product on this tier (falls back to defaultSaleRate). */
  rate: number | null;
}

/**
 * Shape the price_tiers ⋈ price_tier_items join for the Product Master
 * "Price Levels" panel. Pure function — no DB access — so behaviour (esp.
 * null-vs-zero handling) is covered by unit tests independent of the query.
 */
export function shapePriceLevels(
  // pg's numeric columns are returned as strings by the driver, so
  // default_sale_rate may arrive as "1200.00" rather than 1200 — accept both.
  defaultSaleRate: number | string,
  tierRows: PriceTierRow[],
): { defaultSaleRate: number; tiers: PriceLevel[] } {
  return {
    defaultSaleRate: Number(defaultSaleRate ?? 0),
    tiers: tierRows.map((t) => ({
      tierId: t.tier_id,
      tierName: t.tier_name,
      isDefault: !!t.is_default,
      rate: t.rate === null || t.rate === undefined ? null : Number(t.rate),
    })),
  };
}

// ── V2 Sprint 2.1 — Product List filters ────────────────────────────────────

/**
 * The product columns GET /api/products/facets returns distinct values for,
 * to populate the Product List's filter dropdowns. Kept as one list so the
 * route, the shaping function, and any future addition stay in sync.
 */
export const FACET_COLUMNS = [
  'brand',
  'series',
  'collection_name',
  'tile_type',
  'finish',
  'size',
  'country_of_origin',
] as const;
export type FacetColumn = (typeof FACET_COLUMNS)[number];

export type FacetsResult = Record<FacetColumn, string[]>;

/**
 * Shape N raw `SELECT DISTINCT <col> FROM products WHERE dealer_id = ? AND
 * <col> IS NOT NULL` result sets (one per FACET_COLUMNS entry, same order)
 * into a { column: string[] } map: trimmed, de-duplicated (case-insensitive,
 * first-seen casing wins), blank-string values dropped, alphabetically
 * sorted. Pure function — no DB access — so the not-obvious edge cases
 * (blank strings, case collisions, null vs "") are covered by unit tests
 * independent of the query.
 */
export function shapeFacets(rawByColumn: Record<FacetColumn, Array<Record<string, unknown>>>): FacetsResult {
  const result = {} as FacetsResult;
  for (const col of FACET_COLUMNS) {
    const rows = rawByColumn[col] ?? [];
    const seen = new Map<string, string>(); // lowercase -> first-seen original casing
    for (const row of rows) {
      const raw = row[col];
      if (raw === null || raw === undefined) continue;
      const value = String(raw).trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
    result[col] = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }
  return result;
}
