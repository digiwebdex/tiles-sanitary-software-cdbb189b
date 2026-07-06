# V2 Sprint 3D — Inventory Intelligence (Change Record)

**Branch:** `v2/sprint-3d-inventory-intelligence` (based on `v2/sprint-3c-reservation-backorder-availability`, tip `2e9962b`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 3A (`7a64cc5`), 3B (`18d5b0b`), and 3C (`2e9962b`) are frozen — no file any of those sprints created or modified was touched. Product Master was not redesigned; the one new table (`product_stock_thresholds`) is FK'd to `products` but does not alter it.

---

## 1. Inspection — what already existed (reused, not rebuilt)

This sprint's finding was the strongest yet in this series: **two of the six requested areas were already 100% complete, backend and frontend, and simply undiscovered until this audit.**

| Sprint 3D requirement | What already existed | Verdict |
|---|---|---|
| **Dead Stock / Slow Moving / Fast Moving / Non-moving** | `backend/src/routes/demandPlanning.ts` (`getDemandRows()`) already computes `dead_stock`/`slow_moving`/`fast_moving` flags per product from real sales velocity, with dealer-configurable thresholds (`demand_planning_settings`). **`DeadStockReport`, `SlowMovingReport`, `FastMovingReport` React components already exist and are already live** in `src/modules/reports/DemandPlanningReports.tsx`, wired into the Reports Hub (`ReportsPageContent.tsx` cases `demand-dead`/`demand-slow`/`demand-fast`). | ✅ **100% already built — zero new code** |
| **Purchase/Reorder Suggestion, Suggested Qty/Supplier** | `backend/src/routes/autoPo.ts` — full suggestions endpoint (grouped by last-purchase supplier) + complete draft-PO CRUD (`create`, `generate-all`, `patch`, `discard`, `mark-converted`). **`src/pages/purchases/AutoPoDraftPage.tsx` already exists**, already routed at `/purchases/auto-draft`, already in the nav (`navConfig.ts` line 115) — suggestions view, editable draft review, "Approve & Create Purchase" flow that calls the real Purchase module. | ✅ **100% already built — zero new code** |
| **Low Stock Alert, Reorder Level, Safety Stock** | `products.reorder_level` (existing column); `demandPlanning.ts`'s `low_stock` flag and dynamically-computed `safety_stock` (velocity × configurable safety-stock-days) — both already live. | ✅ Reused, unchanged |
| **Minimum Stock, Maximum Stock** | Nothing — no per-product min/max concept anywhere. | 🆕 Genuine gap |
| **Stock Aging Report, Aging Buckets, Batch/Lot Aging** | `product_batches.created_at`/`lot_no` exist, but nothing anywhere computed or displayed batch age. | 🆕 Genuine gap |
| **ABC Analysis, XYZ Analysis, Inventory Turnover, Stock/Warehouse/Godown Value** | `stock.average_cost_per_unit` (WAC, actively maintained by `purchases.ts`), `warehouse_stock`/`godown_stock` (Sprint 3B) hold qty per location. No classification/valuation logic existed anywhere. | 🆕 Genuine gap |
| **Inventory Health Score, Overstock/Understock** | Scattered KPI cards existed (Sprint 3A's Inventory dashboard, demandPlanning's dashboard-stats) but no composite score, and no min/max-based overstock/understock concept (since Min/Max Stock didn't exist yet either). | 🆕 Genuine gap |

**Also confirmed:** `stock.average_cost_per_unit` is "weighted by SFT for box_sft, by qty for piece" (per `purchases.ts`'s own comment) — i.e. cost-per-SFT for tile products, not cost-per-box or cost-per-piece. Every new value/turnover calculation in this sprint uses `sft_qty` (box_sft) or `piece_qty` (piece) accordingly; using `box_qty` or `total_pieces` instead would have silently misvalued every box_sft product.

---

## 2. What Sprint 3D ADDED

### Database (migration `088_inventory_intelligence_thresholds.ts` — purely additive)

- **New table `product_stock_thresholds`**: `dealer_id`, `product_id` (FK → `products`, CASCADE), `min_stock`, `max_stock` (both nullable decimals). Unique per (dealer, product). Deliberately a **separate table**, not new columns on `products` — Product Master is explicitly frozen for this sprint.
- No other schema change. Confirmed via inspection: ABC/XYZ/Turnover/Value/Aging all compute from columns that already existed.

### Backend

| File | Change |
|---|---|
| `backend/src/routes/demandPlanning.ts` | **One-word change**: `getDemandRows` is now `export`ed (was a private function) so the new Inventory Intelligence service can reuse its existing velocity/flag classification directly, instead of re-deriving sales-velocity logic a second time. Zero behavior change to the route handlers that already call it. |
| `backend/src/services/inventoryIntelligenceService.ts` | **New** — pure, unit-tested formula functions (`computeAgingBucket`, `computeStockAgingFromBatches`, `computeAbcClass`, `computeXyzClass`, `computeAbcXyzFromInputs`, `computeLocationValue`, `computeTurnoverFromInputs`, `computeLowStockStatus`, `computeHealthScoreFromInputs`) plus thin DB-fetching wrappers, following the same pure-function/thin-wrapper split Sprint 3C's Availability Engine established for testability. |
| `backend/src/routes/inventoryIntelligence.ts` | **New** — `GET/PUT /thresholds`, `GET /low-stock`, `GET /stock-aging`, `GET /analytics`, `GET /value`, `GET /turnover`, `GET /health`. Value/turnover/analytics endpoints are `dealer_admin`-only (cost-derived data, same reasoning `autoPo.ts`'s suggestions endpoint already uses). |
| `backend/src/index.ts` | +1 route registration. |

### Frontend

| File | Change |
|---|---|
| `src/services/inventoryIntelligenceService.ts` | **New** — thin wrapper over the 7 new endpoints. |
| `src/modules/inventory-intelligence/LowStockTab.tsx` | **New** — Reorder Level/Safety Stock (read-only, from demand planning) + Min/Max Stock (new, editable per product) + understock/reorder/overstock status table. |
| `src/modules/inventory-intelligence/StockAgingTab.tsx` | **New** — aging bucket summary cards + per-batch table (batch/lot/shade/caliber/age). |
| `src/modules/inventory-intelligence/AnalyticsTab.tsx` | **New** — ABC×XYZ classification table + class distribution. |
| `src/modules/inventory-intelligence/ValueTurnoverTab.tsx` | **New** — Stock/Warehouse/Godown Value + Inventory Turnover. |
| `src/modules/inventory-intelligence/HealthDashboardTab.tsx` | **New** — composite Health Score + breakdown + understock/overstock/stockout-risk/dead-stock-value counts, with **links out** to the existing Reports Hub (Fast/Slow Moving) and `/purchases/auto-draft` (Reorder) rather than rebuilding either. |
| `src/pages/inventory-intelligence/InventoryIntelligencePage.tsx` | **New** page — does not modify Sprint 3A/3B/3C's pages or the Reports module. |
| `src/config/navConfig.ts` / `src/App.tsx` | +1 nav item ("Inventory Intelligence"), +1 route — same additive pattern every prior sprint used. |

**Explicitly excluded per Sprint 3D scope** (not implemented): Sales/Quotation/Sales-Order/Invoice/Delivery workflow changes, a shade recommendation engine, Customer workflow, POS, Barcode/QR, CRM. Nothing in `sales.ts`, `quotations.ts`, `challans.ts`, or any Sales-side route was touched.

---

## 3. Database impact

**Purely additive.** 1 new table, 0 changes to any existing table (including `products` — confirmed no Product Master columns were added). No renamed/dropped/retyped columns anywhere in the schema.

## 4. API impact

| Change | Compatibility |
|---|---|
| **New** `GET/PUT /api/inventory-intelligence/*` (7 endpoints) | New; nothing pre-existing changed. |
| `demandPlanning.ts`'s `getDemandRows` export | Purely additive visibility change — the function's behavior, the route handlers that call it, and every existing consumer (`DemandPlanningReports.tsx` via the HTTP routes) are byte-for-byte unaffected. |
| No changes to `autoPo.ts`, `products.ts`, `sales.ts`, or any Sprint 3A/3B/3C route | Confirmed via `git diff` against `2e9962b` — those files do not appear in this sprint's diff at all. |

## 5. Key formulas (all pure, unit-tested)

- **Stock Aging**: `age_days = floor((now - batch.created_at) / 1 day)`, bucketed 0-30/31-60/61-90/90+.
- **ABC**: rank products by stock value descending; cumulative value share ≤70% → A, ≤90% → B, else → C (standard Pareto thresholds).
- **XYZ**: coefficient of variation (stdev/mean) across three trailing 30-day sales windows; CV ≤0.5 → X (stable), ≤1.0 → Y (variable), else → Z (erratic/no sales).
- **Value**: `qty × stock.average_cost_per_unit`, where `qty` is `sft_qty` for box_sft products and `piece_qty` for piece products — matching `average_cost_per_unit`'s own documented per-unit convention exactly (see §1).
- **Turnover**: `(90-day COGS × 4) / current stock value` — an approximation, since a true turnover ratio needs *average* inventory value over the period, which would require historical stock snapshots this schema doesn't have. Documented explicitly in the code rather than silently assumed.
- **Health Score**: starts at 100, subtracts weighted penalties — Stockout Risk 25pts, Understock 25pts, Dead Stock Value share 25pts, Overstock 15pts, Slow-moving 10pts (max addressable penalty = 100). Fully documented in-code, not a black box.

## 6. Testing report

- **Backend:** `npx tsc --noEmit` clean, except the same pre-existing Sprint 3B test-file issue already documented in Sprint 3C's report (`warehouseTransferStock.test.ts`, unrelated, not touched). `npx vitest run` — **153/153 pass** (27 new + 126 prior). New: `inventoryIntelligenceService.test.ts` (23 — all pure formula functions, including a named regression guard proving box_sft value uses SFT qty, not box qty), `inventoryIntelligenceService.query.test.ts` (4 — join shapes for stock aging, warehouse/godown value, and 90-day COGS).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the pre-existing `portalService.ts` issue, as every prior sprint reports). `npx vitest run` — **290/290 pass** (10 new + 280 prior). `npm run build` succeeds cleanly.

## 7. Manual QA checklist

- [ ] **Low Stock tab** — set Min/Max Stock on a product; confirm its status badge updates (understock if free stock < min, overstock if > max, reorder if ≤ reorder_level with no thresholds set).
- [ ] **Stock Aging tab** — confirm bucket counts match the actual age of your dealer's oldest batches (spot-check one batch's `created_at` against its displayed age).
- [ ] **ABC/XYZ tab** — confirm your highest-value products appear first and the cumulative % column is monotonically increasing to 100%.
- [ ] **Value & Turnover tab** — confirm Stock Value ≈ sum of Warehouse Value entries (they should reconcile, since warehouse_stock mirrors the same underlying quantities) — see the known limitation below.
- [ ] **Health Dashboard tab** — confirm the score moves sensibly (drops) after intentionally setting a Min Stock above current free stock on a product. Confirm the "View in Reports"/"Open Auto-PO" links land on the correct existing pages.
- [ ] Confirm the Reports Hub's Dead/Slow/Fast Moving reports and `/purchases/auto-draft` still work exactly as before — nothing regressed (neither was touched).
- [ ] Confirm Products, Inventory (3A), Warehouses (3B), and Reservations (3C) pages still work exactly as before.

**Known limitation (documented, not a bug):** Warehouse/Godown Value may not sum exactly to Stock Value for a dealer whose stock hasn't been organized into warehouses/godowns via Sprint 3B transfers yet — `warehouse_stock`/`godown_stock` are caches populated only by transfers (per Sprint 3B's own documented characteristic), while `stock` is the always-current aggregate. This is inherited from Sprint 3B, not introduced here.

## 8. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every change is additive; the 4 modified existing files (`index.ts`, `demandPlanning.ts`, `App.tsx`, `navConfig.ts`) only gained new lines.
3. **DB rollback:** migration `088`'s `down()` drops `product_stock_thresholds`. No existing table's data is touched.
4. **Partial rollback:** the new nav item, route, and page can be hidden independently of the backend (which would simply go unused).

## 9. Explicitly out of scope (per Sprint 3D instructions — not done)

- Sales workflow, Quotation workflow, Sales Order, Invoice, Delivery — untouched.
- Shade recommendation engine — not built (Sprint 3C laid the reservation/allocation foundation; no matching engine was added here or there).
- Customer workflow, POS, Barcode/QR, CRM — not implemented.
- Dead/Slow/Fast-Moving analysis and Reorder/Purchase Suggestions were NOT rebuilt — they already existed in full and are linked from the new Health Dashboard instead.
