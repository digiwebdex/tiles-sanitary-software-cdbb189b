# V2 Sprint 4B — Sales Order & Reservation Integration (Change Record)

**Branch:** `v2/sprint-4b-sales-order-reservation` (based on `v2/sprint-4a-customer-quotation-foundation`, tip `72c35d5`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 2 through 4A (Product Master → Customer & Quotation Foundation) are frozen — no file any of those sprints created or modified was touched. Invoice, Challan, Payment collection, VAT posting, POS, Sales Return, Exchange, Warranty, Barcode/QR, and Accounting posting are all explicitly out of scope and untouched.

---

## 1. Inspection — what already existed vs. what's genuinely new

Unlike Sprints 3D/4A (where most requested areas turned out to already be built), Sprint 4B's core entity — **Sales Order** — did **not exist anywhere** in the codebase. This was confirmed by inspection before any code was written:

| Sprint 4B requirement | What already existed | Verdict |
|---|---|---|
| **Sales Order** (create/edit/cancel/approve, status, numbering, salesperson, project ref) | Nothing. The `sales` table is Invoice-equivalent: `POST /api/sales` either deducts stock immediately via FIFO batch allocation and posts VAT/ledger (`sale_type='direct_invoice'`), or defers to Challan (`sale_type='challan_mode'`) — a payment-deferral mechanism, not a pre-commitment stage. No `sales_orders` table or concept existed. | 🆕 Genuinely new core entity |
| **Quotation → Sales Order conversion** | `quotations.ts` has `POST /:id/conversion-prefill`, but it is built specifically for the flat Sale form: it collapses per-line discounts into one quotation-level amount and drops `rate_source`/`tier_id`/`preferred_shade_code`/`preferred_caliber`/`preferred_batch_no` per line — unsuitable for a Sales Order's line-level fidelity requirement. | 🆕 New, separate endpoint (existing endpoint untouched) |
| **Inventory Integration** (Availability Engine, Reservation Engine, Warehouse/Godown/Rack, Batch/Lot) | All exist and fully functional from Sprint 3B/3C: `availabilityService.ts` (`computeAvailability`, `computeBatchAvailability`), `create_stock_reservation`/`release_stock_reservation` RPCs, `stock_reservations` table with location tags. | ✅ Reused, unmodified |
| **Reservation Integration** (auto-reserve on confirm, release on cancel, update on qty change, partial handling) | The reservation RPCs exist, but nothing in the codebase calls them from a Sale/Order flow — `sales.ts`'s `POST /api/sales` makes zero calls to `consume_reservation_for_sale` or any reservation route; it deducts stock directly via a different RPC (`allocate_sale_batches`). | 🆕 Genuinely new orchestration, reusing existing RPCs unchanged |
| **Batch/Lot/Shade Selection + Caliber validation** | `product_batches` (shade/caliber/lot columns) and `GET /api/batches` (read-only listing) already exist from Sprint 3B/3D. Quotation lines already carry `preferred_shade_code`/`preferred_caliber`/`preferred_batch_no` as free-text preferences. | ✅ Reused; caliber cross-check is new, informational-only |
| **Delivery Planning** (readiness, full/partial planning, planned date) | `challans`/`deliveries` model *actual* delivered state only — no "planned" or forward-looking concept exists anywhere. | 🆕 New fields on `sales_orders` only — no Challan/Delivery execution touched |

**Critical finding that shaped the design:** `create_stock_reservation` (Sprint 3C RPC, unmodified) only validates against `product_batches` capacity when a `batch_id` is supplied. For a product-level reservation (`batch_id IS NULL`) it unconditionally increments `stock.reserved_*_qty` with **no availability check at all**. This means "handle partial reservations if stock is limited" had to be implemented by capping the request against `computeAvailability()`/`computeBatchAvailability()` *before* calling the RPC — never by modifying the RPC itself.

---

## 2. What Sprint 4B ADDED

### Database (migration `090_sales_orders.ts` — purely additive)

- **New table `sales_orders`**: `so_number` (assigned on confirm via a new sequence function, `SO-DRAFT-{timestamp}` placeholder at draft creation), `status` (CHECK: `draft`/`confirmed`/`partially_delivered`/`completed`/`cancelled`), `customer_id` (nullable, same walk-in fallback pattern as `quotations`), `quotation_id` (nullable FK — conversion audit trail), `project_id`/`site_id` (optional project reference), `salesperson_id` (nullable `uuid`, no hard FK — matches the existing loose "who did this" convention used elsewhere), `planned_delivery_date`, `delivery_readiness` (CHECK: `pending`/`ready`/`partially_ready`), `confirmed_by`/`confirmed_at`, `cancelled_by`/`cancelled_at`/`cancel_reason`.
- **New table `sales_order_items`**: mirrors `quotation_items`' pricing fields (`rate`, `discount_value`, `line_total`, `rate_source`, `tier_id`, `preferred_shade_code`/`caliber`/`batch_no`) plus `reservation_id` (FK → `stock_reservations`), `reserved_qty` (actual reserved amount — may be less than `quantity` under partial-stock conditions), `delivered_qty` (schema-only; present for the `partially_delivered`/`completed` statuses but not written to by this sprint's logic — Challan/Delivery execution is out of scope).
- **New column** `invoice_sequences.next_sales_order_no` + **new function** `generate_next_sales_order_no(_dealer_id uuid)` — mirrors `generate_next_quotation_no()` (migration `008_p1_hardening.ts`) verbatim: same row-locking `SELECT ... FOR UPDATE` pattern, same `ON CONFLICT DO NOTHING` upsert, producing `'SO-' || lpad(...)`.
- **New nullable columns on `quotations`**: `converted_sales_order_id`, `converted_to_so_by`, `converted_to_so_at` — a **separate** audit trail from the existing `converted_sale_id`/`converted_by`/`converted_at` columns, so the pre-existing Quotation→Sale path and the new Quotation→Sales-Order path coexist without ambiguity.
- No changes to `stock_reservations`, `product_batches`, `sales`, `quotation_items`, or any other existing table/column.

