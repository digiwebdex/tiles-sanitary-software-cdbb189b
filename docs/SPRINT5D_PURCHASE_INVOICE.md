# V2 Sprint 5D — Purchase Invoice, Supplier Payment, Supplier Ledger, Accounts Payable

**Status:** Complete. Awaiting user approval. Branch: `v2/sprint-5d-purchase-invoice`, built on frozen tip `86b0902` (Sprint 5C — Goods Receipt).

## 0. Pre-Implementation Inspection Summary

Before writing any code, the following existing infrastructure was inspected in full:

| Area | Finding |
|---|---|
| Purchase Invoice | Did not exist as a concept — no invoice table, no invoice-from-GRN flow. But the frozen `purchases`/`purchase_items` tables already had every column a Purchase Invoice needs (`invoice_number`, `document_status`, VAT/SD columns), including two dormant `document_status` values (`'draft'`, `'pending_approval'`) added in migration `058_document_status_columns.ts` but never exercised by any code — the same pattern Sprint 5C found with `purchase_orders.status`. |
| Supplier Payment | `POST /api/purchases/:id/payment` (single-bill) and `POST /api/payables/payment` (FIFO across bills) both already exist, both built on `recordSupplierPaymentFifo` (`backend/src/lib/supplierPayment.ts`) — reusable unmodified. No "Advance Payment" path existed: `recordSupplierPaymentFifo` rejects any payment that exceeds the outstanding balance, so a supplier with zero due bills could never receive an advance. |
| Supplier Ledger | `supplier_ledger` table (Sprint 5A) already supports `sale`\*/`purchase`/`payment`/`refund`/`adjustment` via the `ledger_entry_type` enum (\* sale is customer-side only). No `credit_note`/`debit_note` values existed. `computeSupplierBalance` (`backend/src/lib/ledgerBalance.ts`) and the `mv_supplier_payable` view both already compute balance correctly for any entry type via a uniform `balance += -amount` rule — verified this generalizes correctly to new entry types without modification. |
| Accounts Payable | `GET /api/payables/outstanding` (`payablesService`) already lists outstanding bills via `mv_supplier_payable`. No Aging/Due-bucket view existed for suppliers, though the exact bucket-math (`emptyDueAgingBuckets`, `addDueToAgingBuckets`, `agingDaysFromSaleDate`) already existed in `reportQueryService.ts`, built generically enough (plain date + amount) to reuse unmodified for supplier bills — the customer-side `GET /api/reports/page/due-aging` was the direct precedent to mirror. |
| Payment methods | Cash/bank-account payment method plumbing (`bank_ledger`/`cash_ledger`, `paid_account_id`) already exists and is reused as-is. |
| VAT integration | `computeVatBreakdown`/`normalizeDealerVatSettings` (`backend/src/lib/vatMath.ts`) and `loadDealerVatSettings`/`insertTaxPostingLine` (`backend/src/services/taxPostingService.ts`) are all standalone, exported, pure/near-pure functions — reused unmodified. No VAT logic was touched or redesigned. |
| Purchase APIs | `backend/src/routes/purchases.ts` (frozen, pre-V2 "quick entry" flow) does atomic stock+finance posting in one request and was the reference implementation for invoice numbering (`PUR-YYYYMMDD-NNNN`) and the VAT/ledger posting sequence — read in full, not modified, logic behaviorally mirrored where the frozen file couldn't be imported from. |

**What was reused directly (no duplication):** `computeVatBreakdown`, `normalizeDealerVatSettings`, `loadDealerVatSettings`, `insertTaxPostingLine`, `recordSupplierPaymentFifo`, `computePurchaseNetPayable`, `sumPurchaseLedgerPayments`, `buildPurchasePaymentSummary`, `attachPurchasePaymentSummaries`, `emptyDueAgingBuckets`, `addDueToAgingBuckets`, `agingDaysFromSaleDate`, `GET /api/purchases`, `GET /api/purchases/:id`, `POST /api/purchases/:id/payment`, `POST /api/payables/payment`, `supplierService.getLedgerSummary()`.

