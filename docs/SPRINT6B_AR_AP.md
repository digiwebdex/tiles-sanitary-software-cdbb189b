# Sprint 6B — Accounts Receivable / Accounts Payable

Branch: `v2/sprint-6b-ar-ap` (created from `v2/sprint-6a-accounting-foundation` tip `c76950e`)
Frozen and NOT modified: Sprints 1, 2, 2.1, 3A–3D, 4A–4E, 5A–5E, 6A. Every change below is either a brand-new file, or a narrowly-additive touch (a new function call, a new case in an existing switch, a new WHERE clause, a new optional field) inside a small number of frozen-sprint files where the sprint's own explicit scope ("Connect Customer Invoice/Payment/Supplier Invoice/Payment → Ledger → GL") could not otherwise be satisfied — no existing signature, validation rule, or business behavior was changed.

## 1. Files Changed

### Backend — new files
- `backend/src/db/migrations/099_ar_ap_foundation.ts` — `ledger_entry_type` enum gains `'opening_balance'`; `mv_customer_outstanding` view redefined to also include `customer_ledger` opening_balance/adjustment rows.
- `backend/src/services/accounting/openingBalancePosting.ts` — `postCustomerOpeningBalance`/`postSupplierOpeningBalance`.
- `backend/src/routes/openingBalance.ts` — `POST /api/opening-balance/{customers,suppliers}/:id/post`.
- `backend/src/routes/customerAging.ts` — `GET /api/customer-aging` (Due Today/This Week/This Month + buckets, customer-side counterpart to `supplierAging.ts`).
- `backend/src/services/accounting/openingBalancePosting.test.ts`, `backend/src/routes/customerAging.query.test.ts`, `backend/src/services/posting/LedgerPostingEngine.test.ts` (first-ever test coverage for `buildCustomerPaymentLines`/`buildSupplierPaymentLines`, activated this sprint).

### Backend — modified files (all additive)
- `backend/src/lib/glChart.ts` — new GL account `3200 Opening Balance Equity`.
- `backend/src/lib/ledgerBalance.ts` — `computeCustomerBalance` recognizes `'opening_balance'` (same bucket as `sale`/`adjustment`).
- `backend/src/services/gl/glLineMapper.ts` — new `customer`/`opening_balance` and `supplier`/`opening_balance` cases, posting against the new suspense account.
- `backend/src/services/posting/types.ts` — `PostingDocumentType` gains `'opening_balance'`.
- `backend/src/lib/customerPayment.ts` — `recordCustomerPayment` now also mirrors into the Posting Engine via the (previously unused) `buildCustomerPaymentLines`.
- `backend/src/lib/supplierPayment.ts` — `recordSupplierPaymentFifo` now also mirrors via `buildSupplierPaymentLines`; `loadPurchasesToPay` now filters `document_status: 'posted'` (AP draft-invoice bug fix).
- `backend/src/routes/purchaseInvoices.ts` — `/:id/finalize` now mirrors the purchase's financial effect into the Posting Engine (the GRN-pipeline invoice path never reached GL before this sprint).
- `backend/src/routes/collections.ts` — `POST /api/collections/payment` accepts an optional `sale_id` (manual bill targeting, mirroring the supplier side); `GET /api/collections/outstanding`'s `invoices[]` now includes `due_amount`.
- `backend/src/routes/customerStatements.ts` — excludes `'opening_balance'`-typed rows from its own ledger walk (defensive: `customers.opening_balance` is already the authoritative starting value there; including the new mirror row too would double-count it).
- `backend/src/routes/suppliers.ts` — `ledger-summary`'s `entries` field excludes `'opening_balance'` rows for the same reason (its `outstanding`/`balance` fields still include it).
- `backend/src/services/reportQueryService.ts` — `listPayablesOutstanding` now filters `document_status: 'posted'` (same AP draft-invoice bug fix, applied at the read-model layer too).

### Frontend — new files
- `src/services/openingBalanceService.ts`.

