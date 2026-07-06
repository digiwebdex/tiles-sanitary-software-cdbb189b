# V2 Sprint 3C — Reservation, Backorder & Availability Engine (Change Record)

**Branch:** `v2/sprint-3c-reservation-backorder-availability` (based on `v2/sprint-3b-warehouse-godown`, tip `18d5b0b`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 3A (`7a64cc5`) and 3B (`18d5b0b`) are frozen — no file either sprint created or modified was touched. The Product Master (Sprint 2/2.1) and the Warehouse/Godown/Rack/Bin hierarchy (Sprint 3B) were not redesigned; Sprint 3C only *references* those tables (new optional FK columns pointing at them) and reuses their read services.

---

## 1. Inspection — what already existed (reused, not rebuilt)

This sprint's biggest finding: **almost every mechanism the scope asked for already existed**, largely unused or partially wired. The real work was completing what was already designed, not designing something new.

| Sprint 3C requirement | What already existed | Verdict |
|---|---|---|
| **Stock Reservation** (reserve/release/expiry/history/status) | `stock_reservations` table (migration 022) + a full route (`reservations.ts`, Phase 3R) calling three PL/pgSQL RPCs. | 🔴 **Broken in production** — see §1a |
| **Reservation by Batch/Lot** | `stock_reservations.batch_id` already existed and was already wired through `create_stock_reservation`. | ✅ Fully built |
| **Reservation by Warehouse/Godown/Rack** | Nothing — no location FK on `stock_reservations`. | 🆕 Genuine gap |
| **Edit Reservation** | No RPC/route existed for editing an in-flight reservation. | 🆕 Genuine gap |
| **Customer Backorder** (status, partial fulfillment, auto-fulfillment) | `sale_items.backorder_qty/allocated_qty/fulfillment_status`, `backorder_allocations`, full read API (`backorders.ts`, Phase 3U-21). Auto-fulfillment on purchase receipt already atomic inside `POST /api/purchases`. | ✅ Fully built — reused unchanged |
| **Supplier Backorder** | `purchase_shortage_links` table (migration 022) already links a sale-item shortage to the purchase raised to cover it (`link_type` defaults to `'backorder'`), already written by `purchasePlanning.ts` — just never surfaced outside the Reports module. | 🆕 New read view, 100% existing data |
| **Display Stock** (sample, demo, non-saleable, history) | `display_stock` + `sample_issues` tables, `adjustSellableStock` service, full route (`displayStock.ts` + `sampleIssues.ts`), and a complete frontend page (`DisplaySampleStockPage.tsx` + 5 dialogs) already in production. | ✅ **Fully built — untouched** |
| **Stock Allocation** (allocate/deallocate/priority/history) | No separate concept — "allocation" already exists informally as FIFO batch picking (`sale_item_batches`) at sale-confirm time. | 🆕 Modeled as a `stock_reservations` variant — see §2 |
| **Availability Engine** | 11 divergent "available qty" computations scattered across `sales.ts`, `challans.ts`, `autoPo.ts`, `purchasePlanning.ts`, `demandPlanning.ts`, `products.ts`, `reports.ts`, `dashboard.ts`, and `batchService.ts` (frontend) — no single source of truth. | 🆕 **The sprint's core deliverable** |
| **Shade/Lot/Batch/Caliber allocation** | `product_batches` already has `shade_code`/`caliber`/`lot_no`/`reserved_box_qty`/`reserved_piece_qty`; `sale_item_batches` already supports multi-batch allocation per sale item. | ✅ Fully built — reused unchanged |

### 1a. Critical finding: Reservations were non-functional in production

`reservations.ts` has called `create_stock_reservation`, `release_stock_reservation`, and `expire_stale_reservations` via `db.raw(...)` since "Phase 3R" — but those three PL/pgSQL functions were **only ever defined in the old Supabase migration history** (`supabase/migrations/20260415191130_*.sql`) and were **never ported** to this Knex/VPS chain (the same class of gap migration 057 already fixed for the sale-side RPCs — see that file's own header comment: *"Defined in Supabase migrations but never ported to Knex chain on VPS"*). Left as-is, every Reserve/Release/Expire call in production would fail with `function does not exist`.

Compounding this, `dealers.enable_reservations` (the per-dealer feature flag the frontend already checks in `ProductList.tsx`, `SaleForm.tsx`, `OwnerDashboard.tsx`) was **also never ported**, so `backend/src/routes/dealerSettings.ts` hardcoded the API response to `enable_reservations: false` for every dealer, with no way to turn it on. The feature was effectively dark for every dealer, on purpose (defensively, since the underlying RPCs didn't exist).

**Fixed in migration 087** (verbatim port, no logic changes — see §2) and in `dealerSettings.ts` (now reads/writes the real column). This directly unblocks Sprint 3C's own first two requirements (Reserve Stock, Release Reservation), which would otherwise have been built on a foundation that silently 500s in production.

---

## 2. What Sprint 3C ADDED

### Database (migration `087_reservation_allocation_availability.ts` — purely additive)

- **Ported** (verbatim, from the old Supabase migration): `create_stock_reservation`, `release_stock_reservation`, `expire_stale_reservations` PL/pgSQL functions, and `dealers.enable_reservations` (boolean, default `false` — no behavior change, since the API already hardcoded `false`).
- **New nullable columns on `stock_reservations`:** `warehouse_id`/`godown_id`/`rack_id` (FK → Sprint 3B's hierarchy, `SET NULL`) and `priority` (integer, default `0`).
- No existing column renamed/retyped/dropped; every reservation created before this migration keeps working exactly as before.

### Backend

| File | Change |
|---|---|
| `backend/src/routes/reservations.ts` | Extended `CreateSchema` with `kind` (`'reservation' \| 'allocation'`), `priority`, `warehouse_id`/`godown_id`/`rack_id`. "Stock Allocation" is the **same** table/RPCs as a Reservation, distinguished only by `source_type = 'allocation'` (already free-text, no CHECK constraint) — applied via a follow-up `UPDATE` inside the same transaction as the RPC call. New `PATCH /:id` ("Edit Reservation"): release (existing RPC) + create (existing RPC) in one transaction, carrying over batch/customer/kind/priority/location — no new stock-mutating SQL was written. `GET /` gained a `kind` filter and warehouse/godown/rack name joins. |
| `backend/src/routes/dealerSettings.ts` | `enable_reservations` now reads/writes the real column instead of a hardcoded `false` (see §1a). |
| `backend/src/routes/backorders.ts` | New `GET /supplier-links` ("Supplier Backorder") — joins the existing `purchase_shortage_links` → `sale_items`/`sales`/`customers` and → `purchases`/`suppliers`. No new table. |
| `backend/src/routes/availability.ts` | **New** — `GET /:productId` and `GET /:productId/batches`, read-only. |
| `backend/src/services/availabilityService.ts` | **New** — the Availability Engine (see §5). |
| `backend/src/services/reservationExpiryService.ts` | **New** — `runReservationExpirySweep()`, a per-dealer loop calling the (now-ported) `expire_stale_reservations` RPC, wired to a new cron-guarded route (below). Mirrors the existing `trialExpiryService.ts` pattern exactly — no new cron infrastructure invented. |
| `backend/src/routes/adminStats.ts` | +1 cron route: `POST /api/admin/cron/expire-stale-reservations`, reusing the existing `cronGuard`/`CRON_SECRET` mechanism already used by the trial-reminder crons. **Manual QA / ops note:** add one crontab entry hitting this endpoint daily (e.g. `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://api.sanitileserp.com/api/admin/cron/expire-stale-reservations`) for "Reservation Expiry" to actually sweep. |
| `backend/src/index.ts` | +1 route registration (`/api/availability`). |

### Frontend

| File | Change |
|---|---|
| `src/services/reservationService.ts` | `kind`/`priority`/location fields added to `ReservationInput`/`Reservation`; new `editReservation()`; `kind` filter added to `listReservations()`. |
| `src/services/availabilityService.ts` | **New** — thin wrapper over the two new endpoints. |
| `src/services/backorderAllocationService.ts` | +1 method: `getSupplierLinks()`. |
| `src/modules/reservations/ReservationsTab.tsx` | **New** — shared list/CRUD for both Reservations and Allocations (parameterized by `kind`, since they're the same mechanism). |
| `src/modules/reservations/BackordersTab.tsx` | **New** — customer backorder status/history (existing reads) + Supplier Backorder view (new read). |
| `src/modules/reservations/AvailabilityTab.tsx` | **New** — product search → Availability Engine breakdown + per-batch (shade/lot/caliber) availability. |
| `src/pages/reservations/ReservationsPage.tsx` | **New** page — does **not** modify Sprint 3A's `InventoryPage.tsx` or Sprint 3B's `WarehousesPage.tsx`. Gates the Reservations/Allocations tabs behind `dealerInfo.enable_reservations` (existing hook, now backed by a real column). |
| `src/pages/settings/SettingsPage.tsx` | +1 toggle: "Stock Reservations" (mirrors the existing "Allow Sale Below Stock" toggle exactly) — the only way a dealer_admin can turn the now-real `enable_reservations` flag on. |
| `src/config/navConfig.ts` / `src/App.tsx` | +1 nav item ("Reservations & Backorders"), +1 route (`/reservations`) — same additive pattern every prior sprint used for its own new page. |

**Explicitly excluded per Sprint 3C scope** (not implemented): Barcode/QR, Inventory Intelligence, Stock Aging, ABC Analysis, Purchase Suggestions, Demand Forecast, AI features, Reports redesign, Sales workflow changes. No automatic shade-matching recommendation was built — batch/lot/shade/caliber reservation and allocation are supported (§1, §5), but nothing suggests *which* batch to pick.

---

## 3. Database impact

**Purely additive.** 3 ported PL/pgSQL functions (previously non-functional — see §1a), 1 new dealer column, 4 new nullable columns on 1 existing table. No renamed/dropped/retyped columns, no changed defaults for existing rows. Ported RPC logic is byte-identical to the old Supabase source (verified by diff against `supabase/migrations/20260415191130_*.sql`) — this is a deployment fix, not a redesign.

## 4. API impact

| Change | Compatibility |
|---|---|
| **New** `GET/PATCH /api/availability/*`, `backorders/supplier-links`, `reservations PATCH /:id` | New endpoints/methods; nothing pre-existing changed. |
| `reservations.ts` `POST /` gains optional `kind`/`priority`/location fields | Additive — a request with none of these behaves exactly as before (`kind` defaults to `'reservation'`, `priority` to `0`, location to `NULL`). |
| `dealerSettings.ts` `enable_reservations` | **Behavior change, but a bug fix, not a regression**: this field used to always report `false`; it now reports the real per-dealer value. Every dealer's value is `false` immediately after migration 087 (the column defaults to `false`), so no dealer's *current* behavior changes until a dealer_admin explicitly opts in via the new Settings toggle. |
| `computeAvailability()`/`computeBatchAvailability()` | New, read-only, additive. **Not** wired into `sales.ts`, `challans.ts`, `autoPo.ts`, or any other existing computation (per the sprint's "no Sales workflow changes" / "no Reports redesign" constraints) — those keep their own existing formulas untouched. Adopting the shared engine there is explicitly deferred to a future sprint. |

No existing API, service, or component was modified in a way that changes current (pre-3C) behavior for a dealer who takes no new action.

## 5. The Availability Engine formula

```
Available = Current Stock − Reserved − Allocated − Display − Pending Delivery + Incoming Purchase
```

Implemented in `backend/src/services/availabilityService.ts`, split into a pure `computeAvailabilityFromInputs()` (the actual math, fully unit-tested with zero mocking) and a thin DB-fetching `computeAvailability()` wrapper. Reconciling the formula with what actually exists in this data model:

- **`stock.total_pieces` is already NET of display stock** (moving stock to display deducts it via `adjustSellableStock`). So "Current Stock" is computed as the *gross* figure (`stock.total_pieces + display_stock_pieces`) specifically so subtracting display back out doesn't double-count — verified by a named regression test.
- **Reserved vs. Allocated** are summed directly from `stock_reservations` (split by `source_type = 'allocation'` vs. not), **not** from `stock.reserved_box_qty/reserved_piece_qty` — that aggregate mixes both kinds together, and its similarly-named sibling `stock.reserved_total_pieces` is a **one-time migration backfill that no RPC has updated since** (dead/stale — discovered during this sprint, documented, not used).
- **Incoming Purchase always evaluates to `0`** today: `purchases` has no draft/pending status column in this schema — every purchase row represents stock already received at creation time. The term is kept in the formula/return shape for a future Buy-Side sprint that introduces draft POs.

`computeBatchAvailability()` provides the same breakdown per batch (shade/caliber/lot), satisfying the "Shade/Lot Allocation" requirement without any automatic shade-matching — it only reports.

## 6. Testing report

- **Backend:** `npx tsc --noEmit` clean, **except one pre-existing issue in Sprint 3B's own frozen test file** (`warehouseTransferStock.test.ts`, 7 `TS18048` "possibly undefined" errors from `Array.find()`). Verified via a disposable `git worktree` checkout of `v2/sprint-3b-warehouse-godown` alone — the errors are already present in commit `18d5b0b`, unrelated to anything in this sprint. Not fixed, per "do not modify Sprint 3B"; does not affect runtime (the tests still pass). `npx vitest run` — **126/126 pass** (29 new + 97 prior, all Sprint 1–3B suites still green).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the pre-existing, unrelated `portalService.ts` errors remain, same as every prior sprint's report). `npx vitest run` — **280/280 pass** (13 new + 267 prior). `npm run build` succeeds cleanly.
- New backend tests: `reservations.query.test.ts` (7), `backorders.query.test.ts` (2), `dealerSettings.test.ts` (4), `availabilityService.query.test.ts` (3), `availabilityService.test.ts` (11 — the pure formula math, including the display-stock double-count regression guard), `reservationExpiryService.test.ts` (2).
- New frontend tests: `reservationService.test.ts` (6), `availabilityService.test.ts` (4), `backorderAllocationService.getSupplierLinks.test.ts` (3).

## 7. Manual QA checklist

- [ ] **Settings** — toggle "Stock Reservations" on; confirm `ProductList.tsx`/`SaleForm.tsx`/`OwnerDashboard.tsx` (all pre-existing, unmodified) start showing their reservation UI, since they already gate on `enable_reservations`.
- [ ] **Reservations tab** — create a reservation for a customer/product; confirm it appears with status "active". Edit it (change qty/expiry) — confirm a new row replaces the old one (old shows "released", audit log shows `RESERVATION_EDITED`). Release it — confirm status becomes "released" and the product's `stock.reserved_*_qty` decreases.
- [ ] **Reservations tab** — create one scoped to a Warehouse → Godown → Rack; confirm the location column displays correctly.
- [ ] **Allocations tab** — create an allocation (same dialog, `kind=allocation`); confirm it does **not** appear in the Reservations tab's list and vice versa (kind filter).
- [ ] **Backorders tab** — confirm the existing pending-backorder data displays unchanged; confirm the new "Supplier Backorder" table shows existing `purchase_shortage_links` rows (if any exist) with supplier/purchase info joined correctly.
- [ ] **Availability tab** — search a product with known stock/reservations/display stock; confirm the breakdown numbers reconcile (Available = Current − Reserved − Allocated − Display − Pending Delivery), and that a product currently holding display stock shows the CORRECT (not double-subtracted) available figure.
- [ ] **Availability tab** — confirm the per-batch table shows shade/caliber/lot correctly for a multi-batch product.
- [ ] Confirm the Products, Inventory (Sprint 3A), and Warehouses (Sprint 3B) pages still work exactly as before — nothing regressed.
- [ ] **Ops:** add the crontab entry for `POST /api/admin/cron/expire-stale-reservations` (see §2) so "Reservation Expiry" actually sweeps daily — this is a manual server-side step, not something this PR can configure.

## 8. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every backend/frontend change is additive; the 5 modified existing files (`reservations.ts`, `dealerSettings.ts`, `backorders.ts`, `adminStats.ts`, `SettingsPage.tsx`, plus the two service files) only gained new code paths gated by new optional parameters/columns.
3. **DB rollback:** migration `087`'s `down()` drops the 4 new `stock_reservations` columns and `dealers.enable_reservations`, and drops the 3 ported RPC functions (returning reservations to their prior, non-functional-but-also-unused state). No existing table's data is touched.
4. **Partial rollback:** the new `/reservations` page, nav item, and Settings toggle can be hidden independently of the backend (which would simply go unused) if only the UI needs to be pulled back.
5. **If the RPC port itself needs to be rolled back** (e.g. an issue is found in the ported functions): the functions are `CREATE OR REPLACE`, so a follow-up migration can safely redefine them again — no data loss, since `stock_reservations` rows are unaffected either way.

## 9. Explicitly out of scope (per Sprint 3C instructions — not done)

- Barcode/QR, Inventory Intelligence, Stock Aging, ABC Analysis, Purchase Suggestions, Demand Forecast, AI features — not implemented.
- Reports redesign — the Reports module (`BackorderReports.tsx`, `DisplaySampleReports.tsx`, `PurchasePlanningReports.tsx`) was not touched; the new Backorder/Availability views live on a new, separate page.
- Sales workflow changes — `sales.ts`'s own stock-check/FIFO-allocation logic was not modified; the Availability Engine is a new, additive read surface, not a replacement wired into that money-path code.
- Automatic shade-matching recommendations — reservation/allocation by batch/shade/caliber/lot is fully supported (read + write), but nothing suggests which batch to pick.
- No changes to Product Master, the Warehouse/Godown/Rack/Bin hierarchy, or any Sprint 3A/3B file.
