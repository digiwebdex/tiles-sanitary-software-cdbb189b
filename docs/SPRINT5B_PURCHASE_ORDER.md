# V2 Sprint 5B — Purchase Order (Completion Report)

**Branch:** `v2/sprint-5b-purchase-order` (based on `v2/sprint-5a-supplier-purchase-foundation`, tip `2db48b3`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 1 through 5A are frozen — Product, Inventory, Sales, and the Sprint 5A Purchase Foundation (Supplier fields/ledger, Purchase Request, RFQ) are untouched. Goods Receipt, Inventory Receiving, Batch Receiving, Purchase Invoice, Supplier Payment, Landed Cost, Import LC, Accounting Posting, and Purchase Return are explicitly out of this sprint's scope and were not built.

---

## 1. Files Changed

### New files

| File | Purpose |
|---|---|
| `backend/src/db/migrations/094_purchase_order_workflow.ts` | `purchase_orders`, `purchase_order_items`, `purchase_order_approvals` tables; PO numbering sequence/function; `whatsapp_message_type` enum + `whatsapp_settings` columns for PO sharing. |
| `backend/src/routes/purchaseOrders.ts` | Full CRUD, clone, workflow transitions, RFQ→PO conversion, supplier last-purchase-rate lookup, email endpoint. |
| `backend/src/routes/purchaseOrders.query.test.ts` | Query-shape, schema, and numbering tests. |
| `src/services/purchaseOrderService.ts` | Frontend service wrapper for all `/api/purchase-orders` endpoints. |
| `src/pages/purchase-orders/PurchaseOrdersPage.tsx` | List (search/status filter/pagination). |
| `src/pages/purchase-orders/CreatePurchaseOrder.tsx` | Create/edit form (supplier picker, product picker with last-purchase-price hint, discount, totals). |
| `src/pages/purchase-orders/PurchaseOrderDetail.tsx` | Detail view — workflow actions, approval history, supplier integration panel, print/PDF/email/WhatsApp. |
| `src/test/purchaseOrderService.test.ts`, `src/test/whatsappService.sprint5b.test.ts` | New test coverage. |

### Modified files (all additive)

| File | Change |
|---|---|
| `backend/src/index.ts` | Mounted `/api/purchase-orders`. |
| `backend/src/routes/whatsapp.ts` | +`purchase_order_share` to the log-creation zod enum; +2 new settings fields on `PUT /settings`. |
| `src/services/whatsappService.ts` | +`purchase_order_share` to `WhatsAppMessageType`; +`buildPurchaseOrderMessage()` template (addressed to a supplier, unlike every other template which addresses a customer); +2 new `WhatsAppSettings` fields. |
| `src/components/whatsapp/WhatsAppDashboardWidgets.tsx`, `WhatsAppSettingsCard.tsx`, `src/pages/whatsapp/WhatsAppLogsPage.tsx` | +1 label/config entry each for the new message type (these are `Record<WhatsAppMessageType, ...>` exhaustive maps — TypeScript itself required these three files to acquire an entry the moment the union type gained a new member; no other logic in them was touched). |
| `src/App.tsx`, `src/config/navConfig.ts` | New routes (`/purchase-orders*`) and a nav entry under the existing "Purchase" section. |

---

## 2. Database Impact

**Purely additive.** 3 new tables, 1 new sequence column + function on `invoice_sequences`, 1 new enum value on `whatsapp_message_type`, 2 new columns on `whatsapp_settings`. No existing table/column renamed, retyped, dropped, or given a new default. Every purchase, supplier, RFQ, or WhatsApp log/setting created before this migration behaves identically.

A new Purchase Order table was used instead of reusing `purchases` (which already has an unused `document_status` enum with `draft`/`pending_approval` values) — for the same reason Sprint 4B kept `sales_orders` separate from `sales`: `purchases` deducts/adds stock and posts ledger entries immediately on create, and a Purchase Order must not touch either until Goods Receipt exists (a future sprint).

**Design note on the status list:** the sprint brief's 8 listed statuses (draft, pending_approval, approved, sent, partially_received, fully_received, cancelled, closed) do not include "Rejected," even though "Reject Purchase Order" is a required action. Since the user did not respond when asked to confirm, this was resolved as: **reject sends a pending-approval PO back to `draft`** for revision (recorded in the new `purchase_order_approvals` history table with the reviewer's note) rather than introducing an unlisted 9th status. This is a judgment call, not a certainty — flagged here for review; the alternative (a distinct terminal `rejected` status, mirroring how Purchase Request's reject worked in Sprint 5A) would be a small, isolated change to the CHECK constraint and the `/reject` handler if this call was wrong.

`partially_received`/`fully_received` are set via a manual, administrative-only action (`mark-partially-received`/`mark-fully-received`) with **no stock or batch effect** — Goods Receipt/Batch Receiving remain unbuilt. This mirrors the exact precedent `sales_orders.delivery_readiness` set in Sprint 4B before Delivery execution existed in 4C.

## 3. API Impact

| Change | Compatibility |
|---|---|
| `/api/purchase-orders*` (17 endpoints — list/get/create/update/delete/clone/submit/approve/reject/send/mark-partially-received/mark-fully-received/close/cancel/from-rfq/last-purchase-rate/email) | Entirely new route tree; zero changes to any existing endpoint. |
| `POST /api/whatsapp/logs`, `PUT /api/whatsapp/settings` | Additive — `purchase_order_share` is a new accepted `message_type`/settings-key value; every existing value and existing caller is unaffected. |

## 4. UI Impact

- New "Purchase Orders" nav item under the existing "Purchase" section, and 3 new routes (`/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/:id[/edit]`).
- WhatsApp Settings page gains a 6th toggle/template row ("Purchase Order Share"), matching the existing 5 exactly.
- No existing page's layout, route, or behavior was changed — the 3 modified WhatsApp label-map files each gained exactly one new entry to satisfy TypeScript's exhaustiveness check on the widened `WhatsAppMessageType` union.

### A note on "PDF"/"Email"/"WhatsApp" — what "reuse existing infrastructure" actually means here

Inspection found that none of these three are what their names imply elsewhere in this app:
- **"PDF"** is always `window.print()` (browser print-to-PDF) everywhere in this codebase — there is no real PDF-file generator (no jsPDF/puppeteer/etc.) anywhere, and Invoice's own "PDF" button is literally aliased to its "Print" button today. Purchase Order's Print and PDF buttons both call `window.print()` on a dedicated `#po-print-area`, matching this exact existing convention.
- **"Email"** (`notificationService.sendEmail()`) sends text/HTML only — no attachment support exists anywhere in this codebase. Purchase Order's Email button sends a formatted HTML summary (PO number, items, totals, notes) in the email body, not a file attachment.
- **"WhatsApp"** is click-to-chat only (`wa.me` links + a log table, requiring a human to press send in their own WhatsApp app) — there is a *separate* automated WasenderAPI integration (`notificationService.sendWhatsApp`) in this codebase, but it's used exclusively for system notifications (OTP, subscription reminders, trial expiry) and never for sharing a business document with a customer or supplier, so it was correctly left alone. Purchase Order's WhatsApp button mirrors Quotation's own wiring exactly: `buildPurchaseOrderMessage()` + the existing `SendWhatsAppDialog`.

This keeps every communication feature within "reuse existing infrastructure" rather than quietly introducing new PDF-generation or email-attachment capability that doesn't exist anywhere else in the app.

## 5. Testing Report

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing `warehouseTransferStock.test.ts` issue every prior sprint's report documents). `npx vitest run` — **275/275 pass** (14 new + 261 prior). New: `purchaseOrders.query.test.ts` — list/last-purchase-rate query shape, item/status/reject-reason zod schemas, numbering call shape, approval-history shape, RFQ→PO supplier-grouping logic.
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **366/366 pass** (12 new + 354 prior). New: `purchaseOrderService.test.ts` (9), `whatsappService.sprint5b.test.ts` (3 — covers only the new `buildPurchaseOrderMessage` template; the pre-existing template functions had no prior coverage and are unchanged). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).
- **Backend production build:** `cd backend && npm run build` — only the same pre-existing, unrelated `warehouseTransferStock.test.ts` TS18048 errors documented in every prior sprint.
- **Not performed in this environment:** live interactive click-through testing (no browser available here) — the Manual QA checklist below should be run against a real dealer account.