### Frontend — modified files
- `src/services/collectionsService.ts` — `recordPayment` accepts `sale_id`; `invoices[]` typed with `due_amount`.
- `src/modules/collections/CollectionTracker.tsx` — Collect Payment dialog gains an "Apply To" dropdown (FIFO or a specific invoice), mirroring `SupplierPaymentPage.tsx`.
- `src/modules/reports/ReportsPageContent.tsx` — `DueAgingReport` gains Due Today/This Week/This Month cards, backed by the new `/api/customer-aging` endpoint.
- `src/pages/customers/CustomerStatementPage.tsx`, `src/pages/supplier-ledger/SupplierStatementPage.tsx` — each gains a "Post Opening Balance to GL" button.

## 2. Database Impact

Migration `099_ar_ap_foundation.ts`, fully additive:
- `ALTER TYPE ledger_entry_type ADD VALUE 'opening_balance'` — `supplier_ledger.type` is bound to this enum and would otherwise hard-fail on such an insert; `customer_ledger.type` is a free varchar and already accepted it.
- `mv_customer_outstanding` redefined (`CREATE OR REPLACE VIEW`, no data loss) to `UNION ALL` `sales.due_amount` with `customer_ledger` rows of type `opening_balance`/`adjustment` — closing the gap where a manual ledger adjustment or an opening balance was correctly written to the ledger but invisible to AR/Aging/Dashboards (which read this view, not the ledger, for totals). `mv_supplier_payable` needed no change — it already sums every `supplier_ledger` row generically regardless of type.

No column drops, no destructive changes. `down()` restores the pre-6B view exactly (Postgres cannot drop a single enum value; leaving `'opening_balance'` unused on rollback is safe, matching the precedent from migrations 096/097).

## 3. API Impact

New:
- `POST /api/opening-balance/customers/:id/post`, `POST /api/opening-balance/suppliers/:id/post` — idempotent; a second call for an already-posted party is a no-op (`{posted: false}`).
- `GET /api/customer-aging` — mirrors `GET /api/supplier-aging`'s shape (`summary.{total_outstanding, due_today, due_this_week, due_this_month, buckets}`, `customers[]`).

Changed (backward-compatible):
- `POST /api/collections/payment` — new optional `sale_id` field; omitted, behavior is identical to before (FIFO).
- `GET /api/collections/outstanding` — each entry in `invoices[]` now also has `due_amount` (existing consumers reading only the pre-existing fields are unaffected).
- `POST /api/purchases/:id/payment`, `POST /api/payables/payment` — now reject a payment targeting a draft (unfinalized) Purchase Invoice (previously a narrow bug allowed this).

## 4. Accounting Impact