### Backend

| File | Change |
|---|---|
| `backend/src/services/salesOrderService.ts` | **New** — pure business-logic functions (no DB access), same extraction pattern as `availabilityService.ts`/`inventoryIntelligenceService.ts`: `calcLineTotal`/`calcTotals` (mirrors `quotations.ts` exactly), `computeReservableQty` (caps a requested reservation at real availability, converting pieces ↔ native box/piece units), `hasCaliberMismatch` (case/whitespace-insensitive comparison, informational only), `computeDeliveryReadiness` (derives `pending`/`ready`/`partially_ready` from how much of each product line is actually reserved). |
| `backend/src/routes/salesOrders.ts` | **New** — full CRUD + lifecycle. `GET /`, `GET /:id`, `GET /:id/items` (enriches with caliber-mismatch flag + reservation status); `POST /` and `PUT /:id` (draft-only, same field/validation shape as `quotations.ts`); `DELETE /:id` (draft-only); `POST /:id/confirm` ("Approve" — assigns `so_number`, then per line item calls `computeAvailability`/`computeBatchAvailability` to cap the reservable qty before calling `create_stock_reservation` directly, tagging `source_type='sales_order'`/`source_id=<item id>` via the same "apply tags after RPC" follow-up-UPDATE technique Sprint 3C's own route uses for `kind`/`priority`); `POST /:id/cancel` (releases every item's active reservation via `release_stock_reservation`, requires a reason); `PATCH /:id/items/:itemId` (quantity change on a confirmed order — releases the old reservation, re-reserves at the new capped quantity); `PATCH /:id/delivery-planning` (planned date / readiness, manual override); `POST /from-quotation/:quotationId` (conversion — copies every quotation line field verbatim into a new draft Sales Order, never auto-confirms). |
| `backend/src/index.ts` | +2 lines: import + `app.use('/api/sales-orders', salesOrdersRoutes)`. |

