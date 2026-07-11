# Sprint 6C — Cash/Bank Reconciliation

Branch: `v2/sprint-6c-cash-bank-reconciliation` (created from `v2/sprint-6b-ar-ap` tip `73f3bff`)
Frozen and NOT modified: Sprints 1, 2, 2.1, 3A–3D, 4A–4E, 5A–5E, 6A, 6B. Per the freeze-list resolution established in Sprint 6B (recorded in memory): a handful of frozen files needed narrowly-additive touches (a new function call, a new endpoint appended to an existing route file, a new field on an existing table) to satisfy this sprint's explicit "GL INTEGRATION" requirement — no existing signature, validation, or behavior was changed. This sprint's inspection was done directly (grep/Read), not via subagents.

## 1. Files Changed

### Backend — new files
- `backend/src/db/migrations/100_cash_bank_reconciliation.ts` — `bank_ledger` gains `cheque_no`/`cheque_status`/`is_cleared`/`cleared_at`; new `bank_statement_lines` table; `ledger_entry_type` enum gains `'transfer'`.
- `backend/src/services/accounting/cashBankTransactions.ts` — `recordCashReceipt`, `recordCashPayment`, `recordBankDeposit`, `recordBankWithdrawal`, `recordTransfer` (shared core for both new routes below).
- `backend/src/routes/transfers.ts` — `POST/GET /api/transfers` (Cash↔Bank, Bank↔Bank).
- `backend/src/routes/chequeRegister.ts` — `GET /api/cheque-register`, `POST /api/cheque-register/:bankLedgerId/status`.
- `backend/src/routes/bankReconciliation.ts` — CSV/manual import, matching, summary.
- `backend/src/services/accounting/cashBankTransactions.test.ts`, `backend/src/routes/{transfers,chequeRegister,bankReconciliation}.*test.ts`.