**Genuine gaps this sprint fills:** a write path to turn a completed Goods Receipt into a financial Purchase Invoice (draft → finalize, with over-invoice prevention and VAT/ledger posting); Advance Payment; Credit Note; Debit Note; a supplier-side Aging/Due-buckets report; and the frontend UI for all of the above.

## 1. Files Changed

### Backend — new
- `backend/src/db/migrations/096_purchase_invoice_ledger.ts` — schema widening (additive only).
- `backend/src/routes/purchaseInvoices.ts` — Purchase Invoice CRUD + finalize/cancel.
- `backend/src/routes/supplierLedgerEntries.ts` — Advance Payment / Credit Note / Debit Note.
- `backend/src/routes/supplierAging.ts` — Accounts Payable aging + Due Today/Week/Month.
- `backend/src/routes/purchaseInvoices.query.test.ts`, `supplierLedgerEntries.query.test.ts`, `supplierAging.query.test.ts` — 29 new tests.

### Backend — modified
- `backend/src/index.ts` — registered the 3 new routers (`/api/purchase-invoices`, `/api/supplier-ledger-entries`, `/api/supplier-aging`). No other line changed.

### Frontend — new
- `src/services/purchaseInvoiceService.ts`, `supplierLedgerEntryService.ts`, `supplierAgingService.ts`.
- `src/pages/purchase-invoices/PurchaseInvoicesPage.tsx`, `CreatePurchaseInvoice.tsx`, `PurchaseInvoiceDetail.tsx`.
- `src/pages/supplier-ledger/SupplierStatementPage.tsx`, `SupplierAgingPage.tsx`.

### Frontend — modified
- `src/App.tsx` — added imports + 5 new routes. No existing route changed.
- `src/config/navConfig.ts` — added 2 nav entries (`Purchase Invoices`, `Supplier Statement`, `Payables Aging` — 3 entries) under the existing "Purchase" section. No existing entry changed.

**Not touched (frozen, referenced read-only):** `purchases.ts`, `purchaseOrders.ts`, `goodsReceipts.ts`, `payables.ts`, `ledger.ts`, `suppliers.ts`, `ledgerBalance.ts`, `supplierPayment.ts`, `purchasePaymentSummary.ts`, `taxPostingService.ts`, `vatMath.ts`, `reportQueryService.ts`, `PurchaseList.tsx`, `ViewPurchase.tsx`, `PurchasesPage.tsx`, `GoodsReceiptDetail.tsx`, `purchaseService.ts`, `payablesService.ts`, `supplierService.ts`.

## 2. Database Impact

Migration `096_purchase_invoice_ledger.ts` — purely additive, no destructive changes:

1. `purchases.document_status` CHECK constraint widened: `('draft','pending_approval','posted','reversed')` → adds `'cancelled'`. Existing rows unaffected (all currently `'posted'`/`'reversed'`).
2. `ledger_entry_type` enum: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for `'credit_note'` and `'debit_note'`. Postgres enum additions are non-transactional-safe here since the migration never reads/writes a row using the new values in the same migration (same pattern as migrations 016/075/079/089/094).
3. `purchase_items.source_goods_receipt_item_id` — new nullable UUID column, FK to `goods_receipt_items(id)` `ON DELETE SET NULL`, plus an index. `NULL` for every pre-existing row and every future quick-entry purchase; only set for invoice lines created from a GRN.