**Deliberately NOT touched:** `backend/src/services/availabilityService.ts`, `backend/src/routes/reservations.ts`, `backend/src/routes/quotations.ts`'s existing `/conversion-prefill`/`/link-to-sale` handlers, `backend/src/routes/sales.ts`, `allocate_sale_batches`. The confirm/cancel/item-edit logic calls `create_stock_reservation`/`release_stock_reservation` **directly** (the same RPCs `reservations.ts` calls), not via an HTTP self-call to `/api/reservations` — this mirrors how Sprint 3C's own `PATCH /api/reservations/:id` inlines the release+create pattern rather than composing two HTTP requests.

**Business rule surfaced during design, not assumed:** `stock_reservations.customer_id` is `NOT NULL`. A Sales Order for a walk-in customer (no `customer_id`) can be created and edited as a draft, but **cannot be confirmed** — `POST /:id/confirm` returns a 400 asking the user to link a registered customer first. This is a direct, documented consequence of reusing the Reservation Engine unmodified, not a new restriction invented for its own sake.

### Frontend

| File | Change |
|---|---|
| `src/services/salesOrderService.ts` | **New** — mirrors `quotationService.ts`'s shape; one method per backend endpoint. |
| `src/modules/salesOrders/salesOrderSchema.ts` | **New** — Zod schema mirroring `quotationSchema.ts` (customer-or-walk-in refinement, item array). |
| `src/modules/salesOrders/SalesOrderForm.tsx` | **New** — create/edit draft (mirrors `QuotationForm.tsx`'s structure): customer picker, salesperson picker (reuses `teamService.list()`), `ProjectSitePicker` reuse, planned delivery date, product/custom line items reusing `AvailabilityCell.tsx` (Sprint 4A, unmodified) and `pricingTierService` for tier-rate resolution. "Save Draft" and "Save & Confirm" (create/update, then immediately calls `confirm()`, surfacing any partial-reservation warnings via toast). |
| `src/modules/salesOrders/SalesOrderList.tsx` | **New** — mirrors `QuotationList.tsx`: search/status/project filters, table, pagination. |
| `src/modules/salesOrders/SalesOrderDetailDialog.tsx` | **New** — status badge, Approve/Cancel actions, delivery-planning editor (planned date + readiness override), per-line reservation status (`reserved/quantity`), caliber-mismatch warning, and an inline quantity editor for confirmed orders (calls the item-qty-update endpoint). |
| `src/components/salesOrder/SalesOrderStatusBadge.tsx` | **New** — mirrors `QuotationStatusBadge.tsx`. |
| `src/pages/salesOrders/{SalesOrdersPage,CreateSalesOrder,EditSalesOrder}.tsx` | **New** — thin page wrappers, mirroring the `pages/quotations/*` pattern exactly. |
| `src/modules/quotations/QuotationDetailDialog.tsx` | **+1 button**: "Convert to Sales Order" next to the existing "Convert to Sale" button (shown under the same `canConvert` condition). Calls the new `createFromQuotation` endpoint and navigates to the new order's edit page. The existing "Convert to Sale" button, its handler, and the `conversion-prefill` flow are untouched. |
| `src/App.tsx` | +3 routes: `/sales-orders`, `/sales-orders/new`, `/sales-orders/:id/edit`. |
| `src/config/navConfig.ts` | +1 nav item ("Sales Orders", gated by the existing `quotations` plan feature — no new plan-feature flag was introduced for this). |

---

## 3. Database impact

**Purely additive.** 2 new tables, 1 new column + 1 new function on the shared `invoice_sequences` table, 3 new nullable columns on `quotations`. No existing table/column is renamed, retyped, or dropped; no existing default changes. Every quotation, sale, reservation, or customer created before this migration behaves identically.

## 4. API impact

| Change | Compatibility |
|---|---|
| **New** `/api/sales-orders/*` routes | New surface; nothing pre-existing changed. |
| `quotations.ts` | **Zero changes** — confirmed via `git diff` against `72c35d5`; the file does not appear in this sprint's diff. |
| `reservations.ts`, `availabilityService.ts`, `sales.ts` | **Zero changes** — the new route calls their RPCs/functions directly but does not modify them. |
| Existing Quotation→Sale conversion (`conversion-prefill`, `link-to-sale`) | **Zero changes** — a separate, new conversion path was built instead of modifying this one. |

## 5. Testing report

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing Sprint 3B `warehouseTransferStock.test.ts` issue every prior sprint's report documents — unrelated, not touched). `npx vitest run` — **196/196 pass** (32 new + 164 prior). New: `salesOrderService.test.ts` (22 — `calcLineTotal`/`calcTotals`/`computeReservableQty`/`hasCaliberMismatch`/`computeDeliveryReadiness`), `salesOrders.query.test.ts` (10 — list-query `.toSQL()` shape + Zod schema defaults/enum coverage).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue every prior sprint's report documents). `npx vitest run` — **306/306 pass** (9 new + 297 prior). New: `salesOrderService.test.ts` (9 — one test per API method, request-shape + error-propagation). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as before this sprint — not new).

