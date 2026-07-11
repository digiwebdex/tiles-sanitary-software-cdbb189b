# V2 Sprint 3A — Inventory Core (Change Record)

**Branch:** `v2/sprint-3a-inventory-core` (based on `v2/sprint-2.1-product-polish`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** the Product module is frozen — nothing in `src/pages/products`, `src/modules/products`, `productSchema.ts`, `validators.ts` (product schemas), or `backend/src/routes/products.ts` was touched. Sprint 3A only reuses those files as read-only imports/consumers, exactly like Sales/Purchase/Quotation already do.

---

## 1. Inspection — what already existed (reused, not rebuilt)

This was the most important finding of the sprint: **most of "Inventory Core" already existed**, just scattered as per-product dialogs on the Products page, with no standalone Inventory screen and no dealer-wide ledger view.

| Sprint 3A requirement | What already existed | Verdict |
|---|---|---|
| **Stock Adjustment** | `backend/src/routes/adjustments.ts` (add/deduct/restore/broken) — already atomic, transactional, row-locked, writes `stock_ledger` + `audit_logs`. `stockService.ts` — already fully VPS-backed ("Zero Supabase imports remain" per its own header). `StockAdjustDialog.tsx` — already built, with approval-workflow integration. | ✅ **Fully built — reused unchanged** |
| **Stock Summary** | `GET /api/products/:id/stock-summary` (extended in Sprint 2 with backorder/display-sample data) + `StockSummaryDialog.tsx`. | ✅ **Fully built — reused unchanged** |
| **Stock Movement** | `GET /api/products/:id/stock-movement` + `StockMovementDialog.tsx` (date-ranged purchase/sale/return/adjustment view). | ✅ **Fully built — reused unchanged** |
| **Current Stock** (dealer-wide) | Data existed (`GET /api/products/stock-map`, `GET /api/products/summary-rows`, `productService.list`) but **no standalone page** — only per-product dialogs reachable from the Products list. | 🆕 Page built from existing data sources |
| **Stock Dashboard** | The exact KPI math (total/low/out/value) already existed as a `useMemo` inside `ProductList.tsx`. | 🆕 Same math, new standalone widget (Products module untouched) |
| **Inventory Search** | `productService.list(dealerId, search, page)` (Sprint 2.1 already extended the search to match series/collection too). | ✅ **Fully built — reused unchanged** |
| **Stock Ledger** | Every stock-moving transaction (`adjustments.ts`, `purchases.ts`, `sales.ts`) already **writes** a `stock_ledger` row. **Nothing read it back** — confirmed by grepping every route file. | 🆕 **The one genuine gap** — new read endpoint |
| **Stock History** | No per-product raw ledger view existed (Purchase/Sales History dialogs exist but are a different, broader feature). | 🆕 Satisfied by the same new Stock Ledger endpoint, filtered by `productId` |

**Also confirmed (documented, not touched):** `backend/src/routes/stock.ts`'s header comment claims stock mutations "MUST stay on Supabase" — this is stale, exactly like the similar stale comment found in `products.ts` during Sprint 2. The real write path (`adjustments.ts` → `stockService.ts`) has been fully VPS-native for a while. Not fixed here (unrelated doc-only issue, out of scope).

---

## 2. What Sprint 3A ADDED

### Database
**NONE.** Zero migrations. `stock_ledger` already exists and is already populated by every write path; this sprint only adds a way to read it.

### Backend
| File | Change |
|---|---|
| `backend/src/routes/stock.ts` | New `GET /stock/ledger` (dealer-wide, optional `productId`/`from`/`to` filters, paginated, joined with `products` for display). Registered before `/:id` (no route-order conflict). |
| `backend/src/routes/stock.query.test.ts` | **new** — 5 route/integration tests (`.toSQL()` convention from Sprint 2.1 — no supertest/test-DB harness exists in this backend) |

### Frontend
| File | Change |
|---|---|
| `src/services/stockService.ts` | Added `getLedger()` (existing file — reused, not a new service) |
| `src/modules/inventory/StockLedgerDialog.tsx` | **new** — dealer-wide "Stock Ledger" or per-product "Stock History" (same dialog, same endpoint, `productId` optional) |
| `src/pages/inventory/InventoryPage.tsx` | **new** — Stock Dashboard (4 KPI cards) + Inventory Search + Current Stock table + row actions reusing `StockAdjustDialog`/`StockSummaryDialog`/`StockMovementDialog` (imported, unmodified) + the new `StockLedgerDialog` |
| `src/config/navConfig.ts` | +1 nav item ("Current Stock") in the **existing** Inventory group |
| `src/App.tsx` | +1 route (`/inventory`) |
| `src/test/stockService.getLedger.test.ts` | **new** — 6 unit tests |

**Explicitly excluded per Sprint 3A scope** (belong to later Inventory sprints): Reservation, Backorder, Warehouse, Rack, Barcode. `StockSummaryDialog` happens to already show a Reservations tab (pre-existing, from an earlier phase) — reused as-is; no new reservation UI was added.

---

## 3. Database impact: **NONE**

No migration. The new endpoint is a pure read over the existing `stock_ledger` table (already populated by `adjustments.ts`/`purchases.ts`/`sales.ts`).

## 4. API impact

| Change | Compatibility |
|---|---|
| **New** `GET /api/stock/ledger` | New endpoint; nothing else in `stock.ts` changed. `stock.ts`'s existing `GET /` and `GET /:id` are untouched. |
| `stockService.ts` gains `getLedger()` | Additive — every existing exported function is unchanged. |

No existing API, service, or component was modified in a way that could change current behaviour.

## 5. Testing report

- **Backend:** `npx tsc --noEmit` clean. `npx vitest run` — **80/80 pass** (5 new + 75 prior, all Sprint 1/2/2.1 suites still green).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the pre-existing, unrelated `portalService.ts` errors remain). `npx vitest run` — **247/247 pass** (6 new + 241 prior). `npm run build` (production Vite build) succeeds cleanly — important because `App.tsx` and `navConfig.ts` were touched.
- Same honest note as Sprint 2.1: this backend has no HTTP/supertest/test-DB harness, so `stock.query.test.ts` uses `db(...).toSQL()` to compile the real Knex chain (no live connection needed) and assert on the generated SQL — including a named regression test for the inclusive-end-date bug pattern (`created_at < to` without `+1 day` would silently exclude the whole `to` date).

