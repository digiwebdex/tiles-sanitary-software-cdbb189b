# V2 Sprint 5C — Goods Receipt (GRN) (Completion Report)

**Branch:** `v2/sprint-5c-goods-receipt` (based on `v2/sprint-5b-purchase-order`, tip `4681d00`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 1 through 5B are frozen — Product, Inventory, Sales, and Purchase Order are untouched. Purchase Invoice, Supplier Payment, Accounting Posting, Import LC, Landed Cost, Purchase Return, Barcode, QR, Quality Inspection, and Warranty are explicitly out of this sprint's scope and were not built.

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `backend/src/db/migrations/095_goods_receipt.ts` | `goods_receipts`, `goods_receipt_items` tables; GRN numbering sequence/function; additive extension of `purchase_order_approvals.action` to include `'received'`. |
| `backend/src/services/receivingStockPosting.ts` | Shared stock-posting service reused across GRN's own endpoints — batch find-or-create, dealer-wide `stock` + weighted-average-cost recompute, `warehouse_stock`/`godown_stock`/`rack_stock` updates, `stock_ledger` insert with `stock_movements` location/batch backfill. |
| `backend/src/routes/goodsReceipts.ts` | Full CRUD, complete (posts stock, updates PO status), cancel, pending-lines lookup. |
| `backend/src/routes/goodsReceipts.query.test.ts`, `backend/src/services/receivingStockPosting.test.ts` | Query-shape, schema, and pure-formula tests. |
| `src/services/goodsReceiptService.ts` | Frontend service wrapper for all `/api/goods-receipts` endpoints. |
| `src/pages/goods-receipts/GoodsReceiptsPage.tsx` | List (search/status filter/pagination). |
| `src/pages/goods-receipts/CreateGoodsReceipt.tsx` | Receive a Purchase Order — PO picker, prefills pending lines, per-line batch/lot/shade/caliber/manufacturing-date + cascading Warehouse→Godown→Rack→Bin picker. |
| `src/pages/goods-receipts/GoodsReceiptDetail.tsx` | Detail view — complete/cancel/edit/delete, per-line received location display. |
| `src/test/goodsReceiptService.test.ts` | New test coverage. |

### Modified files (all additive)

| File | Change |
|---|---|
| `backend/src/index.ts` | Mounted `/api/goods-receipts`. |
| `src/App.tsx`, `src/config/navConfig.ts` | New routes (`/goods-receipts*`) and a nav entry under the existing "Purchase" section. |

**Not touched:** `backend/src/routes/purchases.ts`, any Sprint 5B file (`purchaseOrders.ts`, `purchase_orders`/`purchase_order_items` schema), any Sprint 3B/3C file (`warehouses.ts`, `godowns.ts`, `racks.ts`, `bins.ts`, `availabilityService.ts`, `warehouseTransferStock.ts`), any Sprint 3D file (`inventoryIntelligenceService.ts`, `demandPlanning.ts`).

---

## 2. Database Impact

**Purely additive.** 2 new tables (`goods_receipts`, `goods_receipt_items`), 1 new sequence column + function on `invoice_sequences`, and one additive widening of `purchase_order_approvals.action`'s CHECK constraint (adds `'received'` to the allowed list — every existing row's value is untouched). **No column was added to `purchase_orders` or `purchase_order_items`** — Received/Pending quantity per PO line is computed live by aggregating `goods_receipt_items` rows for completed GRNs, joined on `purchase_order_item_id`, rather than a stored counter that could drift.

**No table from any frozen sprint was altered.** In particular, `purchases`/`purchase_items` (the pre-existing combined order+receipt+invoice flow) are completely unaffected — GRN is a parallel, new path for the quantity-only receiving of a Purchase Order.

## 3. API Impact

| Change | Compatibility |
|---|---|
| `/api/goods-receipts*` (9 endpoints — list/get/create/update/delete/complete/cancel/pending-for-po) | Entirely new route tree; zero changes to any existing endpoint. |

## 4. UI Impact

- New "Goods Receipt (GRN)" nav item under the existing "Purchase" section, and 4 new routes.
- No existing page was modified. Following the same discipline this engagement has used at every sprint boundary (verified directly: Sprint 5B's own RFQ→PO conversion never added a button to the frozen `RfqDetail.tsx` from Sprint 5A), **`PurchaseOrderDetail.tsx` (Sprint 5B, frozen) was not touched** — there is no "Receive" button on it. GRN's own "Receive Purchase Order" flow is a self-sufficient entry point: the GRN list page's own "Receive Purchase Order" button opens a page with its own PO search/picker (mirroring `CreatePurchaseOrder.tsx`'s own supplier picker), and it also accepts an optional `?fromPurchaseOrder=<id>` query parameter for direct linking.

---

## 5. Testing Report

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing `warehouseTransferStock.test.ts` issue every prior sprint's report documents). `npx vitest run` — **298/298 pass** (23 new + 275 prior). New: `goodsReceipts.query.test.ts` (14 — list/pending-aggregation query shape, item/status zod schemas, receivable-PO-status gate, over-receive-prevention logic, PO-status-recompute logic, RFQ-style supplier-grouping N/A here but PO status transition logic covered), `receivingStockPosting.test.ts` (9 — weighted-average-cost formula, total_pieces computation, batch identity matching, all as pure-function tests independent of any DB, mirroring how `computeSupplierBalance` is tested elsewhere).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **373/373 pass** (7 new + 366 prior). New: `goodsReceiptService.test.ts` (7). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).
- **Backend production build:** `cd backend && npm run build` — only the same pre-existing, unrelated `warehouseTransferStock.test.ts` TS18048 errors documented in every prior sprint.
- **Not performed in this environment:** live interactive click-through testing (no browser available here) — the Manual QA checklist below should be run against a real dealer account.

