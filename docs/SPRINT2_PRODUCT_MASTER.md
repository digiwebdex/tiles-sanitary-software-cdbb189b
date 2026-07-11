# V2 Sprint 2 — Product Master (Change Record)

**Branch:** `v2/sprint-2-product-master` (based on `v2/sprint-1-foundation`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** refactor, not rewrite. Reuse existing tables/APIs/components wherever the data or mechanism already exists; add only what is genuinely missing.

---

## 1. Inspection — what already existed (reused, not rebuilt)

| V2 Product Master field | Existing implementation | Verdict |
|---|---|---|
| Brand, Color, Warranty, Barcode | `products.brand/color/warranty/barcode` | ✅ Reuse unchanged |
| Category | `products.category` enum (`tiles`/`sanitary`) | ✅ Reuse unchanged |
| Size / Length / Width | `products.size`, `tile_width`, `tile_height`, `size_unit` | ✅ Reuse unchanged |
| Box / Piece / Square Feet | `unit_type`, `pieces_per_box`, `per_box_sft`, `sqft_per_piece`, `sqft_per_box`, `stock_base_unit` | ✅ Reuse unchanged — already a fully-built dual-unit engine |
| **Batch / Lot / Shade (per receipt) / Caliber (per receipt)** | `product_batches.batch_no / lot_no / shade_code / caliber` | ✅ **Already fully modeled at the DB layer.** The gap was surfacing, not schema. |
| Reserved Stock | `stock_reservations` + existing Reserve Stock dialog | ✅ Reuse unchanged |
| Backorder | `backorder_allocations` + `sale_items.backorder_qty/allocated_qty` + `/api/backorders/*` | ✅ Reuse unchanged (formula reused, see §3) |
| Display Sample | `display_stock` table | ✅ Reuse unchanged |
| Godown (stock per warehouse) | `warehouse_stock` | ✅ Reuse unchanged |
| Price Levels (Dealer/Retail/Wholesale/Project) | `price_tiers` + `price_tier_items` (generic named tiers) + `products.default_sale_rate` (base rate) | ✅ **Reused as-is** — see §4, no new pricing columns added |
| Sub Category | `products.product_group` (free text, previously labelled "Product Group") | ✅ Reused — **relabelled in the UI only**, column name/data untouched |
| Series, Collection, Tile Type, Finish, Surface, Shade Family (product-level), Caliber (product-level spec), Thickness, Country of Origin, Default Rack | *(none)* | 🆕 New — see §2 |

**Also discovered during inspection (documented, not touched — out of scope for this sprint):**
- `backend/src/routes/products.ts` carries a stale header comment ("Phase 3D = shadow mode only... writes work but frontend never calls them"). In fact `.env.production` sets `VITE_DATA_PRODUCTS=vps` and `productService.ts` is fully VPS-backed — the route **is** the live write path. The comment is outdated documentation, not a behavioural issue; left as-is (fixing stale comments in an unrelated file is out of this sprint's mandate).
- `CreateProduct.tsx` / `EditProduct.tsx` already had a pre-existing gap where several existing fields (e.g. `tile_width`, `tile_height`, `pieces_per_box`, `product_group`, `grade`) are not sent on create despite being on the form. This predates Sprint 2 and is **not** touched here (would be scope creep); only the new V2 fields were added to these payload builders.

---

## 2. What Sprint 2 ADDED (new, additive)

### Database (1 migration, additive/nullable — **not yet applied**, see §7)
`backend/src/db/migrations/085_product_master_v2_fields.ts` adds 9 nullable columns to `products`:
`series`, `collection_name`, `tile_type`, `finish`, `surface`, `shade_family`, `caliber_spec`, `thickness_mm`, `country_of_origin`, `default_rack`.

No table is renamed, retyped, or dropped. Every existing product row is unaffected until a dealer fills these in.

### Backend
| File | Change |
|---|---|
| `backend/src/db/migrations/085_product_master_v2_fields.ts` | new migration (up/down, fully reversible) |
| `backend/src/services/productMasterService.ts` | new — pure, unit-tested helpers: `computeBackorderOutstanding`, `shapePriceLevels` |
| `backend/src/services/productMasterService.test.ts` | new — 8 unit tests |
| `backend/src/routes/products.ts` | extended `WRITABLE`/`FILTERABLE`/`SORTABLE` sets + `productWriteSchema` (new fields, all optional); extended `GET /:id/stock-summary` response with `backorderQty` + `displaySampleQty` (additive keys); **new** `GET /:id/price-levels` (read-only, reuses `price_tiers`/`price_tier_items`) |

### Frontend
| File | Change |
|---|---|
| `src/lib/validators.ts` | extended `createProductServiceSchema` with the new fields (**required** — Zod silently strips unknown keys, so omitting this would have made the new UI fields unsaveable); added `optionalPositiveNumber()` helper |
| `src/modules/products/productSchema.ts` | extended form schema with the new fields; added `optPositiveNum` helper (thickness must be > 0, matching the service layer — a form/service mismatch here was caught by the new tests, see §6) |
| `src/modules/products/ProductForm.tsx` | relabelled "Product Group" → "Sub Category" (no rename); added Series/Collection fields to Basic Information; new "Specification" card (Tile Type, Finish, Surface, Shade Family, Caliber spec, Thickness, Country of Origin, Default Rack); renders new `<PriceLevelsPanel>` in edit mode |
| `src/modules/products/PriceLevelsPanel.tsx` | new component — shows/edits this product's rate across the dealer's price tiers; "Add standard levels" one-click creates Dealer/Retail/Wholesale/Project tiers via the **existing** `pricingTierService.createTier`/`setTierRate` (no new write endpoint) |
| `src/modules/products/ProductDetailDialog.tsx` | widened `product` prop with the new optional fields (shown only when set); added `dealerId` prop; new "Stock & Location" section showing backorder/display-sample badges + active shade/lot batches (via the extended stock-summary endpoint) |
| `src/pages/products/CreateProduct.tsx` / `EditProduct.tsx` | pass the new fields through to `productService.create/update` and into the edit form's `defaultValues` |
| `src/test/productMasterSchema.test.ts` | new — 8 unit tests |

**Not changed:** `ProductList.tsx` table columns (existing columns/sort/filter wiring left untouched — the new taxonomy is fully usable via the Form/Detail views; adding list columns is a low-risk follow-up, not required for this sprint).

---

## 3. Backorder / Display Sample — reused formula, not reinvented

`stock-summary`'s new `backorderQty` uses the **exact same** `backorder_qty - allocated_qty` formula (clamped ≥ 0) as the existing `GET /api/backorders/shortage-demand`, extracted into `computeBackorderOutstanding()` so both call sites agree and the math is unit-tested. `displaySampleQty` reads directly from the existing `display_stock` table (unique per dealer+product, so a simple lookup).

## 4. Price Levels — reused mechanism, not a parallel system

The V2 spec's "Dealer/Retail/Wholesale/Project" are **not** new dedicated columns. Adding four fixed price columns alongside the existing generic `price_tiers`/`price_tier_items` would have created exactly the kind of duplicate parallel system flagged as an anti-pattern in the V2 Transformation Report (cf. `journal_entries` vs `gl_journal_entries`). Instead:
- The dealer's **existing, already-referenced-elsewhere** tier mechanism is reused as-is (customers, quotations, and sales already join through `price_tier_id`/`tier_id`).
- A new **read-only** endpoint (`GET /:id/price-levels`) aggregates "this product's rate across all the dealer's tiers" — the one query shape that didn't already exist.
- Saving a rate calls the **existing** `PUT /api/pricing-tiers/:tierId/items/:productId` unchanged.
- A dealer with no tiers yet can one-click create the four standard levels; a dealer with custom tier names keeps them exactly as-is.

---

## 5. Risks & how they're contained

| Risk | Mitigation |
|---|---|
| New DB columns break existing reads | All nullable, additive; `alterTable add column` is instant/non-locking on Postgres for existing rows |
| Zod silently drops new fields (found during implementation) | Added to `createProductServiceSchema`; regression test added (`productMasterSchema.test.ts`) that specifically asserts the fields are **not** stripped |
| Form/service validation mismatch on `thickness_mm` (found during implementation — form allowed 0, service required >0) | Fixed: form now uses `optPositiveNum`, matching the service-layer `optionalPositiveNumber()`; caught by an intentional negative-case test before it could reach production |
| `backorderQty` formula drifts from the existing `/backorders/shortage-demand` report | Extracted into one shared, tested function (`computeBackorderOutstanding`) instead of re-deriving the math inline |
| Blast radius on `ProductList.tsx` / Sales / Purchase / other product consumers | Every backend change is **additive** (new optional response keys, new optional request fields) — existing consumers destructuring known keys are unaffected; nothing renamed or removed |

---

## 6. Testing

- **Backend:** `cd backend && npx tsc --noEmit` — clean. `npx vitest run` — **61/61 pass** (8 new + 53 prior, including all of Sprint 1's).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` — clean (only the pre-existing, unrelated `portalService.ts` Supabase errors remain, unchanged from before this sprint). `npx vitest run` — **238/238 pass** across 36 files (8 new + 230 prior).
- The 16 new unit tests (8 backend + 8 frontend) specifically found and fixed **two real bugs before they shipped**: the Zod key-stripping issue and the thickness form/service validation mismatch (§5).

## 7. Database migration — NOT YET APPLIED (needs your approval)

The migration file is written and reviewed but **has not been run against the live database** — applying schema changes to production without explicit sign-off is intentionally blocked. It is safe to run (additive, nullable, non-locking) whenever you approve:

```bash
cd backend
eval "$(pm2 jlist | node -e '...')"   # load live DB_* env, as used throughout this project
export NODE_ENV=production
npx knex migrate:latest --knexfile src/db/knexfile.ts
```

This can be run **independently of any code deploy** — old, currently-running code simply doesn't know about the 9 new columns and is completely unaffected.

## 8. Manual QA checklist (after migration + deploy)

- [ ] Create a new **tiles** product — fill Sub Category, Series, Collection, Tile Type, Finish, Surface, Shade Family, Caliber spec, Thickness, Country of Origin, Default Rack → Save → reopen edit → all values persist.
- [ ] Create a new **sanitary** product — confirm the tile-only block (Finish/Surface/Shade/Caliber/Thickness) is hidden; Tile Type label reads "Type"; Country of Origin still shows.
- [ ] Edit an **existing** (pre-Sprint-2) product — confirm it loads with the new fields blank and saves fine without touching them.
- [ ] Open **Product Detail** for a product with active batches — confirm shade/lot/caliber rows appear; for a product with outstanding backorder or display-sample stock, confirm the badges show the right numbers (cross-check against Backorder Reports / Display Sample pages).
- [ ] On an existing product, open **Price Levels** → "Add standard levels" → confirm Dealer/Retail/Wholesale/Project tiers appear (skipping any that already exist by name) → set a rate on one → Save → refresh → rate persists → confirm the same tier/rate shows on **Settings → Pricing Tiers**.
- [ ] Confirm a **Sale/Quotation** for this product still resolves price/stock correctly (unaffected by this sprint, but exercises the same `products`/`price_tier_items` tables).
- [ ] Confirm `GET /api/products` (list) and existing Sales/Purchase product pickers still work unchanged.

## 9. Rollback strategy

1. **Before migration is applied:** simply don't merge/deploy this branch. Nothing is live.
2. **After migration is applied, before code deploy:** the new columns sit unused (nullable, no code references them yet) — zero impact; no rollback needed.
3. **After both are live:** `git revert` the sprint commit(s) — all backend/frontend changes are additive; revert restores the exact Sprint-1 behaviour. To also drop the columns: `npx knex migrate:rollback` (the `down()` in `085_...` is destructive **for that migration's own columns only** — confirm no data was entered into them first, since the rollback drops the columns and their data).

## 10. Not done (deliberately out of scope — stopping after Sprint 2)

- `ProductList.tsx` table columns for the new taxonomy (low-risk follow-up).
- Fixing the pre-existing stale header comment in `products.ts` and the pre-existing CreateProduct/EditProduct field-whitelist gaps (predate this sprint, unrelated).
- Inventory/Godown module work (rack-per-warehouse, transfers) — reserved for the Inventory sprint per the Roadmap.
- Applying the migration to production (§7 — awaiting explicit approval).