## 6. Manual QA checklist

- [ ] Open **Inventory → Current Stock** from the sidebar (new nav item, existing group) — dashboard KPI cards show sensible numbers (compare Total Products / Low Stock / Out of Stock against the Products list's own summary widget — should match, since they share the same data).
- [ ] Search by SKU, name, or brand — results update; search also matches Series/Collection (Sprint 2.1 behaviour, inherited for free).
- [ ] Filter by Stock Status (All/In/Low/Out) — table updates correctly.
- [ ] Row action → **Stock Summary** — opens the existing dialog with correct data.
- [ ] Row action → **Stock Movement** — opens the existing dialog, date range works.
- [ ] Row action → **Stock Adjustment** (dealer_admin/manager only) — add/deduct stock, confirm the `Products` list's own stock numbers also update (shared query key `products-stock-map` is invalidated).
- [ ] Row action → **Stock History** — opens the new Ledger dialog scoped to that product; confirm entries match what Stock Movement shows for the same product.
- [ ] Top-level **"Stock Ledger"** button — opens the dealer-wide ledger (no product filter), paginated, newest first.
- [ ] Confirm a fresh stock adjustment / sale / purchase immediately appears at the top of the Stock Ledger after refreshing.
- [ ] Confirm salesman role sees the page (read + adjust per their permission) but not the Stock Value KPI card (cost-gated, same rule as elsewhere).
- [ ] Confirm the Products page (`/products`) still works exactly as before — nothing regressed.

## 7. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every change is additive (2 new backend endpoints/tests, 3 new frontend files, +1 nav item, +1 route, +1 service method). No data migration to undo (§3).
3. **Partial rollback:** the `/inventory` nav item and route can be removed independently of the backend endpoint (the endpoint would simply go unused) if only the new UI needs to be pulled back for any reason.

## 8. Explicitly out of scope (per Sprint 3A instructions — not done)

- Reservation, Backorder, Warehouse, Rack, Barcode — reserved for later Inventory sprints.
- No changes to Products, Product Master, Sales, Purchase, or any other module.
- The stale "stock mutations must stay on Supabase" comment in `stock.ts`'s header was noted but not corrected (unrelated documentation fix, out of scope).