- **Customer Payment and Supplier Payment now reach the GL.** Both were confirmed during inspection to have fully-built, ready GL-line builders (`buildCustomerPaymentLines`/`buildSupplierPaymentLines`, from Sprint 6A) sitting completely uncalled. This sprint's core "Posting Engine" wiring work was activating those two call sites plus one more:
- **Supplier Invoice (GRN-pipeline) now reaches the GL.** The quick-entry Purchase create/reverse path already dual-wrote (confirmed in Sprint 6A); the separate GRN → Purchase Invoice finalize path did not. `purchases.ts`'s quick-entry flow and `purchaseInvoices.ts`'s finalize flow now both post to `posting_batches`/`posting_lines` using the same `buildPurchaseLedgerLines` builder — no double-posting, since GRN-pipeline invoices don't also flow through the quick-entry path.
- **Opening Balances now reach the ledger and the GL.** `customers.opening_balance`/`suppliers.opening_balance` (immutable, set once at creation) previously went nowhere beyond that column. Posting one now: (a) inserts a `customer_ledger`/`supplier_ledger` row of the new `opening_balance` type, correctly signed to match each ledger's own convention; (b) mirrors a balanced GL entry against the new `3200 Opening Balance Equity` suspense account rather than Sales/COGS/Inventory, since it predates any real transaction. This is an explicit, idempotent, dealer-triggered action (a button on each Statement page) — existing customers/suppliers are NOT silently backfilled as a side effect of this migration.
- **AP draft-invoice bug fixed.** A Purchase Invoice sitting in `document_status='draft'` (created via GRN but not yet finalized) already carries a real pre-VAT `total_amount`; two read paths (`listPayablesOutstanding`, the FIFO payment allocator) had no status filter and could show/pay against it before it was ever posted. Both now require `document_status='posted'`, matching what `supplierAging.ts` already did correctly.
- **AR total now sees opening balances and manual adjustments.** Previously `mv_customer_outstanding` (the sole source for AR totals/Aging/Dashboards) summed only `sales.due_amount`; a manual "adjustment" ledger entry (`POST /api/collections/adjustment`) or an opening balance was correctly in the ledger but invisible everywhere except the ledger-rollup helpers. Fixed via the view redefinition; `computeCustomerBalance` extended to match.
- **Manual bill allocation now available on the customer side.** The backend already supported targeting a specific sale (`recordCustomerPayment`'s `saleId` param) — only the frontend (amount-only, implicit FIFO) and the `POST /api/collections/payment` schema (silently dropped any `sale_id`) didn't expose it. Both fixed.
- **Accounts Receivable Due Today/This Week/This Month** — new, mirroring the supplier side's existing recency-based convention (no due-date/payment-terms field exists on Sales or Customers, exactly as documented in `supplierAging.ts`'s own header comment for the supplier side).
- **Credit Notes / Refund handling / Debit Notes** — confirmed already correctly implemented (Sales Return with `refund_mode='credit'`; manual supplier Credit/Debit Note endpoints) and NOT rebuilt; only the underlying balance-visibility fixes above apply to them indirectly.
- **DO NOT IMPLEMENT list honored**: Trial Balance, P&L, Balance Sheet, Cash Flow, Bank Reconciliation, Financial Reports, Budget, Cost Centers, Assets, VAT Reports — untouched.

## 5. Testing Report

- Backend: **59 test files, 444 tests, all passing** (`cd backend && npx vitest run`). New: `openingBalancePosting.test.ts` (6), `customerAging.query.test.ts` (3), `LedgerPostingEngine.test.ts` (6, first-ever coverage for the two payment-line builders), plus 5 new cases added to `glLineMapper.test.ts` for the `opening_balance` GL mapping.
- Frontend: **57 test files, 373 tests, all passing**.
- Backend typecheck: clean for all Sprint 6B code (the same 7 pre-existing, unrelated `warehouseTransferStock.test.ts` errors from Sprint 3B remain, untouched).
- Frontend typecheck: clean.
- Both production builds succeed (backend emits `dist/index.js`; frontend `dist/assets/*`).

## 6. Rollback

- **Fastest rollback for the new GL wiring specifically:** set `USE_POSTING_ENGINE=false` (or `USE_GL_SPINE=false`) — every new mirror call in this sprint is gated by `isPostingEngineEnabled()`, exactly like all prior posting-engine call sites; the legacy ledger writes (customer_ledger/supplier_ledger/cash_ledger/bank_ledger) are completely unaffected either way.
- **Migration 099** has a full `down()` (restores the pre-6B `mv_customer_outstanding` view exactly; the added enum value is harmless left in place, matching precedent).
- **Opening Balance posting** is opt-in per party (a button click) — nothing was auto-posted for existing data, so there's nothing to undo unless a dealer explicitly clicked "Post Opening Balance to GL." If needed, the inserted `customer_ledger`/`supplier_ledger` row (type `opening_balance`) and its linked `posting_batches` row can be deleted manually per party.
- **Git:** isolated to `v2/sprint-6b-ar-ap`; not merged, not pushed.
- Same deploy-directory note as Sprint 6A applies: this sprint's `npm run build` runs were executed in `/var/www/tilessaas`, the same directory nginx/PM2 serve from in production (see `docs/SPRINT6A_ACCOUNTING_FOUNDATION.md` §7 and the `sprint6a-accounting-status` memory note) — the frontend build is live immediately; the backend build sits in `backend/dist` until `pm2 restart tilessaas-api` is explicitly run.

## 7. Manual QA Checklist

