# Sprint 6E — Financial Statements & Closing

Branch: `v2/sprint-6e-financial-statements-closing`
Builds on Sprint 6D (commit `4ce4ac5`, approved and frozen). Sprint 1 through Sprint 6D remain untouched except small, explicitly-additive touches called out below (same "additive-only touches allowed" resolution established in Sprint 6B and reused without re-asking in 6C/6D).

## Key finding from Step 1 inspection

Most of this sprint's scope **already existed as pre-V2 legacy code** — `financials.ts` (P&L, Balance Sheet, Trial Balance, Cash Flow — "Track 1 Phase 1"), `gl.ts` (GL Spine Trial Balance, Chart of Accounts — "P6-01/02"), `vatReports.ts`/`vatReportService.ts` (Mushak 6.1/6.3 registers — "Phase 5"), and `dashboard.ts` (operational KPIs). Sprint 6E's real work was **upgrading and completing** that legacy layer, not greenfield building — and along the way, inspection surfaced a genuine architectural gap: manual Journal entries (`journal_entries`/`journal_entry_lines`, Sprint 6A) were never mirrored into the GL Spine (`gl_journal_lines`), so the GL-based Trial Balance was blind to every manual journal, while the legacy subledger-based one was blind to everything the Posting Engine writes (Sprint 6A–6D's asset postings, cost-center allocations, etc). Neither was complete on its own. This sprint's General Ledger / Trial Balance work reads **both** sources rather than forcing an unreliable free-text-to-GL-code match — see `generalLedgerService.ts`'s header comment for the full reasoning.

## 1. Files Changed

**New migration**
- `backend/src/db/migrations/102_financial_closing_vat.ts` — `fiscal_years.closing_journal_entry_id` (mirrors the existing `opening_balance_journal_id`); new `vat_period_closings` table.

**New backend services**
- `backend/src/services/gl/generalLedgerService.ts` — GL Spine UNION manual-Journal account balances/transactions, opening/period/closing, branch filter via `cost_centers.branch_id`.
- `backend/src/services/accounting/financialClosingService.ts` — Fiscal Year Closing: `computeClosingLines` (pure, tested) + `closeFiscalYear` (transactional).

**New backend routes**
- `backend/src/routes/generalLedger.ts` — account picker, per-account drill-down with running balance, CSV export.
- `backend/src/routes/financialClosing.ts` — fiscal year closing readiness/action/closing-journal view.
- `backend/src/routes/vatClosing.ts` — Input/Output VAT summary, reconciliation, Mushak 9.1 draft, VAT period closing + history.
- `backend/src/routes/financialDashboard.ts` — revenue/expenses/profit/cash/receivable/payable/inventory + Current Ratio/Working Capital.

**Modified backend files**
- `backend/src/index.ts` — registers the 4 new routers. *(Additive-only touch.)*
- `backend/src/routes/gl.ts` — `/trial-balance` gains optional `from`/`to`/`fiscalYearId`/`branchId` query params routing to the new period-aware `computeTrialBalance`; **byte-identical response when none are passed** (existing `asOf`-only behavior untouched). *(Additive-only touch to a Sprint 6A file.)*
- `backend/src/routes/financials.ts` — **not in the freeze list** (pre-V2, "Track 1 Phase 1") — extended more freely: `/p-and-l` gains `cost_of_sales`/`operating_expenses`/`operating_profit`/`other_income`/`other_expenses` (GL-sourced), and `net_profit` now nets Other Income/Expenses (previously omitted entirely — a completeness fix, flagged via a new warning); `/balance-sheet` gains `fixed_assets_net`/`current_assets`/`non_current_assets`/`vat_payable`/`current_liabilities`/`long_term_liabilities`/`retained_earnings_from_closing` (all additive fields; `total_assets`/`total_liabilities` now include Fixed Assets and VAT Payable, which were simply missing before); `/cash-flow` gains `operating_activities`/`investing_activities`/`financing_activities`/`internal_transfers`/`net_cash_flow_classified`.

**New backend tests**
- `backend/src/services/accounting/financialClosingService.test.ts` — 5 pure-function tests for `computeClosingLines` (net-income year, net-loss year, zero-balance skip, empty input, debit=credit balance invariant).
- `backend/src/routes/sprint6e.query.test.ts` — 8 query-shape tests covering the GL Spine/Journal UNION joins, branch-filter join chain, fiscal-year resolution, closing readiness queries, VAT closing insert shape, and the dashboard's VAT Payable query.

**New frontend services**
- `src/services/generalLedgerService.ts`, `src/services/financialClosingService.ts`, `src/services/vatClosingService.ts`, `src/services/financialDashboardService.ts`.

**New frontend pages**
- `src/pages/general-ledger/GeneralLedgerPage.tsx` — account picker (GL + manual Journal), running-balance table, CSV export.
- `src/pages/financial-closing/FinancialClosingPage.tsx` — period closing status grid (reuses Sprint 6A's close/reopen), Fiscal Year Closing readiness + confirm dialog, closing journal viewer.
- `src/pages/vat-closing/VatClosingPage.tsx` — Summary/Reconciliation, Mushak 9.1 Draft, Closing History tabs.
- `src/pages/financial-dashboard/FinancialDashboardPage.tsx` — KPI cards + Current Ratio/Working Capital.

**Modified frontend files**
- `src/services/financialService.ts` — new optional fields on `ProfitLoss`/`BalanceSheet`/`CashFlow`; new `PeriodTrialBalance`/`AccountBalanceRow` types; new `trialBalancePeriod()` method.
- `src/pages/financials/FinancialStatementsPage.tsx` — P&L: Operating Profit/Other Income/Other Expenses rows (rendered only when present). Balance Sheet: Current/Non-current Assets, VAT Payable, Long-term Liabilities, Retained-Earnings-from-Closing rows. Trial Balance: a "Period View" toggle switching to the new fiscal-year/branch-filterable Opening/Debit/Credit/Closing table, existing as-of view untouched underneath. Cash Flow: an Operating/Investing/Financing breakdown card.
- `src/App.tsx` — imports + 4 new routes.
- `src/config/navConfig.ts` — 4 new Finance-section nav entries, `dealerAdminOnly` + `planFeature: "advanced_finance"`.

## 2. Database Impact

Migration `102_financial_closing_vat.ts`, fully additive:
- `fiscal_years` + `closing_journal_entry_id` (nullable FK to `journal_entries`).
- New table `vat_period_closings` (dealer_id, period_start, period_end, output/input VAT+SD totals, net_payable, notes, closed_at, closed_by; `unique(dealer_id, period_start, period_end)` — closing the same period twice is rejected, not double-recorded).

No column drops, no destructive changes, no `NOT NULL` addition without a default. `down()` reverses both changes.

## 3. API Impact

New:
- `GET /api/general-ledger/accounts`, `GET /api/general-ledger/summary`, `GET /api/general-ledger/ledger`, `GET /api/general-ledger/ledger/export.csv`
- `GET /api/financial-closing/fiscal-years/:id/readiness`, `POST /api/financial-closing/fiscal-years/:id/close`, `GET /api/financial-closing/fiscal-years/:id/closing-journal`
- `GET /api/vat-closing/summary`, `GET /api/vat-closing/mushak-9-1-draft`, `POST /api/vat-closing/close`, `GET /api/vat-closing/history`
- `GET /api/financial-dashboard`

Extended (additive query params / response fields only, verified backward compatible):
- `GET /api/gl/trial-balance` — `from`/`to`/`fiscalYearId`/`branchId` (optional).
- `GET /api/financials/{p-and-l,balance-sheet,cash-flow}` — new response fields only.

All new routes: `authenticate` + `tenantGuard` + `requireRole(...)` + `restrictSuperAdminOnFinancials()`, matching every Sprint 6A–6D financial route.

**Route-ordering check** (the same class of bug caught and fixed in Sprint 6D's `budgets.ts`): verified `generalLedger.ts`, `financialClosing.ts`, and `vatClosing.ts` register every literal path (`/accounts`, `/summary`, `/readiness`, `/close`, etc.) either before any `:id`-shaped catch-all or with a differing path-segment count, so none can be shadowed. No `:id`-first routes exist in these three new files.

## 4. Financial Statement Impact

- **Trial Balance**: now offers a genuine period view (Opening/Debit/Credit/Closing) with fiscal-year and branch filtering, reusing `getTrialBalance`'s GL Spine query as its foundation per the "Reuse the GL Spine" instruction. GL Spine accounts and manual Journal accounts are shown as two separate, clearly-labeled groups rather than merged — see `generalLedgerService.ts`'s header comment for why merging by name would be unsafe.
- **General Ledger**: new capability entirely — per-account drill-down, running balance, CSV export, links back to the originating journal/posting batch.
- **P&L**: now itemizes Operating Profit and Other Income/Other Expenses (asset disposal gains/losses, bad debt — Sprint 6D data that had no home in the legacy P&L before this sprint). `net_profit` is now materially more accurate for any dealer using Fixed Assets.
- **Balance Sheet**: now includes Fixed Assets (net of depreciation) as a Non-current Asset and VAT Payable as a Current Liability — both were silently absent before. `total_assets`/`total_liabilities` values will shift for any dealer with fixed assets or VAT-registered sales; this is a completeness fix, not a bug in the old figures' own logic. Retained Earnings gained a second, GL/Journal-sourced figure (`retained_earnings_from_closing`) that reflects what Fiscal Year Closing has actually posted — 0 until first use, additive alongside the pre-existing residual-plug `retained_earnings`.
- **Cash Flow**: now classifies into Operating/Investing/Financing. Investing Activities is sourced from the GL Spine specifically because Fixed Asset purchase/disposal cash effects never touch `cash_ledger` at all (Sprint 6D's `assetPosting.ts` mirrors straight into `gl_journal_lines`) — the pre-existing cash-ledger-only "Net Cash Flow" figure is preserved unchanged alongside the new classified one.
- **Financial Closing**: Period Closing is unchanged (Sprint 6A, reused as-is). Fiscal Year Closing is new: validates every period is closed and no earlier fiscal year is still open, then generates a system Closing Journal (via the same `journal_entries`/`journal_entry_lines` mechanism and `validateBalance` helper `journal.ts` itself uses) that zeros every income/expense GL account into Retained Earnings. Opening Balance Carry Forward needs no separate mechanism — the GL Spine is cumulative by construction, so asset/liability/equity balances simply continue automatically once income/expense is zeroed.
- **VAT**: Input/Output VAT Summary, Reconciliation, and the Mushak 9.1 Draft are all built directly from the existing Mushak 6.1/6.3 register totals (`vatReportService.ts`, unchanged). VAT Closing is a compliance record (`vat_period_closings`), not a GL/cash posting — see the Deferred Items note on why GL account 2200 (Input VAT) still isn't posted to.
- **Financial Dashboard**: new page combining the same helpers the Balance Sheet already uses, plus the two genuinely-new ratios: Current Ratio and Working Capital.

## 5. Testing Results

- Backend typecheck (`npx tsc --noEmit`): clean for every Sprint 6E file. The same 7 pre-existing, unrelated `warehouseTransferStock.test.ts` errors (Sprint 3B) remain, confirmed present in every prior sprint's report.
- Backend tests (`npx vitest run`): **511 passed**, 0 failed (13 new this sprint: 5 closing-journal-math cases, 8 query-shape cases).
- Frontend typecheck (`npx tsc --noEmit -p tsconfig.json`): clean.
- Frontend tests (`npx vitest run`): **373 passed**, 0 failed — no regressions, no new frontend unit tests added (matching the precedent set in Sprints 6A–6D, which also didn't add frontend service/component tests).
- Backend production build (`npm run build`): emits `dist/index.js` (pre-existing warehouseTransferStock errors don't block emission).
- Frontend production build (`npm run build`): succeeds, emits `dist/` (one pre-existing chunk-size warning, unrelated).

One test bug caught and fixed during this sprint's own build-out: `sprint6e.query.test.ts`'s open-periods query-shape assertion initially expected Knex's `whereNot('status', 'closed')` to render as `<>`/`!=`; Knex actually renders it as `not "status" = ?`. Caught on first run, fixed to match the real generated SQL.

## 6. Rollback Plan

1. `git revert` (or reset, if not yet pushed) the Sprint 6E commit — restores every file to its Sprint 6D state.
2. Run migration `102`'s `down()` — drops `vat_period_closings`, drops `fiscal_years.closing_journal_entry_id`. Any Fiscal Year Closings already performed would have their `closing_journal_entry_id` link removed, but **the closing journal entries themselves (in `journal_entries`/`journal_entry_lines`) are NOT deleted** by this rollback — they remain as ordinary (if now unlinked) journal entries. A dealer who closed a fiscal year and then needed to roll back this sprint would need to manually void those closing journal entries via the existing `/reverse` journal workflow if they want to fully undo the closing's financial effect.
3. **Standing deploy-directory risk (flagged in every sprint since 6A, still unresolved)**: `npm run build` runs directly in `/var/www/tilessaas`, the same directory nginx (frontend) and PM2 (`tilessaas-api`, backend) serve from. Frontend changes go live instantly; backend changes need an explicit `pm2 restart tilessaas-api`, never triggered across Sprints 6A–6E. If deployed, the restart must happen before the new endpoints (and the widened `fiscal_years`/new `vat_period_closings` schema) are live.
4. Fiscal Year Closing is **not naturally reversible** by design (it's an accounting closing entry, the same as in any real accounting system) — the only correct undo is a reversing journal entry, not a database rollback. This is intentional and matches standard accounting practice, not a gap in this sprint's implementation.

## 7. Manual QA Checklist

- [ ] Open the General Ledger page, pick a GL account (e.g. "1000 — Cash in Hand"), confirm the running balance column adds up correctly against the opening balance.
- [ ] Pick a manual-Journal account from the same picker (any free-text account a Journal entry has used), confirm its ledger shows only Journal-sourced lines with voucher-number links.
- [ ] On Financial Statements → Trial Balance, toggle "Period View" on, pick a fiscal year, confirm Opening/Debit/Credit/Closing columns render for both GL and Manual Journal account groups.
- [ ] Confirm the Trial Balance's non-period (as-of date) view still renders exactly as before toggling Period View off.
- [ ] On the P&L tab, confirm Operating Profit only appears once `other_income`/`other_expenses` fields are present in the response (i.e., graceful degradation if the backend response is older).
- [ ] Create a Fixed Asset (Sprint 6D), confirm it now appears under Non-current Assets on the Balance Sheet and the VAT Payable line reflects any sales made.
- [ ] On Financial Closing, select a fiscal year with an open period; confirm the "Close Fiscal Year" button is disabled and the readiness alert lists the open period(s).
- [ ] Close every period in a test fiscal year, then close the fiscal year itself; confirm a closing journal appears, Retained Earnings updates on the Balance Sheet, and attempting to close the same fiscal year again is rejected.
- [ ] Attempt to close a LATER fiscal year while an EARLIER one is still open; confirm it's rejected with a clear chronological-order message.
- [ ] On VAT Closing, pick a period with sales and purchases, confirm Output/Input VAT summaries match the existing Mushak 6.3/6.1 report totals exactly.
- [ ] Close a VAT period, confirm it appears in history and closing the exact same period again is rejected (409).
- [ ] On the Financial Dashboard, confirm Current Ratio and Working Capital compute sensibly against the same period's Balance Sheet figures.
- [ ] Confirm a `super_admin` gets a 403 on every new route when passing a specific `dealerId` (the existing `restrictSuperAdminOnFinancials()` boundary).

## 8. Deferred Items

Explicitly out of scope per the kickoff: CRM, Marketing, BI, AI, Manufacturing, Mobile App, HR Enhancements.

Also deferred (not requested this sprint, noted for future consideration):
- **Input VAT GL posting.** GL account `2200 VAT Receivable/Input VAT` remains unposted — purchase posting still books VAT into Inventory/AP rather than as a separately recoverable credit. Rebuilding that would touch frozen Sprint 5D/5E purchase posting logic; VAT Closing/Reconciliation/Summaries are instead built entirely from the existing, correct Mushak register totals (subledger-based).
- **Sales/Purchase → cost-center/branch tagging.** The Trial Balance's branch filter only covers cost-center-tagged posting lines (Journal/Expenses/Assets, per Sprint 6D's own scope) — Sales and Purchase postings aren't cost-center-tagged, so a branch filter narrows to a subset of total activity. Documented in-page as a warning when the filter is active.
- **Automatic mirroring of manual Journal entries into the GL Spine.** Deliberately not built — `journal_entry_lines.account` is free text with no Chart-of-Accounts binding (confirmed via the actual `<Input>` in `JournalPage.tsx`), so an automated name-match would risk silently merging two different accounts. The read-side UNION in `generalLedgerService.ts` solves the completeness problem without this risk.
- **Fiscal Year Un-closing / reopening.** There is no `POST /fiscal-years/:id/reopen` — undoing a closing requires a reversing journal entry via the existing `/reverse` workflow, matching standard accounting practice (a closed year isn't meant to be silently reopened).
- **VAT Closing → GL posting or bank payment recording.** VAT Closing is a compliance record only, by design — no payment date/method is specified by the closing action itself.

This completes the Sprint 6E accounting build-out. See `docs/ACCOUNTING_COMPLETION_REPORT.md` for the overall Accounting Engine status across Sprints 6A–6E.

## Deploy-Directory Drift (carried forward, still unresolved)

Same risk documented in every sprint since 6A: `npm run build` (both frontend and backend) runs directly against `/var/www/tilessaas`, which is also nginx's and PM2's serving directory. Frontend changes go live immediately on build; backend changes require an explicit `pm2 restart tilessaas-api` that has not been triggered across any of Sprints 6A–6E. By the time this ships, the live backend will be five sprints behind the built frontend until a restart happens.
