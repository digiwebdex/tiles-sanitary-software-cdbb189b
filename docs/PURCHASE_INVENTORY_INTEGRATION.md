# Purchase ↔ Inventory Integration Contract

**Written as of:** V2 Sprint 5C (Goods Receipt / GRN). This document is the frozen integration contract between the Purchase-side domain (Purchase Request → RFQ → Purchase Order → Goods Receipt) and the Inventory domain (Stock, Warehouse/Godown/Rack/Bin, Batch, Stock Ledger, Availability, Inventory Intelligence) as it exists after Sprint 5C. It exists so a future sprint extending either side can see exactly what's already wired, what's reused vs. newly built, and which contracts must not be broken.

---

## 1. Inventory APIs reused

| API / function | Source (frozen sprint) | How Sprint 5C uses it |
|---|---|---|
| `getDefaultWarehouseId(trx, dealerId)` | `backend/src/services/warehouseTransferStock.ts` (Sprint 3B) | Called directly, unmodified, when a GRN line doesn't specify a warehouse — resolves the dealer's default/oldest active warehouse. |
| `GET /api/warehouses`, `GET /api/godowns`, `GET /api/racks`, `GET /api/bins` | Sprint 3B | Read-only, used by the GRN item form's cascading location picker (`src/services/warehouseService.ts`/`godownService.ts`/`rackService.ts`/`binService.ts`, all pre-existing). |
| `computeAvailability(dealerId, productId)`, `computeBatchAvailability(dealerId, productId)` | `backend/src/services/availabilityService.ts` (Sprint 3C) | **Not called directly by any Sprint 5C code** — GRN doesn't need to invoke these. They read `stock.total_pieces` and `product_batches.total_pieces` live on every call, so as long as GRN writes those columns correctly (which it does, via the shared posting service), Availability reflects received stock automatically with zero additional wiring. |
| `getDemandRows`, `getInventoryHealth`, `getInventoryAnalytics`, `getLowStockView`, `getInventoryValue`, `getInventoryTurnover`, `getStockAging` | `backend/src/services/inventoryIntelligenceService.ts` + `backend/src/routes/demandPlanning.ts` (Sprint 3D) | Same as above — not called directly. All are live queries against `stock`, `product_batches`, `warehouse_stock`, `godown_stock`; correct GRN writes flow through automatically. |

## 2. Warehouse APIs reused