### Backend — modified files (all additive)
- `backend/src/services/gl/glLineMapper.ts` — fixed the dead `'expense'` domain case (zero callers prior to this sprint) to drop its self-contra, since its first real caller (`expenses.ts`, wired this sprint) pairs it with a separate `cash`/`bank` line in the same batch.
- `backend/src/services/posting/types.ts` — `PostingDocumentType` gains `cash_receipt`/`cash_payment`/`bank_deposit`/`bank_withdrawal`/`transfer`.
- `backend/src/routes/expenses.ts` — additive Posting Engine mirror call.
- `backend/src/routes/cashbook.ts` — new `POST /receipt`/`POST /payment` endpoints (the file's existing `GET /` is unchanged).
- `backend/src/routes/bankAccounts.ts` — new `POST /:id/deposit`/`POST /:id/withdrawal` endpoints (the existing generic `POST /:id/entry` is unchanged, kept for backward compatibility, still does not reach GL).
- `backend/src/index.ts` — registers the three new route files.

### Frontend — new files
- `src/services/{cashTransactionService,transferService,chequeRegisterService,bankReconciliationService}.ts`.
- `src/pages/bank-accounts/{ChequeRegisterPage,BankReconciliationPage}.tsx`.

### Frontend — modified files
- `src/services/bankAccountService.ts` — `deposit`/`withdrawal` methods; `BankLedgerRow` extended with cheque/cleared fields (all optional).
- `src/pages/cashbook/CashbookPage.tsx` — "Record Receipt"/"Record Payment"/"Transfer" buttons + dialogs.
- `src/pages/bank-accounts/BankAccountDetailPage.tsx` — "Deposit"/"Withdrawal" buttons + dialog (with a cheque number field when payment mode is Cheque); the legacy "Add Entry" dialog is kept, relabeled, unchanged.
- `src/App.tsx`, `src/config/navConfig.ts` — routes/nav for the two new pages (same `dealerAdminOnly` visibility as the existing Bank Accounts/Cashbook entries).

## 2. Database Impact

Migration `100_cash_bank_reconciliation.ts`, fully additive:
- `bank_ledger`: + `cheque_no`, `cheque_status` (CHECK-constrained to issued/presented/cleared/bounced/cancelled), `is_cleared` (default `false`), `cleared_at`. Every existing row is unaffected (`is_cleared=false`, cheque fields `NULL`, matching the pre-reconciliation reality exactly).
- `bank_statement_lines` (new table): one row per imported/manual bank statement line, optionally matched to a `bank_ledger` row via `matched_bank_ledger_id`. No "reconciliation session" table — summaries are computed on demand.
- `ledger_entry_type` enum: + `'transfer'` (mirrors the migration 096/097/099 widening pattern; affects `cash_ledger` and `supplier_ledger`, both bound to this one shared enum — harmless for supplier_ledger).

No column drops, no destructive changes, no `NOT NULL` without a default. `down()` reverses cleanly (the added enum value is left in place on rollback, matching precedent — Postgres cannot drop a single enum value).

## 3. API Impact

New:
- `POST /api/cashbook/receipt`, `POST /api/cashbook/payment`
- `POST /api/bank-accounts/:id/deposit`, `POST /api/bank-accounts/:id/withdrawal`
- `POST /api/transfers`, `GET /api/transfers`
- `GET /api/cheque-register`, `POST /api/cheque-register/:bankLedgerId/status`
- `POST /api/bank-reconciliation/:bankAccountId/import`, `POST /api/bank-reconciliation/:bankAccountId/manual-line`, `GET /api/bank-reconciliation/:bankAccountId`, `POST /api/bank-reconciliation/match`, `POST /api/bank-reconciliation/unmatch`, `GET /api/bank-reconciliation/:bankAccountId/summary`

Unchanged (verified, not modified): `GET /api/cashbook`, all pre-existing `/api/bank-accounts/*` endpoints including `POST /:id/entry`.

## 4. Accounting Impact

- **Cash Receipt / Cash Payment / Bank Deposit / Bank Withdrawal now post to GL.** None of these had any write endpoint before this sprint except `expenses.ts` (cash-only, not GL-wired) and the document-linked payment functions from Sprint 6B. Each is a single posting line (`cash`/`bank` domain, mapped by sign alone in the existing `glLineMapper.ts`); since there's no specific counter-account for a not-otherwise-linked movement, the batch is intentionally one line — the existing, already-tested "Clearing plug" fallback in `balanceGlDrafts` absorbs the other side, exactly as documented in that function's own docstring for "genuine Clearing-designated events." A future sprint could let the user pick a specific GL account/category instead (see Deferred Items).
- **Transfers post as one balanced 2-line batch, no Clearing.** Source (−amount) and destination (+amount) legs balance each other directly.
- **Expense Payments now reach GL.** Fixed a real bug in the process: `glLineMapper.ts`'s `expense` domain case has existed since Sprint 6A but was entirely dead code (zero callers) with a self-contra (debit Expense / credit Clearing) that would have double-posted through Clearing once paired with a real cash/bank line. Fixed before activating its first caller — the same pattern Sprint 6A used for its own Bug A/B/C/D fixes.
- **Cheque Register** is not a new table — a cheque is a `bank_ledger` row with `cheque_no` set, created via a Bank Withdrawal. Status lifecycle: issued → presented → cleared/bounced, bounced → issued (re-issue), cancelled (terminal). Reaching `cleared` also sets `is_cleared`, integrating directly with reconciliation.
- **Bank Reconciliation** computes Cleared Transactions / Outstanding Deposits / Outstanding Cheques / Reconciliation Summary on demand from `bank_ledger` + `bank_statement_lines` — no separate stored "session." The summary identity (`cleared_balance + outstanding_deposits − outstanding_cheques = book_balance`) is exposed in the API response so the UI/tests can verify it rather than trust it silently.
- **DO NOT IMPLEMENT list honored**: Trial Balance, P&L, Balance Sheet, Cash Flow, Cost Centers, Projects, Fixed Assets, Budget, VAT Closing, Financial Statements — untouched.

## 5. Testing Report

- Backend: **63 test files, 474 tests, all passing** (`cd backend && npx vitest run`). New: `cashBankTransactions.test.ts` (9), `transfers.query.test.ts` (4), `chequeRegister.query.test.ts` (7), `bankReconciliation.test.ts` (9, including a CSV-parser bug found and fixed during this sprint's own test-writing — see below), plus 2 new cases in `glLineMapper.test.ts` for the fixed `expense` case.
- Frontend: **57 test files, 373 tests, all passing**.
- Backend typecheck: clean for all Sprint 6C code (the same 7 pre-existing, unrelated `warehouseTransferStock.test.ts` errors from Sprint 3B remain, untouched, confirmed present in every prior sprint's report too).
- Frontend typecheck: clean.
- Both production builds succeed.
- **Bug found and fixed during testing**: the CSV header-auto-detection heuristic initially treated ANY first row with a non-numeric amount as a header and silently discarded it (not counted as skipped) — meaning a genuinely malformed first *data* row (e.g. a real transaction with a corrupted amount field) would vanish without a trace instead of being reported as skipped. Fixed to only treat the first row as a header when **both** the date and amount columns fail to parse; a row where only the amount is bad (date parses fine) now correctly increments the skipped count.

## 6. Rollback Plan

- **Fastest rollback for GL wiring:** set `USE_POSTING_ENGINE=false` — every new mirror call in this sprint (cash/bank/expense/transfer) is gated by `isPostingEngineEnabled()`, matching every prior sprint's pattern. Legacy ledger writes are completely unaffected either way.
- **Migration 100** has a full `down()`.
- **New endpoints are purely additive** — nothing existing was removed or changed, so simply not routing traffic to them (or reverting the branch) fully rolls back this sprint's surface.
- **Git:** isolated to `v2/sprint-6c-cash-bank-reconciliation`; not merged, not pushed.
- Same deploy-directory note as Sprints 6A/6B applies (see [[sprint6a-accounting-status]] memory / `docs/SPRINT6A_ACCOUNTING_FOUNDATION.md` §7): the frontend build from this sprint's verification is already live in `/var/www/tilessaas/dist`; the backend build sits in `backend/dist` pending an explicit `pm2 restart tilessaas-api`, which was not triggered.

## 7. Manual QA Checklist

- [ ] Record a Cash Receipt and a Cash Payment from the Cashbook page; confirm the running balance and a new `posting_batches` row for each (`documentType: 'cash_receipt'`/`'cash_payment'`).
- [ ] Record a Bank Deposit and Withdrawal from a Bank Account's detail page; confirm the account balance updates and each posts to GL.
- [ ] Withdraw by cheque (enter a cheque number); confirm it appears in the new Cheque Register page with status "issued."
- [ ] Move that cheque through Presented → Cleared; confirm `is_cleared` becomes true and it shows up as a cleared transaction on the Bank Reconciliation page for that account.
- [ ] Attempt an invalid cheque transition (e.g. issued → cleared is allowed, but cleared → anything should show no actions); confirm the UI only offers valid next statuses.
- [ ] Do a Cash→Bank transfer; confirm both a `cash_ledger` and `bank_ledger` row are created, cross-referenced, and the GL batch balances with no Clearing plug.
- [ ] Do a Bank→Bank transfer between two different accounts; same checks. Attempt a same-account "transfer" and confirm it's rejected.
- [ ] Record an Expense; confirm it now posts to GL (`documentType: 'expense'`) with a plain 2-line debit Expense / credit Cash batch, no Clearing entries.
- [ ] On the Bank Reconciliation page, import a small CSV (`date,description,amount`) for a bank account; confirm the unmatched statement lines appear.
- [ ] Click a statement line and a book ledger row, then "Match Selected"; confirm both disappear from their unmatched lists and appear under Cleared Transactions, and the ledger row's `is_cleared` flips.
- [ ] Unmatch a cleared pair; confirm both return to their unmatched lists.
- [ ] Check the Reconciliation Summary cards; confirm `cleared_balance + outstanding_deposits − outstanding_cheques` equals `book_balance` (the `difference` field should read ~0).
- [ ] Confirm `GET /api/gl/consistency-check` shows `unbalanced_count: 0` after exercising all of the above on a test dealer.

## 8. Deferred Items

- **Category/GL-account selection for standalone Cash/Bank Receipts and Payments.** Today these post as a single line and rely on the existing Clearing-account auto-plug (the same mechanism already used for miscellaneous/unmodeled transactions elsewhere in the GL spine). A future sprint could let the user pick a specific income/expense/equity account per receipt or payment instead of defaulting through Clearing — not built here; the kickoff's "Cash Receipts, Cash Payments" bullets don't call for categorization, and building it would mean designing new GL accounts/categories, which risks the same scope creep the "DO NOT IMPLEMENT: Cost Centers/Budget" boundary is meant to avoid.
- **Bank statement CSV import format** is a fixed, minimal `date,description,amount[,reference]` shape with a simple auto-detected header. Real-world bank export formats vary (different column orders, multi-currency, running-balance columns); a future sprint could add per-bank import templates or a column-mapping UI. Not attempted here — kept to what "CSV/manual" literally asked for.
- **No cheque tracking on Deposits' incoming cheques beyond the reference field.** The `cheque_status` lifecycle (issued→presented→cleared/bounced) is modeled for cheques WE issue (withdrawals/payments) — the classic "outstanding cheques" bank-reconciliation concept. A cheque received via deposit can still carry a `cheque_no` for reference, but doesn't get its own status lifecycle; tracking incoming-cheque clearance separately (e.g., "deposited, awaiting clearance") was judged out of this sprint's literal "Cheque Register" scope, which is normally an AP-side (money-out) concept.
- **Reconciliation matching is one-to-one only** (one statement line ↔ one ledger row). Splitting one bank statement line across multiple ledger entries, or vice versa (e.g. a bank fee bundled into a larger transaction), isn't supported — a real bank reconciliation edge case, deferred.
