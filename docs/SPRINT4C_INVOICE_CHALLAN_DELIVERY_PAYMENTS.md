# V2 Sprint 4C — Invoice, Challan, Delivery & Customer Payments (Completion Report)

**Branch:** `v2/sprint-4c-invoice-challan-delivery-payments` (based on `v2/sprint-4b-sales-order-reservation`, tip `b58aa88`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 2 through 4B (Product Master → Sales Order & Reservation Integration) are frozen — no file any of those sprints created or modified was touched in a way that changes its existing behavior. POS, Sales Return, Exchange, Warranty, General Ledger posting/Accounting Journal (beyond what already existed), Barcode/QR, CRM, Loyalty, Online Payment Gateway, and AI features are all explicitly out of scope and untouched.

---

## 1. Inspection — what already existed vs. what's genuinely new

This was, by a wide margin, the largest "already built" discovery in this series. Four parallel research passes over `sales.ts`, `challans.ts`, `deliveries.ts`, `collections.ts`, and the whole codebase's VAT/payment infrastructure found that **nearly every requested area already exists and works today** — a materially different picture from the sprint brief's framing of Invoice/Challan/Delivery/Payments/VAT as things to "implement."

| Sprint 4C requirement | What already existed | Verdict |
|---|---|---|
| **Draft Invoice, Invoice Status, Invoice Number** | The `sales` table **is** the Invoice. `sale_type='challan_mode'` creates it as `sale_status='draft'`/`document_status='draft'`, already numbered (`generate_next_invoice_no` → `INV-00001`) at creation. | ✅ Fully built |
| **Edit Draft Invoice** | `PUT /api/sales/:id`, blocked once `document_status='posted'`. | ✅ Fully built |
| **Approve Invoice** | `POST /api/challans/convert-invoice/:saleId` — deducts reserved stock for real, posts customer/cash/bank ledger + VAT/tax posting lines, flips to `sale_status='invoiced'`/`document_status='posted'`. | ✅ Fully built (the sprint's "Approve" maps onto this existing action) |
| **Cancel Invoice** | `DELETE /api/sales/:id` (pre-post) or `POST /api/sales/:id/reverse` (post-post, full reversal with restored stock + reversed ledger entries). | ✅ Fully built |
| **Invoice Audit Trail** | Every mutation already writes to `audit_logs`. | ✅ Fully built (data layer) |
| **Invoice Timeline** | No consolidated, single view assembling create/challan/delivery/payment events chronologically for one invoice. | 🆕 Genuine gap — read-only aggregation |
| **Create Invoice from Sales Order** | `sales` had no `sales_order_id` concept at all; nothing bridged Sprint 4B's Sales Order to an actual Invoice. | 🆕 Genuine gap — see §2 |
| **Delivery Challan** (generate/print/status/notes/driver/vehicle) | Full challan lifecycle already exists: create (reserves stock), edit, cancel (restores stock), deliver, delivery-status, numbering, print (`ModernChallanDocument.tsx`), `driver_name`/`transport_name`/`vehicle_no`/`notes` columns. | ✅ Fully built |
| **Driver Phone, Delivery Schedule** | `driver_name`/`vehicle_no` existed; a phone field and a planned-vs-actual delivery date did not. | 🆕 Small additive gap |
| **Delivery Timeline** | Same gap as Invoice Timeline — no consolidated view (the new Invoice Timeline endpoint already includes challan/delivery events since they're keyed by `sale_id`, so no separate endpoint was needed). | 🆕 Covered by the same new endpoint |
| **Full/Partial/Scheduled Delivery, Delivery History** | `deliveries`/`delivery_items` with an over-delivery guard, fulfillment-status sync, batch tracking, full list/detail already exist. | ✅ Fully built |
| **Delivery Confirmation** | Status could be flipped to `'delivered'` but nothing recorded *who/when* confirmed it as a distinct, audited moment. | 🆕 Small additive gap |
| **Customer Payments** (receive/partial/due/history/status; cash/bank/cheque/bKash/Nagad/SSLCommerz/card) | `collections.ts` + `customerPayment.ts` (FIFO allocation across oldest-due invoices, bank-account-aware receipts, full payment-mode infrastructure) — all live, already routed. | ✅ Fully built |
| **Rocket** | Not in the existing payment-mode list (cash/bank/bkash/nagad/sslcommerz/cheque/card). | 🆕 Small additive gap |
| **Advance Payment Adjustment** | `recordCustomerPayment()` **rejects** a payment with no outstanding due sale ("No outstanding invoices to apply payment") — a customer literally could not pay in advance. | 🆕 Genuine gap — see §2 |
| **VAT Calculation, Amount, Breakdown** | `vatMath.ts` (`computeVatBreakdown`), `sales.taxable_amount`/`vat_rate`/`vat_amount`/`sd_amount`, dealer `vat_enabled`/`default_vat_rate` settings, `tax_posting_lines`, and a full Bengali/English Mushak-6.3 tax invoice print template (`VatTaxInvoiceDocument.tsx`) — all already built and wired into every VAT-enabled sale. | ✅ Fully built |
| **VAT Summary, VAT Ready Reports** | Backend endpoints already existed (`GET /api/reports/vat/sales-register`, `/purchase-register` — Mushak 6.3/6.1 style, Phase 5 P5-04) but **had no frontend page** — the data was reachable only by direct API call. | 🆕 Frontend-only gap |
| **Inventory Posting** (reuse Availability/Reservation/Stock Ledger) | Fully satisfied by reusing the existing `POST /api/sales` reservation-consumption path for the new Sales-Order-to-Invoice flow (see §2) — no new inventory math anywhere. | ✅ Reused, zero duplication |
| **Printable Sales Invoice + Delivery Challan** | `SaleInvoiceDocument.tsx` / `VatTaxInvoiceDocument.tsx` (invoice) and `ModernChallanDocument.tsx` (challan) already exist, already wired to print via the established `window.open` + `innerHTML` pattern. | ✅ Fully built — nothing to add |

---

## 2. What Sprint 4C ADDED

### The one substantial new capability: Sales Order → Invoice

No `sales.sales_order_id` column or conversion path existed. Rather than duplicating `sales.ts`'s ~700-line FIFO/backorder/VAT/ledger creation logic (a hard rule of this sprint), the design mirrors the **already-proven Quotation → Sale pattern** end-to-end:

1. **`POST /api/sales-orders/:id/invoice-prefill`** (new, additive endpoint on Sprint 4B's own `salesOrders.ts`) — read-only. Validates the order is `confirmed`/`partially_delivered` and not already converted, then returns a prefill payload shaped exactly like the existing Sale-creation form's inputs: `customer_name`, `items` (`product_id`, `quantity`, `sale_rate`), `discount`, `notes`, `project_id`/`site_id` — **plus** `reservation_selections`, built from each Sales Order item's existing `reservation_id`/`reserved_qty`.
2. The frontend's "Create Invoice" button (`SalesOrderDetailDialog.tsx`) navigates to the **existing, unmodified** `/sales/new` form with this prefill — the exact same mechanism `QuotationDetailDialog.tsx`'s "Convert to Sale" already uses.
3. `SaleForm.tsx` gained one new optional prop (`initialReservationSelections`) to seed its own pre-existing reservation-picker state from the prefill — the manual reservation-consumption UI it already has for regular sales.
4. On submit, the **existing, unmodified** `POST /api/sales` runs its full normal flow: fresh availability/backorder check, VAT, COGS, numbering, ledger posting — and, because `reservation_selections` is populated, calls the existing `consume_reservation_for_sale` RPC to close out the Sales Order's reservation (this RPC only releases the reservation *hold*; the actual stock deduction is the same FIFO/batch logic every sale already does — confirmed by reading `sales.ts`'s reservation-handling block directly).
5. `POST /api/sales-orders/:id/link-to-sale` (new, additive, mirrors `quotations.ts`'s own `link-to-sale`) then records the audit trail.

**Zero new inventory, VAT, or COGS math was written.** The only genuinely new code is the prefill-building and audit-linking — the conversion is 100% orchestration over already-existing, already-tested logic.

### Database (migration `091_invoice_challan_delivery_payments.ts` — purely additive)

- **`sales_orders`**: `converted_sale_id`, `converted_to_sale_by`, `converted_to_sale_at` — mirrors `quotations`' own conversion-audit columns from Sprint 4A/4B.
- **`challans`**: `driver_phone`, `scheduled_delivery_date` (both nullable).
- **`deliveries`**: `confirmed_by`, `confirmed_at` (both nullable) — stamped automatically the moment a delivery's status is set to `'delivered'`.
- **New table `customer_advance_applications`**: `dealer_id, customer_id, sale_id, amount, applied_by, applied_at` — tracks how much of a received advance has been applied to which invoice (see Customer Payment Flow, §5).
- No existing table/column renamed, retyped, or dropped.

### Backend

| File | Change |
|---|---|
| `backend/src/routes/salesOrders.ts` | +2 endpoints: `POST /:id/invoice-prefill`, `POST /:id/link-to-sale` (additive; zero existing Sprint 4B endpoints touched). |
| `backend/src/routes/sales.ts` | +1 endpoint: `GET /:id/timeline` (Invoice Timeline). |
| `backend/src/services/invoiceTimelineService.ts` | **New** — aggregates `audit_logs` (sale + its challans + its deliveries) and `customer_ledger` payment rows into one chronological list. Pure `mergeTimelineEvents()` extracted for testability. |
| `backend/src/services/advancePaymentService.ts` | **New** — `receiveAdvancePayment`, `getAdvanceBalance`, `applyAdvanceToSale`. Reuses `postCustomerReceipt()` (Sprint 4A/P1-04, unmodified) for the actual cash/bank ledger entry. |
| `backend/src/routes/collections.ts` | +3 endpoints: `POST /advance`, `GET /advance-balance`, `POST /advance/apply`. |
| `backend/src/routes/challans.ts` | `driver_phone`/`scheduled_delivery_date` added to the create/update Zod schemas and insert/update statements (additive optional fields; every existing caller that omits them is unaffected). |
| `backend/src/routes/deliveries.ts` | `PATCH /:id/status` now stamps `confirmed_by`/`confirmed_at` when (and only when) the new status is `'delivered'` — additive, no change for any other status value. |
| `backend/src/lib/paymentModes.ts` | Added `rocket` to `PAYMENT_MODES` and `receiptPostingLineType()`. |
| `backend/src/index.ts` | **Not touched** — no new route files were mounted (all additions live in already-mounted route files). |

**Deliberately NOT touched:** `sales.ts`'s `POST /` handler (the ~700-line creation logic), `availabilityService.ts`, `reservations.ts`, `salesOrders.ts`'s existing confirm/cancel/item-edit/delivery-planning endpoints, `quotations.ts`, any Product Master/Inventory/Warehouse file, `customerStatements.ts` (the customer due-balance formula) — the Advance Payment design specifically avoids touching this frozen file by reusing the existing `'payment'` ledger type with `sale_id = NULL`, which the formula already treats as a credit.

### Frontend

| File | Change |
|---|---|
| `src/services/salesOrderService.ts` | +2 methods (`getInvoicePrefill`, `linkToSale`) + 3 new interface fields. |
| `src/modules/salesOrders/SalesOrderDetailDialog.tsx` | +1 "Create Invoice" button + a "View invoice" link once converted. |
| `src/pages/sales/CreateSale.tsx` | Generalized the existing Quotation-prefill handling to also accept a Sales-Order-shaped prefill (customer/items/discount/notes/project/site/**reservation_selections**) and link back via the new endpoint on success. |
| `src/modules/sales/SaleForm.tsx` | +1 optional prop (`initialReservationSelections`) to seed its pre-existing reservation-picker state. |
| `src/services/salesService.ts` | +1 method (`getTimeline`). |
| `src/components/sale/InvoiceTimeline.tsx` | **New** — read-only timeline card, wired into `InvoicePage.tsx`. |
| `src/services/collectionsService.ts` | +3 methods (`recordAdvance`, `getAdvanceBalance`, `applyAdvance`). |
| `src/modules/collections/AdvancePaymentDialog.tsx` | **New** — mirrors the existing Collect-Payment dialog's payment-mode/bank-account picker. |
| `src/modules/collections/CollectionTracker.tsx` | +1 "Advance" button + dialog wiring. |
| `src/pages/sales/InvoicePage.tsx` | +"Apply Advance" quick action (shown only when the customer has an unapplied balance) + the new Invoice Timeline card. |
| `src/services/vatReportService.ts` | **New** — thin client over the existing `/api/reports/vat/*` endpoints. |
| `src/pages/reports/VatReportsPage.tsx` | **New** — VAT Summary cards + Sales/Purchase register tables, 100% reused backend data. |
| `src/services/challanService.ts`, `src/pages/sales/ChallanPage.tsx`, `src/components/challan/ModernChallanDocument.tsx` | `driver_phone`/`scheduled_delivery_date` threaded through the existing edit UI (both the "classic" and "modern" challan templates). |
| `src/modules/deliveries/DeliveryDetailDialog.tsx` | The previously-hardcoded "Received by: —" footer field now shows the real `confirmed_at` timestamp. |
| `src/lib/paymentModes.ts` | Added `rocket`; `isMobileOrGatewayMode()` now includes it. |
| `src/App.tsx` / `src/config/navConfig.ts` | +1 route + +1 nav item ("VAT Reports", `dealer_admin` only, matching the backend's own role gate). |

---

## 3. Database Impact

**Purely additive.** 1 new table (`customer_advance_applications`), 8 new nullable columns across 3 existing tables (`sales_orders` ×3, `challans` ×2, `deliveries` ×2, plus none needed on `sales`/`customer_ledger`/`customers` since the Advance Payment design deliberately reuses the existing `customer_ledger.sale_id` nullable column instead of adding a new one). No existing column renamed, retyped, dropped, or given a new default. Every sale, challan, delivery, reservation, or payment created before this migration behaves identically.

## 4. API Impact

| Change | Compatibility |
|---|---|
| `POST /api/sales-orders/:id/invoice-prefill`, `POST /api/sales-orders/:id/link-to-sale` | New; zero changes to any existing Sales Order endpoint. |
| `GET /api/sales/:id/timeline` | New; zero changes to any existing Sales endpoint — confirmed the only change to `sales.ts` is this one addition. |
| `POST /api/collections/advance`, `GET /api/collections/advance-balance`, `POST /api/collections/advance/apply` | New; zero changes to the existing `/payment`/`/adjustment`/`/outstanding` endpoints. |
| `challans.ts` create/update schemas | Additive optional fields — every existing caller (which never sends `driver_phone`/`scheduled_delivery_date`) is byte-for-byte unaffected. |
| `deliveries.ts` `PATCH /:id/status` | Additive side effect (stamps 2 new columns only when status becomes `'delivered'`) — response shape unchanged. |
| `POST /api/sales` (creation) | **Zero changes** — confirmed via diff; the Sales-Order-to-Invoice flow calls this exact endpoint unmodified. |
| `/api/reports/vat/*` | **Zero changes** — a frontend consumer was added, the backend routes/service were not touched. |

## 5. Inventory Integration

No inventory calculation was duplicated anywhere in this sprint:
- **Sales Order → Invoice** reuses the existing `POST /api/sales` reservation-consumption path unmodified (see §2) — the same FIFO batch allocation, backorder logic, and `consume_reservation_for_sale` RPC every other sale already uses.
- **Challan create/cancel** stock reserve/unreserve and **Delivery** creation's over-delivery guard, fulfillment-status sync, and batch tracking (`execute_delivery_batches`) are entirely pre-existing and were not touched.
- The Availability Engine and Reservation Engine (Sprint 3C) were not modified; Stock Ledger rows continue to be written exactly as before.

## 6. Customer Payment Flow

- **Cash/Bank/Cheque/bKash/Nagad/SSLCommerz/Card**: pre-existing, unchanged, still validated by `paymentModeRequiresBankAccount()`.
- **Rocket**: added to the shared payment-mode list (backend + frontend); requires no bank account (mobile wallet, like bKash/Nagad), gets its own posting-line suffix (`receipt_rocket`) for traceability.
- **Advance Payment** (new): `POST /api/collections/advance` inserts a `customer_ledger` row with `type='payment'` and `sale_id = NULL`, posted through the exact same `postCustomerReceipt()` every other payment uses. Because `customerStatements.ts`'s due-balance formula already treats any `'payment'` row as a credit regardless of `sale_id`, the advance correctly reduces the customer's overall due balance the moment it's received — **without touching that frozen file**. `POST /api/collections/advance/apply` later moves the credit onto a specific invoice (updates that sale's own `paid_amount`/`due_amount`, records the application in the new tracking table) **without** inserting a second ledger credit, so the cash is never double-counted. `GET /api/collections/advance-balance` reports what's left unapplied.
- Existing FIFO payment allocation, follow-ups, and bank-account infrastructure — all untouched.

## 7. VAT Flow

Entirely reused, nothing recalculated:
- `computeVatBreakdown()` (VAT-exclusive: `total = taxable + vat + sd`), dealer `vat_enabled`/`default_vat_rate` settings, per-sale `taxable_amount`/`vat_rate`/`vat_amount`/`sd_amount`, and `tax_posting_lines` all continue exactly as before.
- The new VAT Reports page is a pure read view over the pre-existing `GET /api/reports/vat/sales-register` (Mushak 6.3) and `/purchase-register` (Mushak 6.1) endpoints — VAT Summary (output/input/net payable), full row-level breakdown, and period filtering, with zero new backend calculation.
- Full NBR filing/export remains explicitly out of scope, as instructed.

## 8. Testing Results

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing Sprint 3B `warehouseTransferStock.test.ts` issue every prior sprint's report documents). `npx vitest run` — **217/217 pass** (21 new + 196 prior). New: `advancePaymentService.test.ts` (4), `invoiceTimelineService.test.ts` (3), `paymentModes.test.ts` (5, Rocket-specific), `collections.advance.query.test.ts` (6), `challans.schema.test.ts` (3).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **322/322 pass** (28 new + 294 prior). New/extended: `salesOrderService.test.ts` (+2), `collectionsService.test.ts` (+4), `paymentModes.test.ts` (+4, frontend Rocket coverage), `salesService.getTimeline.test.ts` (3), `vatReportService.test.ts` (3). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).

## 9. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit(s) — every backend/frontend change is additive; no existing route, component, or business rule was altered in a way that changes prior behavior for a dealer who takes no new action.
3. **DB rollback:** migration `091`'s `down()` cleanly drops `customer_advance_applications` and all 8 new nullable columns, in FK-safe order — no orphaned enum values, no data loss for any pre-existing row.
4. **Partial rollback:** the "Create Invoice" button, "Advance"/"Apply Advance" actions, VAT Reports nav entry, and the driver-phone/scheduled-date form fields can each be hidden independently of the backend (which would simply go unused) without touching any other feature.

## 10. Manual QA Checklist

- [ ] **Sales Order → Invoice**: confirm a Sales Order with plentiful stock, click "Create Invoice," verify the Sale form is prefilled (customer, items, discount, project/site) with the reservation pre-selected in the reservation picker; submit and confirm the created Sale shows `sale_status='invoiced'`, stock was deducted once (not twice), and the Sales Order now shows a "View invoice" link.
- [ ] **Sales Order → Invoice with partial reservation**: repeat with a Sales Order where stock was short at confirm time; verify the invoice creation still succeeds, using fresh availability at invoice time for any shortfall (existing backorder behavior).
- [ ] **Invoice Timeline**: open an invoice that has a challan, a delivery, and a payment; confirm all four kinds of events (create, challan generated, delivered, payment received) appear in chronological order.
- [ ] **Challan driver phone / scheduled date**: edit an existing challan, set a driver phone and a scheduled delivery date, save, and confirm both persist and print correctly on both the classic and modern challan templates.
- [ ] **Delivery confirmation**: mark a delivery as "delivered"; confirm the detail view now shows a real confirmed-at timestamp instead of the previous placeholder.
- [ ] **Rocket payment**: record a customer payment choosing "Rocket" as the mode; confirm no bank account is required and the receipt shows the Rocket label.
- [ ] **Advance payment**: on a customer with zero due invoices, click "Advance," record ৳1,000; confirm it succeeds (previously this would have failed) and the customer's due balance/collections list reflects the credit.
- [ ] **Apply advance**: create a new invoice for that customer; open it, confirm an "Apply Advance" button appears capped at the invoice's due amount; apply it and confirm the invoice's due amount drops and the remaining advance balance decreases accordingly (not double-counted).
- [ ] **VAT Reports**: open the new VAT Reports page, pick a date range covering known VAT sales, confirm the Sales Register rows/totals match what's shown on those invoices, and that Output VAT / Input VAT / Net Payable summary cards compute correctly.
- [ ] Confirm existing Sales, Challan, Delivery, Collections, and Sales Order workflows (create/edit/cancel/approve/reverse) all still work exactly as before.

---

## 11. Explicitly out of scope (per Sprint 4C instructions — not done)

POS, Sales Return, Exchange, Warranty, General Ledger posting/Accounting Journal beyond what already existed, Barcode/QR, CRM, Loyalty, Online Payment Gateway, AI features — none touched. Full NBR e-filing was also explicitly excluded and not built.
