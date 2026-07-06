# V2 Sprint 3B — Warehouse & Godown (Change Record)

**Branch:** `v2/sprint-3b-warehouse-godown` (based on `v2/sprint-3a-inventory-core`, tip `7a64cc5`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprint 3A (`7a64cc5`) is frozen — nothing in that commit was touched or amended. Sprint 3B adds new commits on top of it. The Product module (`src/pages/products`, `src/modules/products`, `productSchema.ts`, `backend/src/routes/products.ts`) remains untouched, same as every prior sprint.

---

## 1. Inspection — what already existed (reused, not rebuilt)

| Sprint 3B requirement | What already existed | Verdict |
|---|---|---|
| **Warehouse Management** (list, CRUD, status, dashboard) | `warehouses` table, `GET/POST/PUT/DELETE /api/warehouses`, `WarehousesPage.tsx`, plan-tier `max_warehouses` limit. | ✅ **Fully built — reused unchanged** (dashboard KPI cards are the one new addition) |
| **Godown Management** | Nothing separate — "godown" was a UI label for "warehouse" (migration 085's own comment: *"Godown → warehouse_stock (existing)"*). No `warehouse_id` parent FK anywhere. | 🆕 **Genuine gap** — new `godowns` table |
| **Rack Management** | `products.default_rack` — a free-text, informational shelf-label *suggestion* on the product, not an entity, no FK, no list. | 🆕 **Genuine gap** — new `racks` table |
| **Bin / Storage Location** | Nothing. No table, no columns, anywhere. | 🆕 **Genuine gap** — new `bins` table |
| **Batch / Lot Management** | `product_batches`, `sale_item_batches`, `delivery_item_batches` tables (with `reserved_box_qty`/`reserved_piece_qty`) + read-only `GET /api/batches` (Phase 3D) + `batchService.getAllBatches()`. Mutations are intentionally RPC-locked to preserve shade/caliber/lot allocation atomicity — out of scope to change. | ✅ **Fully built — reused unchanged**, only a new read-only UI view added |
| **Multi-location Stock** | `warehouse_stock` (per-warehouse cache, migration 061) + `stock` (dealer-wide aggregate). No godown/rack tier existed. | 🆕 Godown/Rack tiers are the genuine gap; warehouse tier reused unchanged |
| **Internal Stock Transfer** | `warehouse_transfers` table + full request→approve→reject→receive workflow + transport-cost posting, warehouse-level only. | ✅ **Workflow fully built — reused unchanged**; godown/rack granularity is the genuine gap |

**Also confirmed:** every existing warehouse-level transfer, stock read, and CRUD route keeps its exact pre-3B behaviour — see §4.

---

## 2. What Sprint 3B ADDED

### Database (migration `086_warehouse_godown_rack_bin.ts` — purely additive)

- **New tables:** `godowns` (→ `warehouse_id` FK), `racks` (→ `godown_id` FK), `bins` (→ `rack_id` FK, bin_code/storage_location/rack_position — no stock of its own), `godown_stock`, `rack_stock` (same shape as the existing `warehouse_stock`).
- **Extended (nullable columns only):** `warehouse_transfers` gains `transfer_level` (`warehouse`|`godown`|`rack`, defaults to `'warehouse'`) + `from_godown_id`/`to_godown_id`/`from_rack_id`/`to_rack_id`. `stock_movements` gains `godown_id`/`rack_id`.
- **Backfill (mirrors migration 061's own pattern):** every existing warehouse gets one "Main Godown"; every godown gets one "Main Rack"; `warehouse_stock` is copied 1:1 down into `godown_stock` and `rack_stock`. **Bins are not backfilled** — they're an optional label a dealer adds later; no stock is tracked at bin granularity in this sprint.
- Every existing row in every existing table is untouched. Every new column defaults such that pre-3B code paths see identical behaviour (`transfer_level = 'warehouse'`, all new FK columns `NULL`).

### Backend

| File | Change |
|---|---|
| `backend/src/routes/godowns.ts` | **new** — full CRUD + `GET /:id/stock` |
| `backend/src/routes/racks.ts` | **new** — full CRUD + `GET /:id/stock` |
| `backend/src/routes/bins.ts` | **new** — full CRUD (no stock endpoint — bins don't carry their own cache) |
| `backend/src/routes/warehouses.ts` | `POST /` now also creates the warehouse's default Godown + Rack in the same transaction (mirrors migration 061's "guarantee a default lower-tier location" pattern). `TransferSchema`/transfer routes gained `transfer_level` + godown/rack id fields — existing warehouse-only callers are unaffected (`transfer_level` defaults to `'warehouse'`). `GET /transfers` now also left-joins godown/rack names for display. New `GET /:id/stock`. |
| `backend/src/services/warehouseTransferStock.ts` | Refactored: the box/piece/sft delta math is now a single generic `applyLocationTransferStock()` parameterized by tier (table + id column), used by `applyWarehouseTransferStock` (unchanged signature/behaviour), and two new siblings `applyGodownTransferStock`/`applyRackTransferStock`. |
| `backend/src/index.ts` | +3 route registrations (`/api/godowns`, `/api/racks`, `/api/bins`) |

### Frontend

| File | Change |
|---|---|
| `src/services/godownService.ts`, `rackService.ts`, `binService.ts` | **new** — mirror `warehouseService.ts`'s existing shape |
| `src/services/warehouseService.ts` | `WarehouseTransfer` interface gains `transfer_level` + godown/rack id/name fields (additive); new `stock()` accessor for `GET /:id/stock` |
| `src/modules/warehouses/LocationStockDialog.tsx` | **new** — generic stock viewer, reused by all three tiers |
| `src/modules/warehouses/GodownsTab.tsx`, `RacksTab.tsx`, `BinsTab.tsx` | **new** — list/CRUD/status UI per tier |
| `src/modules/warehouses/BatchesTab.tsx` | **new** — Batch History + Batch Availability viewer; 100% reuse of the existing read-only `batchService.getAllBatches()` |
| `src/pages/warehouses/WarehousesPage.tsx` | Dashboard KPI row added (Warehouses/Godowns/Racks/Pending Transfers counts); 4 new tabs (Godowns/Racks/Bins/Batches); Transfers tab gained a Level selector that swaps the From/To pickers between Warehouse/Godown/Rack; Warehouses tab gained a "View Stock" row action |

**Explicitly excluded per Sprint 3B scope** (belong to later sprints): Reservation, Backorder, Display Stock, Allocation, Barcode/QR, Inventory Intelligence, Purchase Suggestions, Reports. The existing `reserved_box_qty`/`reserved_piece_qty` columns on `product_batches` are only *displayed* (Batch Availability = qty − already-existing reserved column) — no new reservation logic was written.

---

## 3. Database impact

**Purely additive.** 5 new tables, 6 new nullable columns on 2 existing tables, zero renamed/dropped/retyped columns, zero changed defaults on existing columns. Backfill inserts new rows only (one Godown + one Rack per existing Warehouse) and copies existing `warehouse_stock` values down into the new cache tables — it does not modify `warehouse_stock`, `stock`, or any transactional table.

## 4. API impact

| Change | Compatibility |
|---|---|
| **New** `GET/POST/PUT/DELETE /api/godowns`, `/api/racks`, `/api/bins` (+`:id/stock` on godowns/racks) | New endpoints; nothing pre-existing changed. |
| **New** `GET /api/warehouses/:id/stock` | New endpoint. |
| `warehouses.ts` transfer routes gain optional `transfer_level`/godown/rack fields | Additive — a request with no `transfer_level` defaults to `'warehouse'` and behaves byte-for-byte as before. Existing dealer-app/portal callers (none exist yet for transfers outside this page) are unaffected. |
| `POST /api/warehouses` now also inserts a Godown + Rack | The warehouse row returned to the caller is identical; the extra inserts are a side effect inside the same transaction and do not change the response shape. |
| `warehouseTransferStock.ts` exported function signatures | `applyWarehouseTransferStock` keeps its exact prior signature and behaviour (verified by `warehouseTransferStock.test.ts`'s first case, which is the same scenario the pre-3B code handled). Two new sibling exports are additive. |

No existing API, service, or component was modified in a way that could change current (pre-3B) behaviour.

## 5. Testing report

- **Backend:** `npx tsc --noEmit` clean. `npx vitest run` — **97/97 pass** (17 new + 80 prior, all Sprint 1/2/2.1/3A suites still green). New: `godowns.query.test.ts` (4), `racks.query.test.ts` (3), `bins.query.test.ts` (3), `warehouses.query.test.ts` (3, covers the extended transfer join + new stock route), `warehouseTransferStock.test.ts` (4, covers all three tiers plus the insufficient-stock and same-location guards, using the existing `createMockTrx` harness already used by `sellableStockAdjust.test.ts`).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the pre-existing, unrelated `portalService.ts` errors remain — confirmed identical to Sprint 3A's own report). `npx vitest run` — **267/267 pass** (20 new + 247 prior). `npm run build` (production Vite build) succeeds cleanly — important because `App.tsx`-adjacent nav/routing were NOT touched this sprint (only `WarehousesPage.tsx` and its own module files), but the build was still run in full as a safety check since `warehouseService.ts` (a shared, widely-imported file) was modified.
- Same honest note as Sprint 2.1/3A: this backend has no HTTP/supertest/test-DB harness, so the new route tests use `db(...).toSQL()` to compile the real Knex chain and assert on the generated SQL (join clauses, filter conditions, ordering) rather than hitting a live database.

## 6. Manual QA checklist

- [ ] Open **Warehouses / Godowns** — the Dashboard KPI row shows sensible counts (Warehouses/Godowns/Racks should each be ≥1 once at least one warehouse exists, since every warehouse now auto-creates a Main Godown + Main Rack).
- [ ] **Warehouses tab** — create a new warehouse; confirm it appears, and confirm a matching "Main Godown" appears in the **Godowns tab** and a matching "Main Rack" appears in the **Racks tab** automatically.
- [ ] **Warehouses tab** → row action → **View Stock** — shows the same figures as before (unchanged `warehouse_stock` data).
- [ ] **Godowns tab** — create a second godown under an existing warehouse; mark it default; confirm the previous default is cleared (only within that warehouse, not dealer-wide).
- [ ] **Racks tab** — create a rack under a godown; confirm it's scoped to that godown only.
- [ ] **Bins tab** — create a bin under a rack with a bin code, storage location, and rack position; confirm it displays correctly.
- [ ] **Batches tab** — search an existing product with batch history (e.g. one sold via FIFO before); confirm Batch No./Lot/Shade/Caliber/Available columns show correct, already-existing data.
- [ ] **Transfers tab** — create a Warehouse→Warehouse transfer exactly as before (Level = Warehouse); confirm it still posts stock + transport cost identically to pre-3B behaviour.
- [ ] **Transfers tab** — switch Level to Godown, pick two different godowns (can be under the same or different warehouses), submit; confirm `godown_stock` updates and the transfer list shows the godown names.
- [ ] **Transfers tab** — switch Level to Rack, pick two different racks, submit; confirm `rack_stock` updates.
- [ ] Attempt a transfer with insufficient stock at the source (any tier) — confirm the same "Insufficient stock" error UX as before.
- [ ] Confirm the Products page (`/products`) and Inventory page (`/inventory`, Sprint 3A) still work exactly as before — nothing regressed.

## 7. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every backend/frontend change is additive (new tables, new nullable columns, new routes, new components; the 2 modified existing files — `warehouses.ts` and `warehouseTransferStock.ts` — only gained new code paths gated by `transfer_level`, which defaults to the pre-3B behaviour).
3. **DB rollback:** the migration's `down()` drops the 5 new tables and the 6 new columns, in dependency order (rack_stock/godown_stock → stock_movements/warehouse_transfers columns → bins → racks → godowns). No existing table's data is touched by rollback.
4. **Partial rollback:** the new Godowns/Racks/Bins/Batches tabs and the Transfers Level selector can be hidden independently of the backend endpoints (which would simply go unused) if only the new UI needs to be pulled back.

## 8. Explicitly out of scope (per Sprint 3B instructions — not done)

- Reservation, Backorder, Display Stock, Allocation — reserved for later Inventory sprints (existing `reserved_box_qty`/`reserved_piece_qty` columns are only displayed read-only in the Batches tab, not extended).
- Barcode / QR — not implemented.
- Inventory Intelligence, Purchase Suggestions, Reports — not implemented; no new reporting surface was added anywhere in this sprint.
- No changes to Products, Product Master, Sales, Purchase, or any other module outside the warehouse/godown/rack/bin/batch/transfer surface described above.