**No new table.** A Purchase Invoice is a `purchases` row with `document_status IN ('draft','posted','cancelled')`. Down-migration reverts the CHECK and drops the new column; the two new enum values cannot be removed by Postgres (harmless, matches every prior enum-extending migration's documented behavior).

## 3. API Impact

All new, no existing endpoint's behavior changed.

| Method & Path | Purpose |
|---|---|
| `GET /api/purchase-invoices/goods-receipts/uninvoiced` | Completed, not-fully-invoiced GRNs (picker source) |
| `GET /api/purchase-invoices/goods-receipt/:grnId/lines` | Invoiceable lines for one GRN (received − already invoiced) |
| `POST /api/purchase-invoices` | Create a draft invoice from one or more GRN lines |
| `PUT /api/purchase-invoices/:id` | Edit a draft (replaces items) |
| `DELETE /api/purchase-invoices/:id` | Delete a draft |
| `POST /api/purchase-invoices/:id/finalize` | Assign invoice number, post VAT + supplier ledger, optional payment-on-create |
| `POST /api/purchase-invoices/:id/cancel` | Cancel a draft (keeps the row, `document_status='cancelled'`) |
| `POST /api/supplier-ledger-entries/advance-payment` | Unconditional payment, no due-bill required (`manager`/`accountant`/`dealer_admin`) |
| `POST /api/supplier-ledger-entries/credit-note` | Manual credit note, reduces balance owed (`dealer_admin`) |
| `POST /api/supplier-ledger-entries/debit-note` | Manual debit note, increases balance owed (`dealer_admin`) |
| `GET /api/supplier-aging` | Payables aging buckets + Due Today/Week/Month, dealer-wide and per-supplier |

**Reused unchanged:** `GET /api/purchases` (List), `GET /api/purchases/:id` (Details), `POST /api/purchases/:id/payment` and `POST /api/payables/payment` (Record/Partial/Due Payment, FIFO), `GET /api/suppliers/:id/ledger-summary` (Statement data source).

## 4. UI Impact

New pages only; no existing page's markup or behavior changed.

- **Purchase Invoices** (`/purchase-invoices`) — list of all `purchases` rows (both this flow and the pre-existing quick-entry flow, since they're the same table), with its own draft/posted/cancelled status badges. "Create Invoice from GRN" entry point.
- **Create Purchase Invoice** (`/purchase-invoices/new`) — GRN picker supporting multiple GRNs (locked to one supplier once the first is added), per-line editable invoice quantity (Partial Invoice) and rate, voucher discount.
- **Purchase Invoice Detail** (`/purchase-invoices/:id`) — Draft: Finalize / Cancel / Delete. Posted: VAT/SD breakdown, Record Payment (reuses the same payment dialog pattern as `ViewPurchase.tsx`, calling `purchaseService.recordPayment`).
- **Supplier Statement** (`/supplier-ledger/statement`) — supplier picker → dated statement (opening balance, running balance, print), mirroring `CustomerStatementPage.tsx`. Data from `supplierService.getLedgerSummary()`, unmodified.
- **Payables Aging** (`/supplier-ledger/aging`) — summary cards (Total Outstanding, Due Today/Week/Month) + per-supplier bucket table, mirroring the customer-side Due Aging report layout. Hosts the Advance Payment / Credit Note / Debit Note action dialogs.

Nav: 3 new entries under the existing "Purchase" section (`Purchase Invoices`, `Supplier Statement`, `Payables Aging`); no existing entry moved or renamed.

## 5. Testing Report

- **Backend:** `npx tsc --noEmit` — clean (0 errors in Sprint 5D files). 29 new tests across 3 files (`purchaseInvoices.query.test.ts`, `supplierLedgerEntries.query.test.ts`, `supplierAging.query.test.ts`), covering: query shapes (`.toSQL()`), Zod schema validation, over-invoice prevention math, invoice-number sequencing, the credit/debit-note sign convention (verified against both `computeSupplierBalance`'s formula and `mv_supplier_payable`'s `SUM(-amount)`), and the purchase_date-recency Due Today/Week/Month classification. Full backend suite: **327/327 passing** (48 files) — no regressions.
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` — 0 new errors (53 pre-existing `portalService.ts` errors confirmed present on the frozen Sprint 5C tip before this sprint, unrelated dead Supabase code). Full frontend suite: **373/373 passing** (57 files) — no regressions.
- **Backend production build** (`npm run build`): succeeds, `dist/` produced including all 3 new route files and migration 096. Exit code reflects the same pre-existing `warehouseTransferStock.test.ts` TS18048 errors documented as not-new in every prior sprint's report (test file, does not block emit).
- **Frontend production build** (`npm run build`): succeeds. Same pre-existing >500kB chunk-size warning documented in every prior sprint's report — not new.

## 6. Rollback Plan

1. `git revert` (or reset, if not yet pushed) this sprint's commit — all changes are additive new files plus 3 small, mechanical diffs (route registration, route imports, nav entries), so reverting is a clean no-op for every frozen feature.
2. Run migration `096`'s `down()`: drops `purchase_items.source_goods_receipt_item_id`, reverts the `document_status` CHECK to its Sprint-058 shape. The two new `ledger_entry_type` enum values (`credit_note`, `debit_note`) cannot be removed by Postgres and are left in place — harmless, since no code references them once the routes are gone.
3. No data migration/backfill needed in either direction — every new column is nullable and every new status value is opt-in.

## 7. Manual QA Checklist

- [ ] Complete a Goods Receipt (Sprint 5C), then create a Purchase Invoice from it with full quantity — invoice appears as `draft`.
- [ ] Create a second invoice from the same GRN attempting to over-invoice a line — rejected with a clear error.
- [ ] Create a Partial Invoice (qty < received), finalize it, then create a second invoice for the remainder from the same GRN — both post successfully, GRN line fully claimed.
- [ ] Create one invoice spanning lines from 2 different GRNs for the same supplier — succeeds; attempting to add a GRN from a different supplier is blocked by the picker's "locked to supplier" behavior.
- [ ] Finalize a draft invoice — invoice number `PUR-YYYYMMDD-NNNN` assigned, VAT/SD computed per dealer VAT settings, `supplier_ledger` entry posted, appears in Supplier Statement and Payables Aging.
- [ ] Finalize with "Pay now" > 0 — payment posted via `recordSupplierPaymentFifo`, due amount reduced accordingly.
- [ ] Cancel a draft invoice — status becomes `cancelled`, GRN lines become invoiceable again (re-invoice succeeds).
- [ ] Delete a draft invoice — row removed, GRN lines invoiceable again.
- [ ] Attempt to finalize/cancel/delete/edit a already-posted invoice — rejected (draft-only guard).
- [ ] Record a Payment on a posted invoice via the Detail page — due amount decreases, appears in Supplier Statement.
- [ ] Record an Advance Payment against a supplier with zero due bills — succeeds (previously impossible via `recordSupplierPaymentFifo`).
- [ ] Record a Credit Note — Outstanding Balance decreases by that amount.
- [ ] Record a Debit Note — Outstanding Balance increases by that amount.
- [ ] Open Supplier Statement for a supplier with mixed purchase/payment/credit/debit history — running balance matches Outstanding Balance shown elsewhere (Payables, supplier profile).
- [ ] Open Payables Aging — Total Outstanding matches the sum of all suppliers' `Total Due`; Due Today/Week/Month reflect `purchase_date` recency as documented below.
- [ ] Confirm the old quick-entry Purchases page/flow (`/purchases`, `/purchases/new`) is fully unaffected — create a quick-entry purchase, confirm it still posts atomically exactly as before.

**Known, transparent design decision:** no due-date/payment-terms field exists anywhere in this codebase (not even for Customers). "Due Today/This Week/This Month" is therefore bucketed by `purchase_date` recency — how recently the bill was incurred — the same convention the existing Current/1-30/31-60/61-90/90+ aging buckets already use, rather than a genuine forward payment-due schedule this system has no concept of.

## 8. Out-of-Scope List

Per the sprint's explicit exclusions — none of the following were touched: General Ledger, Journal Entries, Trial Balance, Balance Sheet, Profit & Loss, Bank Reconciliation, Import LC, Landed Cost, Purchase Return, Multi-currency.

Additional items deliberately left out because they weren't part of the requested scope:
- **Edit UI for a draft invoice** — the backend `PUT /api/purchase-invoices/:id` endpoint exists (for API/future use) but no "Edit" button was wired into the Detail page, since the sprint's scope explicitly listed only Draft/Finalize/Cancel (not Edit) for Purchase Invoice.
- **Reversing a posted/finalized invoice** — only `Cancel` (draft-only) exists. Reversing a posted invoice would need Purchase-Return-style stock/finance unwinding, explicitly out of scope this sprint.
- **A due-date/payment-terms field** on Supplier — not requested, and does not exist on Customer either; adding one is a schema decision bigger than this sprint's scope.