## 6. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit — every backend change is additive (new tables, new route tree, one widened CHECK constraint); no existing route, component, table, or business rule was altered.
3. **DB rollback:** migration `095`'s `down()` cleanly drops both new tables, the new sequence function/column, and reverts `purchase_order_approvals.action`'s CHECK constraint to its Sprint 5B list, in FK-safe order — no data loss for any pre-existing purchase order, approval history row, or product batch. **Caveat:** if any GRN's completion already inserted a `purchase_order_approvals` row with `action='received'` before rollback, that row's value would violate the reverted (narrower) constraint — this is the same class of caveat every enum-widening migration in this codebase already carries (e.g. Sprint 5A/5B's own WhatsApp/PR extensions), and is only relevant if this migration is rolled back *after* being used in production, not before.
4. **Partial rollback:** GRN's own pages/routes can be hidden independently of everything else, since a GRN never mutates a frozen table's row shape — only the `purchase_orders.status` value and a `purchase_order_approvals` history row, both using pre-existing/already-allowed values.

## 7. Manual QA Checklist

- [ ] **Create → Complete (full receive)** — approve and send a Purchase Order (Sprint 5B), then create a GRN receiving the full ordered quantity of every line with a batch/warehouse selected; complete it; confirm the PO's status becomes `fully_received`.
- [ ] **Partial receive** — create a GRN receiving less than the ordered quantity for at least one line; complete it; confirm the PO's status becomes `partially_received`, and that a second GRN can be created against the same PO for the remaining quantity.
- [ ] **Over-receive prevention** — attempt to receive more than the remaining pending quantity on any line; confirm the completion is rejected with a clear error and no stock is posted.
- [ ] **Closed/Cancelled PO validation** — attempt to create or complete a GRN against a `draft`, `pending_approval`, `cancelled`, `closed`, or already-`fully_received` PO; confirm each is rejected.
- [ ] **Batch Receiving** — receive the same product with the same batch/lot/shade/caliber identity across two separate GRNs; confirm it tops up the *same* `product_batches` row rather than creating a duplicate (matches the existing `purchases.ts` null-safe matching exactly).
- [ ] **Warehouse Receiving** — receive into a specific Warehouse → Godown → Rack (Bin optional, since bins are location-tag-only); confirm `warehouse_stock`/`godown_stock`/`rack_stock` all increase by the received quantity, and that the Warehouse/Godown/Rack stock reports (existing pages) reflect it immediately.
- [ ] **Inventory Availability** — before and after completing a GRN, check a product's Availability (existing Availability Engine UI); confirm the on-hand/free-stock figure increases by exactly the received quantity with no manual refresh needed.
- [ ] **Inventory Intelligence** — check the existing Demand Planning / Low Stock / Inventory Value views before and after a GRN; confirm the product drops out of "low stock"/"reorder suggested" (if applicable) and the per-warehouse inventory value updates.
- [ ] **Draft edit/delete** — edit a draft GRN's quantities/batch info, save, and confirm the changes persist; delete a different draft GRN and confirm it disappears from the list with no stock effect.
- [ ] **Cancel** — cancel a draft GRN; confirm it moves to Cancelled and cannot be completed afterward.
- [ ] Confirm existing Purchases, Purchase Returns, Payables, Warehouses/Godowns/Racks/Bins pages, and Inventory Intelligence reports are all unaffected by this sprint.

## 8. Explicit Out-of-Scope List

- Purchase Invoice, Supplier Payment, Accounting Posting, Import LC, Landed Cost — GRN never writes to `supplier_ledger`, `cash_ledger`, `bank_ledger`, or any posting table; it uses only the Purchase Order line's own rate as the cost basis for the weighted-average recompute (no transport/labor/other cost fields).
- Purchase Return, Barcode, QR, Quality Inspection, Warranty — none built.
- `bin_stock` — deliberately **not created**. Bins remain a location *label* only (per Sprint 3B's own design — no stock is tracked at bin granularity); a GRN line may record which bin goods were placed in, but only Warehouse/Godown/Rack maintain real quantity aggregates.
- Backorder allocation on receipt — `purchases.ts`'s existing atomic flow allocates newly-received stock to waiting customer backorders (FIFO), but this is a Sales-domain side effect not listed in this sprint's own "Stock Posting" scope, and Sales is frozen. Deliberately **not implemented** in GRN; flagged here as a natural candidate for a future sprint, not silently dropped.
- Reversing/undoing a *completed* GRN — a completed GRN posts real stock and cannot be edited or cancelled (only a draft can be edited/deleted/cancelled). Reversing completed inventory receipts would be a Purchase-Return-adjacent concern, explicitly out of scope.
- Wiring `availabilityService.ts`'s hardcoded `incomingPurchasePieces = 0` to reflect open Purchase Order quantities — that file is frozen (Sprint 3C); its own comment already invites a future sprint to do this.