## 6. Manual QA Checklist

- [ ] **Create → Submit → Approve** — create a draft PO with a supplier and 2+ items, submit for approval, confirm it gets a `PO-00001`-style number; as a dealer_admin, approve it; confirm the Approval History shows both events.
- [ ] **Reject → revise → resubmit** — submit a PO, reject it with a reason; confirm it returns to Draft (not a separate "Rejected" list), the reason appears in Approval History, and it can be edited and resubmitted.
- [ ] **Non-admin gating** — as a non-admin role, confirm Approve/Reject are hidden on a pending-approval PO.
- [ ] **Send → mark received → close** — approve a PO, mark it Sent, then Mark Partially Received, then Mark Fully Received, then Close; confirm each transition updates the status badge and that **no stock or batch record is created or changed** by any of these actions.
- [ ] **Cancel** — cancel a draft and a sent PO; confirm both move to Cancelled with the reason recorded.
- [ ] **Clone** — clone an existing PO; confirm the new one is a draft with the same supplier/items/discount but its own new ID, and `cloned_from_id` traces back to the original.
- [ ] **Edit/Delete gating** — confirm Edit and Delete are only available while a PO is in Draft.
- [ ] **RFQ → PO conversion** — approve an RFQ (Sprint 5A) with lines split across 2 different winning suppliers; convert it to Purchase Order(s); confirm **one PO per distinct supplier** is created, each carrying only its own lines at the quoted rate, and each PO shows the RFQ as its source.
- [ ] **Supplier panel** — open a PO for a supplier with existing purchase history; confirm Credit Limit, Outstanding Payables, Last Purchase date, and Performance Score all display and match what the Supplier's own edit page shows.
- [ ] **Last purchase price hint** — add a product to a new PO for a supplier who has been bought from before; confirm the "Last price" hint appears under that line with the correct historical rate.
- [ ] **Print / PDF** — open a PO, click Print and PDF; confirm both open the browser's print dialog showing a clean PO document (no app chrome).
- [ ] **Email** — for a supplier with an email on file, click Email; confirm a message arrives (or an SMTP-not-configured error surfaces clearly if this dealer has no SMTP settings).
- [ ] **WhatsApp** — click WhatsApp; confirm the dialog prefills the supplier's phone and a PO summary message, and that submitting opens WhatsApp with that text (no file attached — expected).
- [ ] Confirm existing Suppliers, Purchase Requests, RFQs, Purchases, Purchase Returns, and WhatsApp Settings/Logs pages are all unaffected.