- The full Warehouse → Godown → Rack → Bin hierarchy (`warehouses`, `godowns`, `racks`, `bins` tables; Sprint 3B, migration `086_warehouse_godown_rack_bin.ts`) is reused as-is for GRN's location picker.
- `warehouse_stock`, `godown_stock`, `rack_stock` (Sprint 3B/086) are the location-tier quantity tables GRN writes to. **`bin_stock` does not exist and was deliberately not created** — bins are a location *label* only in this codebase (migration 086's own comment: "no stock is tracked at bin granularity"). A GRN line may record `bin_id` for traceability, but no quantity aggregate is maintained at that tier.
- **Prior to Sprint 5C, nothing wrote to `warehouse_stock`/`godown_stock`/`rack_stock` on receipt** — `purchases.ts`'s existing atomic flow only ever updated the dealer-wide `stock` table. Sprint 5C is the first code path that actually receives goods into a specific warehouse/godown/rack.

## 3. Stock services reused

- The dealer-wide `stock` table (aggregate `box_qty`/`piece_qty`/`sft_qty`/`total_pieces`/`average_cost_per_unit`, keyed by `dealer_id`+`product_id`) is updated by GRN using the **exact same formulas** `purchases.ts` already uses for its own atomic create flow — same weighted-average-cost recompute, same `total_pieces` derivation from `unit_type`/`pieces_per_box`. This logic could not be imported directly (it's inline in `purchases.ts`'s POST handler, and `purchases.ts` is frozen), so it was re-implemented, behaviorally identical, in `backend/src/services/receivingStockPosting.ts` — the single shared module GRN's own endpoints call, so GRN itself never duplicates this logic across its own call sites.
- `stock_ledger` (Sprint 2, migration `018_box_piece_units.ts`) receives a new row per GRN line, `txn_type='grn_receipt'`, `reference_table='goods_receipts'` — a new, distinct transaction type from `purchases.ts`'s own `'purchase_in'`, so the two receiving paths remain distinguishable in every existing report/audit view that reads `stock_ledger.txn_type`.
- The pre-existing DB trigger `trg_stock_ledger_to_movements` (Sprint 3D, migration `060_stock_movements.ts`) fires automatically on every `stock_ledger` insert and creates a matching `stock_movements` row — GRN relies on this unmodified trigger, then does one supplementary `UPDATE` (via `stock_ledger_id`) to backfill `warehouse_id`/`godown_id`/`rack_id`/`batch_id` on that row, since the trigger itself leaves those columns null (as it also does for `purchases.ts`'s own inserts today).

## 4. Batch services reused

- `product_batches` (Sprint 3D, migration `022_phase3_missing_tables.ts`) — GRN reuses the exact same null-safe find-or-create identity match `purchases.ts` uses (`dealer_id + product_id + batch_no + shade_code + caliber + lot_no`, each nullable column matched with `whereNull` when absent), re-implemented in `receivingStockPosting.ts` for the same "frozen file, can't import" reason as above.
- `batches.ts` (read-only by explicit prior-sprint design) is untouched — all batch mutation continues to happen only via write paths like this one, never through that route file.
- **Genuinely new, not a redesign:** `product_batches` has no `manufacturing_date` column and never has. Sprint 5C stores `manufacturing_date` at the per-receipt-event level, on `goods_receipt_items` — a deliberate choice, since a single batch identity can legitimately be topped up across multiple GRNs with different manufacturing dates, so it cannot correctly live as a single value on the aggregate batch row.

## 5. Inventory Intelligence reused

No Inventory Intelligence code was modified or directly invoked. All of `inventoryIntelligenceService.ts`/`demandPlanning.ts`'s exported functions perform live Knex queries against `stock`, `product_batches`, `warehouse_stock`, `godown_stock` at call time (confirmed by direct inspection — no materialized view, cache, or denormalized summary table exists anywhere in either file). Because Sprint 5C's shared posting service updates these exact tables using the same field conventions the rest of the app already relies on (notably: `demandPlanning.ts` sums `box_qty + piece_qty` while `availabilityService.ts` uses `total_pieces` — GRN updates all three fields together on every write, exactly as `purchases.ts` already does, so neither read path can disagree), every one of these read paths reflects a completed GRN automatically, with no explicit refresh/invalidation step required anywhere in this codebase.

One known, pre-existing gap intentionally left alone: `availabilityService.ts` hardcodes "incoming from purchases" to `0` (with its own comment inviting a future sprint to wire it from open Purchase Orders). That file is frozen (Sprint 3C) and out of reach for Sprint 5C.

## 6. Purchase Order integration

- `purchase_orders.status` already allowed all 8 documented values as of Sprint 5B's own migration (`094_purchase_order_workflow.ts`) — Sprint 5C introduces **zero schema change** to `purchase_orders` or `purchase_order_items`. GRN completion performs a plain `UPDATE purchase_orders SET status = ...` using a value that already existed in that CHECK constraint.
- **Received/Pending quantity per PO line is computed live**, not stored: `SUM(goods_receipt_items.received_qty)` grouped by `purchase_order_item_id`, joined through `goods_receipts` filtered to `status='completed'`. This was a deliberate choice over adding a stored counter column to the frozen `purchase_order_items` table — a live aggregate can never drift out of sync with the actual GRN records, since it *is* the actual GRN records.
- PO status transitions Sprint 5C drives automatically: `approved`/`sent`/`partially_received` → `partially_received` (some but not all lines fully covered) or → `fully_received` (every line's received total meets or exceeds its ordered quantity). The two earlier transitions (`draft`→`approved`→`sent`) remain exactly what Sprint 5B already built (manual dealer_admin actions) — Sprint 5C only drives the last two, since those are the ones an actual receiving event should cause.
- `purchase_order_approvals` (Sprint 5B's approval-history table) gets one new row per GRN completion, `action='received'` — an additive widening of that table's own CHECK constraint (Sprint 5B's original list did not include this value). This gives a PO's full timeline (submit/approve/reject/send/**receive**/cancel/close) in one place without needing a separate GRN-specific history view.

## 7. Receiving flow (end-to-end)

```
Purchase Order (approved / sent / partially_received)
        │
        ▼
Create GRN (draft) ── pick PO → prefill pending lines (ordered − already received)
        │              per line: batch_no / lot_no / shade_code / caliber /
        │              manufacturing_date, Warehouse → Godown → Rack → Bin
        ▼
Edit / Delete draft (freely, no stock effect yet)
        │
        ▼
Complete GRN ── validates: PO receivable-status gate, over-receive gate,
        │        quantity > 0 gate — all inside one DB transaction
        ▼
For each line, receivingStockPosting.postGoodsReceiptLine():
        │  1. find-or-create product_batches (null-safe identity match)
        │  2. update dealer-wide stock (+ weighted-average-cost recompute)
        │  3. update warehouse_stock / godown_stock / rack_stock (if specified)
        │  4. insert stock_ledger row (txn_type='grn_receipt')
        │     → DB trigger auto-creates a stock_movements row
        │  5. backfill that stock_movements row's warehouse/godown/rack/batch_id
        ▼
Recompute PO status from aggregate received-vs-ordered across ALL PO lines
        │
        ▼
purchase_orders.status → partially_received | fully_received
purchase_order_approvals += one 'received' row
        │
        ▼
Availability Engine / Inventory Intelligence reflect the change on their
very next read — no additional code path involved.
```

## 8. Frozen integration contracts

These are the specific guarantees this sprint depends on, and that a future sprint must not silently break:

1. **`stock.total_pieces`, `stock.box_qty`, `stock.piece_qty` must always be updated together, consistently.** `availabilityService.ts` reads `total_pieces`; `demandPlanning.ts` reads `box_qty + piece_qty`. Any future write path to `stock` must update all three or these two engines will disagree.
2. **`product_batches`' identity is `(dealer_id, product_id, batch_no, shade_code, caliber, lot_no)`**, matched null-safe. Any future batch-writing code must use the same matching rule `purchases.ts` and `receivingStockPosting.ts` both already use, or duplicate/fragmented batch rows will result.
3. **`bin_stock` does not exist.** Any future feature needing bin-level quantity would require a genuinely new table and migration — do not assume one exists, and do not add quantity columns to `bins` itself (bins are dealer_id/rack_id/bin_code/storage_location/rack_position/is_active only).
4. **`purchases.ts` remains the only path that touches `supplier_ledger`/`cash_ledger`/`bank_ledger`/tax-posting for a purchase.** GRN — and any future Purchase-Invoice/Landed-Cost sprint building on top of GRN — must not duplicate that financial posting; it should be layered on top of (or reuse) `purchases.ts`'s own financial logic when that sprint eventually arrives, not reinvented inside the GRN domain.
5. **`stock_ledger.txn_type` values are a free-text convention, not an enum** — `'purchase_in'` (purchases.ts) and `'grn_receipt'` (this sprint) must both stay distinct and stable, since any report grouping by `txn_type` depends on that.
6. **A completed `goods_receipt`/`goods_receipt_item` is immutable.** No code path reverses a completed GRN's stock effect. If a future sprint needs a Purchase-Return-style reversal, it must be built as a new, explicit feature (mirroring how Sales Return/Purchase Return already exist as their own distinct workflows elsewhere in this app) — not as a "delete/edit" on a completed GRN.
