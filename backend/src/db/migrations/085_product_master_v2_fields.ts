import type { Knex } from 'knex';

/**
 * V2 Sprint 2 — Product Master tile/sanitary taxonomy fields.
 *
 * Purely ADDITIVE and nullable — no existing column is renamed, retyped, or
 * dropped, and no default changes behaviour for existing rows (all new
 * columns default to NULL, so every existing product is unaffected until a
 * dealer chooses to fill them in).
 *
 * Deliberately NOT added here (reused instead — see docs/SPRINT2_PRODUCT_MASTER.md):
 *   - Sub Category    → reuse `products.product_group` (relabelled "Sub Category" in
 *                       the UI only — no column rename, fully backward compatible)
 *   - Batch / Lot / Shade (per receipt) / Caliber (per receipt)
 *       → already exist on `product_batches` (batch_no, lot_no, shade_code, caliber)
 *   - Reserved Stock  → `stock_reservations` (existing)
 *   - Backorder       → `backorder_allocations` (existing)
 *   - Display Sample  → `display_stock` (existing)
 *   - Godown          → `warehouse_stock` (existing)
 *   - Price Levels (Dealer/Retail/Wholesale/Project)
 *       → `price_tiers` + `price_tier_items` (existing, generic named tiers);
 *         `products.default_sale_rate` remains the base/"Retail" price.
 *
 * New columns (all nullable):
 *   series             — named product line under a brand (e.g. "Milano Series")
 *   collection_name    — broader marketing "collection" spanning several series
 *                        (avoids the reserved word `collection`)
 *   tile_type          — Ceramic / Vitrified / Porcelain / Digital / Rustic body, etc.
 *   finish             — Glossy / Matt / Satin / Sugar / Carving
 *   surface            — Polished / Glazed / Rustic / Wooden / Marble
 *   shade_family       — descriptive product-level shade group (distinct from the
 *                        exact per-receipt `product_batches.shade_code`)
 *   caliber_spec       — nominal product-level caliber/gauge spec (distinct from the
 *                        exact per-receipt `product_batches.caliber`)
 *   thickness_mm       — tile/sanitary thickness in millimetres
 *   country_of_origin  — e.g. Bangladesh, China, India, Spain, Morbi (India)
 *   default_rack       — informational default/suggested shelf label. The
 *                        authoritative PER-GODOWN rack/bin location is a
 *                        `warehouse_stock` concern, deferred to the Inventory
 *                        sprint (Roadmap Phase 2) to keep this sprint scoped
 *                        to the Product module only.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.string('series', 100);
    t.string('collection_name', 100);
    t.string('tile_type', 100);
    t.string('finish', 50);
    t.string('surface', 50);
    t.string('shade_family', 50);
    t.string('caliber_spec', 30);
    t.decimal('thickness_mm', 6, 2);
    t.string('country_of_origin', 100);
    t.string('default_rack', 50);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('series');
    t.dropColumn('collection_name');
    t.dropColumn('tile_type');
    t.dropColumn('finish');
    t.dropColumn('surface');
    t.dropColumn('shade_family');
    t.dropColumn('caliber_spec');
    t.dropColumn('thickness_mm');
    t.dropColumn('country_of_origin');
    t.dropColumn('default_rack');
  });
}