## 7. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit — every backend change is additive (new routes, new enum value, new optional settings columns); no existing route, component, or business rule was altered.
3. **DB rollback:** migration `094`'s `down()` cleanly drops all 3 new tables, the new sequence function/column, and the 2 new `whatsapp_settings` columns, in FK-safe order. **Caveat:** PostgreSQL cannot remove an enum value once added, so `whatsapp_message_type`'s new `purchase_order_share` value is left in place on rollback — harmless (matches how every prior enum-extending migration in this codebase already handles this), since nothing will write that value once the feature is rolled back.
4. **Partial rollback:** the Purchase Order pages/routes can be hidden independently of the WhatsApp/Email extension (or vice versa) since they only meet at the Detail page's communication buttons.

## 8. Explicit Out-of-Scope List

- Goods Receipt (GRN), Inventory Receiving, Batch Receiving — `mark-partially-received`/`mark-fully-received` are administrative status markers only; no `stock`, `stock_ledger`, or `product_batches` row is ever touched by this sprint.
- Purchase Invoice, Supplier Payment, Landed Cost, Import LC, Accounting Posting, Purchase Return — none built; a Purchase Order never creates a `purchases` row itself (that conversion is a future sprint's job).
- Product Master, Inventory Engine, Sales Engine — untouched.
- A new approval role — reuses the existing `dealer_admin` permission model exactly as instructed; no new role introduced.
- Real PDF-file generation, email attachments, and WhatsApp Business/Cloud API integration — none of these exist anywhere in this codebase today, so building them would have been introducing new infrastructure rather than reusing existing infrastructure (see §4 above for what was built instead).
- A distinct terminal "Rejected" status — not introduced, per the design note in §2; flagged as a judgment call since the user's own confirmation request went unanswered.
