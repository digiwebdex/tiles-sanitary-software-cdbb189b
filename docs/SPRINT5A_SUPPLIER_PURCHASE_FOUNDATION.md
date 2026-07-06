# V2 Sprint 5A — Supplier & Purchase Foundation (Completion Report)

**Branch:** `v2/sprint-5a-supplier-purchase-foundation` (based on `v2/sprint-4e-pos-modernization`, tip `fccfa03`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Product Master, Inventory Engine, Sales Engine, POS, Customer, Quotation, Sales Order, Invoice, Warehouse, Availability Engine, and Reservation Engine are frozen — none of those modules were touched. Purchase Order, Goods Receipt, Purchase Invoice, Supplier Payment, Import LC, Landed Cost, Purchase Return, and Accounting Posting are explicitly out of this sprint's scope and were not built.

---

## 1. Inspection — what already existed vs. what's genuinely new

Two parallel research passes (backend + frontend) plus direct verification of every load-bearing claim (one research pass made several incorrect claims — "no backend tests exist," "no inventory intelligence service file," "only 67 migrations" — all three were checked directly against the codebase and found wrong; the real numbers are 39 backend test files, a full `inventoryIntelligenceService.ts` with ABC/XYZ/health-score/turnover/aging, and migrations up to `092`).

| Area | What already existed | Verdict |
|---|---|---|
| **Supplier CRUD** | Full CRUD (`backend/src/routes/suppliers.ts`), list/form pages, Supplier Notes, Supplier Performance (reliability scoring, price trends) — more built out than Customer's equivalent. | ✅ Fully built |
| **Supplier Category / Group / Credit Limit** | Schema had only `name, contact_person, phone, email, address, gstin, opening_balance, status` (migration `001`) — no category/group/credit_limit columns anywhere. | 🆕 Genuine gap |
| **Supplier Ledger Summary** | Building blocks existed (`mv_supplier_payable` view, `computeSupplierBalance`/`computeSupplierOutstanding` in `lib/ledgerBalance.ts`, FIFO payment allocation) but nothing assembled them into a summary endpoint/view. | 🆕 Gap — wiring, not building from scratch |
| **Purchases** | Mature, single combined order+receipt+invoice workflow (`purchases.ts`) — no separate PO/GRN stages. Correctly out of scope; untouched. | ✅ Frozen context |
| **Purchase Request (PR)** | Nothing exists anywhere (exhaustive greps for requisition/purchase_request/requested_by all zero). | 🆕 Genuinely new |
| **RFQ** | Nothing exists. The existing `quotations` module is confirmed 100% customer-facing (quotes a price *to* a customer, converts to a Sale) — cannot be repurposed. | 🆕 Genuinely new |
| **Purchase Planning reuse targets** | Two mature, fully-wired subsystems: `inventoryIntelligenceService.ts`/`demandPlanning.ts`'s `getDemandRows()` (reorder signals, `suggested_reorder_qty`, flags) and `autoPo.ts`'s `GET /suggestions` (low-stock + last-supplier grouping). | ✅ Reused, not duplicated |

**Critical finding surfaced during inspection (not fixed — out of this sprint's stated scope):** `backend/src/routes/autoPo.ts` queries a `purchase_drafts`/`purchase_draft_items` table shape (`supplier_id`, `status`, `source`, `converted_purchase_id` columns, plus a whole sibling items table) that **does not exist on the VPS database**. The only Knex migration named `purchase_drafts` (050) created a completely different, incompatible table (a generic `label`+`payload jsonb` blob used by an unrelated "save as draft" feature in `purchases.ts`). The structured shape `autoPo.ts` expects only exists in the old Supabase migrations. This means `GET/POST/PATCH /api/auto-po/drafts*` almost certainly 500-errors in production today (the read-only `GET /api/auto-po/suggestions` is unaffected and was safely reused for Purchase Planning). This is a pre-existing bug, confirmed by direct migration/route cross-reference, flagged here for a future dedicated fix — this sprint's new tables (`purchase_requests`, `rfqs`, etc.) deliberately use distinct names so they don't collide with it.

---

## 2. What Sprint 5A ADDED

### Database (migration `093_purchase_request_rfq_supplier_foundation.ts` — purely additive)

- **`suppliers.category` / `supplier_group` / `credit_limit`** — mirrors exactly how migration `089` added `customer_group`/`default_discount_type` to `customers`.
- **PR/RFQ numbering** — `invoice_sequences.next_purchase_request_no` / `next_rfq_no` + `generate_next_purchase_request_no()` / `generate_next_rfq_no()`, the identical row-locked-sequence pattern migration `090` used for `generate_next_sales_order_no`.
- **`purchase_requests` / `purchase_request_items`** — the PR workflow. Status: `draft → pending_approval → approved | rejected`, plus `cancelled`. `requested_by`/`approved_by`/`rejected_by` are soft references (no FK), matching the existing `created_by`/`confirmed_by` convention used by `sales_orders`/`quotations`.
- **`rfqs` / `rfq_items` / `rfq_suppliers` / `rfq_responses`** — the RFQ workflow. `rfqs.purchase_request_id` optionally links an RFQ back to the PR it originated from. `rfq_items.selected_supplier_id` records the RFQ Approval outcome per line — **deliberately does not create a `purchases` row**, since Purchase Order creation is explicitly out of scope.

### Backend

| File | Change |
|---|---|
| `backend/src/routes/suppliers.ts` | +`category`/`supplier_group`/`credit_limit` to the write schema, sort whitelist, and filter whitelist. +`GET /:id/ledger-summary` — reuses `supplier_ledger` + the existing `computeSupplierBalance`/`computeSupplierOutstanding` pure functions (no new balance math). |
| `backend/src/routes/purchaseRequests.ts` | **New.** Full CRUD + `submit`/`approve`/`reject`/`cancel`. Approve/reject gated to `dealer_admin` (per your confirmed design choice). |
| `backend/src/routes/rfq.ts` | **New.** Full CRUD + invite/remove suppliers, `send`, `responses` (manual supplier-quote entry — suppliers have no portal/login in this system, so responses are recorded by dealer staff, per your confirmed design choice), `comparison` (per-item/per-supplier quote grid), `approve` (per-line winning-supplier selection), `cancel`. |
| `backend/src/index.ts` | Mounted `/api/purchase-requests` and `/api/rfqs`. |

**Deliberately NOT touched:** `purchases.ts`, `purchasePlanning.ts`, `autoPo.ts`, `demandPlanning.ts`, `inventoryIntelligenceService.ts`, any Product/Inventory/Sales/Customer/Quotation/Sales-Order/Invoice/Warehouse/Availability/Reservation file, and the pre-existing (broken) `purchase_drafts`/`purchase_draft_items` tables.

### Frontend

| File | Change |
|---|---|
| `src/services/supplierService.ts` | +`category`/`supplier_group`/`credit_limit` on `Supplier`/`SupplierFormData`; +`categoryFilter`/`groupFilter` on `list()` (additive, optional); +`getLedgerSummary()`. |
| `src/modules/suppliers/SupplierForm.tsx`, `SupplierList.tsx` | New fields on the create/edit form; Category/Group shown as badges on the list; "Duplicate Supplier" now also copies the new fields. |
| `src/components/SupplierLedgerSummaryPanel.tsx` | **New** — opening balance / total purchased / total paid / outstanding + a scrollable entry list, wired into `EditSupplier.tsx` alongside the existing Performance and Notes panels. |
| `src/services/purchaseRequestService.ts`, `src/pages/purchase-requests/*` | **New.** List, Create/Edit (with a "Load Reorder Suggestions" button pulling from the existing `demandPlanningService.getDemandRows()` — tags prefilled lines `source: "reorder_suggestion"`), Detail (submit/approve/reject/cancel, plus "Create RFQ from this Request" once approved). |
| `src/services/rfqService.ts`, `src/pages/rfq/*` | **New.** List, Create (optionally seeded from an approved PR via `?fromPurchaseRequest=`), Detail (invite/remove suppliers, send, record per-supplier/per-item quotes, comparison grid, per-line approval). |
| `src/App.tsx`, `src/config/navConfig.ts` | New routes (`/purchase-requests*`, `/rfqs*`) and nav entries under the existing "Purchase" section. |

---

## 3. Database Impact

**Purely additive.** 3 new nullable/defaulted columns on `suppliers`, 2 new sequence columns on `invoice_sequences`, 2 new Postgres functions, 6 new tables. No existing table/column renamed, retyped, dropped, or given a new default. Every supplier, purchase, or ledger entry created before this migration behaves identically.

## 4. API Impact

| Change | Compatibility |
|---|---|
| `GET/POST/PATCH /api/suppliers` | Additive optional fields only — existing callers that omit `category`/`supplier_group`/`credit_limit` behave exactly as before. |
| `GET /api/suppliers/:id/ledger-summary` | New endpoint; zero changes to any existing supplier route. |
| `/api/purchase-requests*`, `/api/rfqs*` | Entirely new route trees; zero changes to any existing endpoint. |

## 5. Testing Results

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing `warehouseTransferStock.test.ts` issue every prior sprint's report documents). `npx vitest run` — **261/261 pass** (31 new + 230 prior). New: `suppliers.sprint5a.test.ts` (7), `purchaseRequests.query.test.ts` (11), `rfq.query.test.ts` (13) — schema validation, query-shape `.toSQL()` checks, and upsert-on-conflict shape checks (no live test DB in this backend, matching the existing convention).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **354/354 pass** (21 new + 333 prior). New: `supplierService.sprint5a.test.ts` (6), `purchaseRequestService.test.ts` (7), `rfqService.test.ts` (8). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).
- **Not performed in this environment:** live interactive click-through testing (no browser available here) — the Manual QA checklist below should be run against a real dealer account.

## 6. Manual QA Checklist

- [ ] **Supplier category/group/credit limit** — create/edit a supplier with a category, group, and credit limit; confirm they save, display on the list as badges, and round-trip correctly on re-edit.
- [ ] **Supplier Ledger Summary** — open a supplier with existing purchases/payments; confirm the summary panel on the edit page shows correct opening balance, total purchased, total paid, and outstanding, matching the Payables page's own numbers for that supplier.
- [ ] **Purchase Request — create & submit** — create a PR with a department, notes, and 2+ manually-added items; submit for approval; confirm it gets a `PR-00001`-style number and moves to Pending Approval.
- [ ] **Purchase Request — reorder prefill** — on a dealer with low-stock products, use "Load Reorder Suggestions" on a new PR; confirm suggested items are added with the correct suggested quantity.
- [ ] **Purchase Request — approve/reject** — as a dealer_admin, approve one PR and reject another (with a reason); confirm status, approver, and rejection reason are recorded and visible.
- [ ] **Purchase Request — non-admin gating** — as a non-admin role, confirm the Approve/Reject buttons are hidden and a "pending approval" message shows instead.
- [ ] **RFQ — create from an approved PR** — from an approved PR's detail page, click "Create RFQ from this Request"; confirm the new RFQ is prefilled with the PR's items.
- [ ] **RFQ — invite & send** — invite 2+ suppliers to a draft RFQ, then send it; confirm it gets an `RFQ-00001`-style number and suppliers show as invited.
- [ ] **RFQ — record quotes & compare** — record a quoted rate/lead-time for each invited supplier on each item; confirm the comparison grid shows all quotes side by side.
- [ ] **RFQ — approve** — select a winning supplier per line and approve; confirm each line records the correct `selected_supplier_id` and the RFQ status becomes Approved. Confirm **no** Purchase/Purchase Order record is created as a side effect.
- [ ] Confirm existing Supplier list/search/pagination, Purchases, Purchase Returns, Payables, and Auto-PO Drafts pages are all unaffected.

## 7. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit — every backend change is additive (new routes, new optional fields) or a like-for-like extension; no existing route, component, or business rule was altered.
3. **DB rollback:** migration `093`'s `down()` cleanly drops all 6 new tables, both new sequence functions, both new `invoice_sequences` columns, and the 3 new `suppliers` columns, in FK-safe order — no data loss for any pre-existing supplier or purchase.
4. **Partial rollback:** the Purchase Request and RFQ nav entries/routes can be hidden independently of each other and of the Supplier extensions, since they share no code path with each other beyond the optional `rfqs.purchase_request_id` link.

## 8. Explicitly out of scope (per Sprint 5A instructions — not done)

- Purchase Order, Goods Receipt, Purchase Invoice, Supplier Payment, Import LC, Landed Cost, Purchase Return, and Accounting Posting — none built. Approving a PR or an RFQ only records the outcome (`status`, `selected_supplier_id`); neither creates a `purchases` row.
- Product Master, Inventory Engine, Sales Engine, POS, Customer, Quotation, Sales Order, Invoice, Warehouse, Availability Engine, Reservation Engine — all frozen, untouched.
- The pre-existing `autoPo.ts` / `purchase_drafts` schema-mismatch bug discovered during inspection — a real, confirmed production issue, but outside this sprint's stated scope; flagged above for a future dedicated fix (this sprint's own new tables use distinct names so they don't collide with it).
- A supplier-facing response portal for RFQ — suppliers have no login in this system today; per your confirmed design choice, responses are recorded by dealer staff instead.
