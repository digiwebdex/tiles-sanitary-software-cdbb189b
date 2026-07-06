# V2 Sprint 5E — Purchase Return, Supplier Debit Note, Landed Cost, Batch Cost Update, Import LC

**Status:** Complete. Awaiting user approval. Branch: `v2/sprint-5e-purchase-return`, built on frozen tip `3644d1b` (Sprint 5D — Purchase Invoice).

## 0. Pre-Implementation Inspection Summary

Four parallel inspections were run before any code was written, covering all six scope areas:

| Area | What already existed | Genuine gap |
|---|---|---|
| Purchase Return | Pre-V2 "Phase 3N" feature: list + create pages, `backend/src/routes/returns.ts`, tables `purchase_returns`/`purchase_return_items`, a standalone FIFO stock-deduction function (`purchaseReturnStock.ts`). | No over-return guard (unlike Sales Return, in the same file), no Detail page, no Return Note, status hardcoded `'completed'`, zero linkage to the new PO→GRN→Invoice pipeline, and it predates Warehouse/Godown/Rack stock (doesn't touch it). |
| Supplier Debit Note | `POST /api/supplier-ledger-entries/debit-note` (Sprint 5D) — increases balance owed, for a different purpose (e.g. a supplier under-billing correction). | A return-driven balance reduction needed a **different**, new ledger entry type — see Design Decisions below. |
| Import LC / Shipment / Container / Customs / Port / C&F Agent / Vendor | Nothing — confirmed by exhaustive grep across migrations, routes, services, and frontend. | Fully greenfield. |
| Landed Cost | `landed_cost` = `qty×rate + transport/labor/other cost`, entered manually per line (pre-V2 quick-entry flow only). No shipment-level allocation exists anywhere. | Proportional-by-value allocation across invoice lines, applied to the already-posted weighted-average cost — entirely new. |
| Batch Cost Update | `product_batches` has **zero** cost columns — cost lives only on the dealer-wide `stock.average_cost_per_unit`. | "Batch Cost Update" is therefore a dealer-wide product cost adjustment, not a true per-batch override — documented transparently below. |

**Reused directly (no duplication):** `deductPurchaseReturnStock` (dealer-wide stock/batch/stock_ledger deduction), the weighted-average-cost qty-base conversion from `receivingStockPosting.ts`, `purchase_returns.purchase_id`'s existing FK to `purchases` (already works for a Purchase-Invoice-flow purchase, since Sprint 5D made an Invoice literally BE a `purchases` row), `productService`/`supplierService`/`purchaseService` list endpoints for pickers, `inventoryIntelligenceService.ts`'s live reads (zero wiring needed for "Inventory Value Update").

## 1. Design Decisions

Sprint 5E's Step 1 inspection surfaced three genuine forks. The user was asked via `AskUserQuestion`; **no response was given**, so the recommended default was used in each case, and is documented here transparently so it can be corrected if wrong:

1. **Purchase Return reduces what's owed to the supplier.** A NEW, distinct ledger entry type `'purchase_return'` (stored POSITIVE — same sign convention as `'credit_note'`/`'refund'`) was added, kept entirely separate from Sprint 5D's `'debit_note'` (which increases what's owed, for its own purpose, and is untouched).
2. **A completed Purchase Return only adjusts the running supplier balance — no automatic cash refund.** The legacy pre-V2 return flow (unmodified) still posts an instant cash refund; this sprint's new flow does not.
3. **Import LC is a BDT-only paperwork/status tracker.** No FX conversion — Multi-currency is explicitly out of scope this sprint. Amounts are BDT, with an optional free-text `currency_note` for context (e.g. "USD 12,000 @ approx rate").

A fourth, purely engineering decision (not user-facing): **`backend/src/routes/returns.ts` was not touched**, even though its Purchase Return section was never given its own frozen V2 sprint number — that file also holds genuinely frozen Sales Return code (Sprint 4D), so it was treated with the same discipline as any other frozen-adjacent file. All Sprint 5E Purchase Return capability lives in new files, reusing the same `purchase_returns`/`purchase_return_items` tables.

## 2. Files Changed

### Backend — new
- `backend/src/db/migrations/097_purchase_return_landed_cost_import_lc.ts` — additive schema for all six scope areas.
- `backend/src/services/returnStockPosting.ts` — reuses `deductPurchaseReturnStock` (unmodified) + adds the missing Warehouse/Godown/Rack deduction.
- `backend/src/routes/purchaseReturns.ts` — Purchase Return CRUD, complete/cancel, over-return prevention.
- `backend/src/routes/landedCostSheets.ts` — Landed Cost Sheet CRUD + apply (proportional allocation).
- `backend/src/routes/stockCostAdjustments.ts` — manual Batch/Stock Cost Update.
- `backend/src/routes/importLc.ts` — Proforma Invoice / Letter of Credit / Shipment (+ Containers).
- 4 new `*.query.test.ts` files — 40 new tests.

### Backend — modified
- `backend/src/index.ts` — registered the 4 new routers. No other line changed.

### Frontend — new
- `src/services/purchaseReturnV2Service.ts`, `landedCostSheetService.ts`, `stockCostAdjustmentService.ts`, `importLcService.ts`.
- `src/pages/purchase-returns-v2/{PurchaseReturnsV2Page,CreatePurchaseReturnV2,PurchaseReturnV2Detail}.tsx`.
- `src/pages/landed-cost/{LandedCostSheetsPage,LandedCostSheetDetail}.tsx`.
- `src/pages/stock-cost-adjustments/StockCostAdjustmentsPage.tsx`.
- `src/pages/import-lc/ImportLcPage.tsx`.

### Frontend — modified
- `src/App.tsx` — added imports + 8 new routes. No existing route changed.
- `src/config/navConfig.ts` — added 4 new nav entries under the existing "Purchase" section. No existing entry changed.

**Not touched (frozen or frozen-adjacent, referenced read-only):** `returns.ts`, `purchases.ts`, `purchaseOrders.ts`, `goodsReceipts.ts`, `purchaseInvoices.ts`, `supplierLedgerEntries.ts`, `purchaseReturnStock.ts`, `receivingStockPosting.ts`, `ledgerBalance.ts`, `inventoryIntelligenceService.ts`, `purchaseReturnService.ts` (legacy frontend service), `PurchaseReturnsPage.tsx`/`CreatePurchaseReturn.tsx` (legacy frontend pages, kept working exactly as before).

## 3. Database Impact

Migration `097` — purely additive, no destructive changes:

1. `purchase_return_items` — 4 new nullable columns: `source_purchase_item_id` (FK → `purchase_items`), `warehouse_id`/`godown_id`/`rack_id` (FK → respective tables). All `NULL` for every pre-existing row.
2. `ledger_entry_type` enum — adds `'purchase_return'` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
3. `supplier_ledger` — new nullable `purchase_return_id` (FK → `purchase_returns`).
4. New tables: `landed_cost_sheets`, `landed_cost_sheet_items`, `stock_cost_adjustments`, `import_proforma_invoices`, `import_letters_of_credit`, `import_shipments`, `import_shipment_containers`.

No existing table's meaning changes for any pre-existing row. Down-migration reverts all of the above; the `'purchase_return'` enum value cannot be removed by Postgres (harmless, matches every prior enum-extending migration).

## 4. API Impact

All new; no existing endpoint's behavior changed.

| Method & Path | Purpose |
|---|---|
| `GET /api/purchase-returns/purchases/returnable` | Posted purchases with remaining returnable quantity (picker) |
| `GET /api/purchase-returns/purchase/:purchaseId/lines` | Returnable lines for one purchase |
| `POST /api/purchase-returns` | Create draft return |
| `PUT /api/purchase-returns/:id` | Edit draft |
| `DELETE /api/purchase-returns/:id` | Delete draft |
| `GET /api/purchase-returns/:id` | Details (new — didn't exist anywhere before) |
| `POST /api/purchase-returns/:id/complete` | Post stock (dealer-wide + location-tier) + supplier ledger |
| `POST /api/purchase-returns/:id/cancel` | Cancel draft |
| `GET/POST /api/landed-cost-sheets`, `GET/POST /:id/apply`, `/:id/cancel` | Landed Cost Sheet lifecycle |
| `GET/POST /api/stock-cost-adjustments` | Manual cost adjustment + history |
| `GET/POST/PUT/DELETE /api/import-lc/proforma-invoices`, `/letters-of-credit`, `/shipments` | Import LC tracker |

**Reused unchanged:** `GET /api/returns/purchases` (legacy list, still shows all returns from both old and new creation paths since they share one table), `productService`/`supplierService`/`purchaseService` list endpoints (pickers).

## 5. UI Impact

New pages only; no existing page's markup or behavior changed.

- **Purchase Returns (V2)** (`/purchase-returns-v2`) — list, create (picker + partial/full qty), detail with Complete/Cancel/Delete and a printable Return Note (browser print, matching this codebase's existing PDF infrastructure).
- **Landed Cost** (`/landed-cost`) — list, create-against-a-posted-invoice dialog with all 8 charge fields, detail with Apply/Cancel and an allocation breakdown table once applied.
- **Stock Cost Update** (`/stock-cost-adjustments`) — manual adjustment form + unified history (manual + landed-cost-driven adjustments together).
- **Import LC** (`/import-lc`) — tabbed hub: Proforma Invoices, Letters of Credit, Shipments (with containers).

Nav: 4 new entries under the existing "Purchase" section; no existing entry moved or renamed.

## 6. Testing Report

- **Backend:** `npx tsc --noEmit` — clean. 40 new tests across 4 files, covering: query shapes, Zod schemas, over-return prevention math, return numbering, the `purchase_return` ledger sign convention, proportional-by-value landed cost allocation, the qty-base/average-cost adjustment formula, and Import LC schema validation. Full backend suite: **367/367 passing** (52 files) — no regressions.
- **Frontend:** `npx tsc --noEmit` (both tsconfigs) — 0 new errors (53 pre-existing `portalService.ts` errors confirmed present before this sprint). Full frontend suite: **373/373 passing** (57 files) — no regressions.
- **Backend production build:** succeeds; `dist/` includes all 4 new route files and migration 097. Same pre-existing `warehouseTransferStock.test.ts` errors as every prior sprint (not new, does not block emit).
- **Frontend production build:** succeeds. Same pre-existing >500kB chunk-size warning as every prior sprint.

## 7. Rollback Plan

1. `git revert` this sprint's commit — all changes are additive new files plus small, mechanical diffs (route registration, route/nav registration), so reverting is a clean no-op for every frozen feature.
2. Run migration `097`'s `down()`: drops all 7 new tables, drops the 4 new `purchase_return_items` columns, drops `supplier_ledger.purchase_return_id`. The `'purchase_return'` enum value cannot be removed by Postgres and is left in place — harmless, since no code references it once the routes are gone.
3. No data migration/backfill needed in either direction.

## 8. Manual QA Checklist

- [ ] Create a Purchase Return against a posted Purchase Invoice with full quantity — appears as `draft`.
- [ ] Attempt to return more than purchased on a line — rejected with a clear error.
- [ ] Create a Partial Return, complete it, then create a second return for the remainder — both succeed, line fully claimed on the second.
- [ ] Complete a return — stock deducted (dealer-wide +, if the source was GRN-received into a warehouse, the warehouse/godown/rack too), supplier balance owed reduced by the return total, no cash movement.
- [ ] Cancel a draft return — no stock/ledger effect, line becomes returnable again.
- [ ] Confirm the legacy `/purchase-returns` (old pages) still works exactly as before, including its own cash-refund behavior.
- [ ] Create a Landed Cost Sheet against a posted invoice with 2+ lines of differing value — apply it, confirm each line's allocated amount is proportional to its value and the affected products' average cost increases by `allocated/qty_base`.
- [ ] Attempt to apply an already-applied or cancelled sheet — rejected.
- [ ] Record a manual Stock Cost Update — history shows both manual and (if any) landed-cost-driven adjustments together.
- [ ] Create a Proforma Invoice, a Letter of Credit referencing it, and a Shipment with 2 containers — all save and display correctly; confirm amounts are BDT-only with no FX conversion attempted.

## 9. Out-of-Scope List

Per the sprint's explicit exclusions — none of the following were touched: General Ledger, Journal, Trial Balance, Balance Sheet, Profit & Loss, Bank Reconciliation, Multi-currency, Manufacturing.

Additional items deliberately left out or simplified, documented transparently:
- **True per-batch cost tracking** — no per-batch cost column exists anywhere in this codebase; "Batch Cost Update" is a dealer-wide product cost adjustment (`stock.average_cost_per_unit`), not a per-individual-batch override. Introducing real per-batch costing would require touching COGS/valuation across Sales and Inventory Intelligence — out of proportion for this sprint.
- **Retroactive COGS correction** — Landed Cost allocation (and manual cost adjustments) only affect the *current* average cost going forward; historical COGS on units already sold before the adjustment is not retroactively corrected. This is a standard limitation of every weighted-average-cost system in this codebase (none has per-batch cost tracking to do better).
- **Foreign-exchange conversion in Import LC** — amounts are BDT only, per the documented design decision above.
- **Automation between Import LC and the Purchase pipeline** — a Shipment may optionally reference the `purchases` row it eventually became, purely as a cross-reference for compliance paperwork. No stock or financial posting is triggered by that link; actual goods receipt continues through the existing PO → GRN → Invoice pipeline unchanged.
- **Edit UI for a draft return / sheet** — the backend has `PUT /api/purchase-returns/:id` for edits, but Landed Cost Sheets have no edit endpoint (cancel-and-recreate is the intended flow for a draft mistake, mirroring how Purchase Invoice's own scope only listed Draft/Finalize/Cancel, not Edit).