## 6. Manual QA checklist

- [ ] **Create a Sales Order** — pick a customer, add 2 product lines + 1 custom line, set a salesperson and planned delivery date, "Save Draft". Confirm it lists with a temporary `SO-DRAFT-…` number and status "Draft".
- [ ] **Edit the draft** — change quantities/discount, re-save; confirm totals recompute.
- [ ] **Confirm ("Approve") with plentiful stock** — confirm status becomes "Confirmed", a real `SO-00001`-style number is assigned, and every line shows `reserved = quantity`. Cross-check in Inventory → Reservations that a new reservation row exists per line (`source_type='sales_order'`).
- [ ] **Confirm with limited stock** — set a line's quantity above available stock; confirm it still confirms successfully but shows a toast warning and the line's reserved amount is capped at what's actually available.
- [ ] **Confirm a walk-in (no linked customer) order** — confirm it's rejected with a clear message asking to link a customer first.
- [ ] **Edit a line's quantity on a confirmed order** — confirm the old reservation is released and a new one created at the updated quantity (check Reservations list for the swap).
- [ ] **Cancel a confirmed order** — confirm all its reservations release (status becomes "released" in Reservations) and the order becomes "Cancelled".
- [ ] **Delivery Planning** — on a confirmed order's detail view, change the planned delivery date and manually override readiness; confirm both save.
- [ ] **Caliber mismatch** — set a line's preferred caliber to something that doesn't match the named batch's real caliber; confirm a warning appears on the detail view (and does *not* block anything).
- [ ] **Quotation → Sales Order** — open an active quotation, click "Convert to Sales Order"; confirm a new draft order opens pre-filled with identical customer/pricing/discount/shade/caliber/batch data, and the source quotation shows the new audit-trail link.
- [ ] Confirm Quotation create/edit/finalize/cancel/revise/"Convert to Sale" all still work exactly as before (unchanged), and Inventory/Reservations/Availability pages from prior sprints are unaffected.

## 7. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every change is additive; the 2 modified existing files (`quotations.ts`'s detail dialog on the frontend, `index.ts`'s route registration) only gained a new button/route respectively.
3. **DB rollback:** migration `090`'s `down()` drops both new tables, the new function, the `invoice_sequences` column, and the 3 new `quotations` columns, in FK-safe order. No enum values were added, so there is nothing left un-droppable (unlike Sprint 4A's `customer_type` extension).
4. **Partial rollback:** the "Convert to Sales Order" button on the Quotation detail view can be hidden independently of the backend (which would simply go unused); the Sales Orders nav item and routes can likewise be hidden without touching any other module.

## 8. Explicitly out of scope (per Sprint 4B instructions — not done)

- Invoice, Challan, Payment collection, VAT posting, POS, Sales Return, Exchange, Warranty, Barcode/QR, Accounting posting — untouched.
- `sales_order_items.delivered_qty` exists in the schema (to support the `partially_delivered`/`completed` statuses) but nothing in this sprint writes to it — actual delivery execution remains a future sprint's responsibility.
- Automatic shade/caliber recommendation — not built; caliber checking here is a read-only informational flag, never a suggestion or auto-correction.
- No changes to Inventory, Product Master, Customer, or Quotation data models or business rules.