- [ ] Record a customer payment (FIFO, no `sale_id`); confirm it still behaves exactly as before, and confirm a new `posting_batches` row now exists for it (`SELECT * FROM posting_batches WHERE document_type='payment' ORDER BY created_at DESC LIMIT 1`).
- [ ] In the Collections "Collect Payment" dialog, use the new "Apply To" dropdown to target one specific invoice instead of FIFO; confirm only that invoice's due amount drops.
- [ ] Record a supplier payment via `/payables/pay`; confirm a `posting_batches` row now exists for it too.
- [ ] Create a Purchase Invoice via the GRN pipeline and finalize it; confirm `purchases.posting_batch_id` is now set (previously always NULL for this path) and `GET /api/gl/consistency-check` still reports `unbalanced_count: 0`.
- [ ] Attempt `POST /api/purchases/:id/payment` (or the FIFO/`payablesService` list) against a still-draft Purchase Invoice; confirm it's now excluded/rejected.
- [ ] Create a new customer with a nonzero opening balance; on their Customer Statement page, click "Post Opening Balance to GL"; confirm the toast says "posted," a `customer_ledger` row of type `opening_balance` now exists, and clicking the button again says "already posted."
- [ ] Same for a new supplier on the Supplier Statement page.
- [ ] Confirm the Customer Statement's own opening/closing balance figures are unchanged before vs. after posting (no double-count).
- [ ] Record a manual `POST /api/collections/adjustment` for a customer with a negative amount (a write-off); confirm the AR/Aging totals (Due Aging Report, Collections list) now reflect it, where previously they silently ignored it.
- [ ] Open the Due Aging Report page; confirm the new Due Today/This Week/This Month cards render and their totals look consistent with the existing bucket cards' Total Due.
- [ ] Confirm `GET /api/gl/consistency-check` shows `unbalanced_count: 0` after exercising all of the above on a test dealer.

## 8. Deferred Items

- **Supplier manual advance/credit-note/debit-note (`supplierLedgerEntries.ts`) were NOT wired into the Posting Engine.** The kickoff's explicit "POSTING ENGINE" section names exactly four flows (Customer Invoice, Customer Payment, Supplier Invoice, Supplier Payment) — all four are now wired. Extending GL wiring to these three manual entry types would additionally require designing a Purchase-Discount/Purchase-Surcharge GL account (none exists in the current chart), which is a business decision beyond this sprint's literal scope; flagged for Sprint 6C+ rather than decided unilaterally here.
- **Purchase Return / sales-return-triggered Credit Note GL wiring** — confirmed during inspection that partial Purchase Returns and Sales Return refunds/credit-notes never reach the GL (only a *full* reversal does). Not in this sprint's four named posting-engine flows; deferred.
- **VAT is never reversed on a Sales Return/credit-note** (`insertTaxPostingLine` only accepts `documentType: 'sale'|'purchase'`) — a real bug, adjacent to the explicitly excluded "VAT Reports" area; documented for a future sprint rather than fixed here to avoid scope creep into VAT logic.
- **Bill-level vs. ledger-level AP reconciliation.** `listPayablesOutstanding` already exposes both `billLevelTotal` (sum of per-bill dues, which never sees credit notes/debit notes/purchase returns/unlinked advances) and `totalOutstanding` (the ledger read-model total) side by side without reconciling them — a pre-existing design tension the codebase already surfaces rather than hides; not resolved here since doing so requires deciding whether credit/debit notes should become bill-allocatable (a business/schema decision, not a bug fix).
- **Customer-side standalone manual Credit Note** (independent of a Sales Return) has no precedent or UI, unlike the supplier side's dedicated Credit/Debit Note dialogs. Not built — the kickoff's "Credit Note" bullet under Customer Ledger was interpreted as "ensure ledger consistency for the existing return-triggered mechanism," not "build a new standalone feature"; flagging the alternate reading here in case that's wrong.
- **`accounting_periods`/Period Lock interaction with old opening-balance dates**: if a dealer later closes a fiscal period covering an old customer's/supplier's creation date, posting that party's opening balance for the first time at that point would correctly fail with a period-closed error (by design — the existing, unmodified `assertPeriodOpen` choke point). Not an issue today since no dealer has set up fiscal periods yet, but worth knowing.
