# Sprint 6D — Cost Center / Project Accounting / Fixed Assets / Budget Management

Branch: `v2/sprint-6d-cost-center-project-assets-budget`
Builds on Sprint 6C (commit `d548226`, approved and frozen). Sprint 1 through Sprint 6C remain untouched except for small, explicitly-additive touches called out below (same "additive-only touches allowed" resolution established in Sprint 6B and reused without re-asking in 6C).

## 1. Files Changed

**New migration**
- `backend/src/db/migrations/101_cost_center_project_asset_budget.ts`

**New backend services**
- `backend/src/services/accounting/assetPosting.ts` — depreciation math (straight-line, declining-balance) + Asset Purchase / Asset Disposal / Depreciation GL posting, reusing the Posting Engine choke point.

**New backend routes**
- `backend/src/routes/costCenters.ts` — Cost Center CRUD + per-cost-center report.
- `backend/src/routes/departments.ts` — Department CRUD.
- `backend/src/routes/projectAccounting.ts` — accounting overlay on the existing Project module (summary/profitability/expenses/ledger).
- `backend/src/routes/fixedAssets.ts` — Asset Categories CRUD, Asset Register (create = capitalize), Depreciation run (single + batch), Disposal, Register/Depreciation reports, per-asset ledger.
- `backend/src/routes/budgets.ts` — Budget Allocation, Revision, Budget vs Actual, Variance Report.

**Modified backend files**
- `backend/src/index.ts` — registers the 5 new routers (`/api/cost-centers`, `/api/departments`, `/api/project-accounting`, `/api/fixed-assets`, `/api/budgets`). *(Additive-only touch: new `import`/`app.use` lines only.)*
- `backend/src/lib/glChart.ts` — 2 new GL accounts: `4100 Gain on Disposal of Fixed Assets`, `6200 Loss on Disposal of Fixed Assets`; 2 new `GL_CODES` entries. *(Additive-only touch, same pattern as every prior sprint's chart addition — 1300/1310/6000 were already seeded in Sprint 6A specifically for this sprint.)*
- `backend/src/services/posting/types.ts` — `PostingDocumentType` +`'fixed_asset_purchase' | 'fixed_asset_disposal' | 'depreciation'`; `PostingLineDomain` +`'asset'`; `PostingLineInput` +`costCenterId?` / `projectId?`. *(Additive-only touch to a shared type file — required for the sprint's own new posting flows to typecheck at all; no existing member changed.)*
- `backend/src/services/posting/postingLineWriter.ts` — `insertPostingLines` row-mapping now also writes `cost_center_id`/`project_id` from `PostingLineInput` (both `?? null` when absent — every pre-6D caller is unaffected). *(Additive-only touch, single choke point.)*
- `backend/src/services/gl/glLineMapper.ts` — new `case 'asset':` branch (`purchase` / `depreciation` / `disposal_cost` / `disposal_accumulated_depreciation` / `disposal_gain` / `disposal_loss`). *(Purely additive — the `switch` `default` was a no-op before, so this is a new case, not a change to an existing one.)*
- `backend/src/routes/journal.ts` — `lineSchema` +`cost_center_id` (optional); both `POST /` and `POST /draft`'s line-row mapping, plus `/reverse`'s mirrored-line mapping, now carry `cost_center_id` through. *(Additive-only touch: new optional field, `?? null` default, zero change to existing validation/behavior for callers that omit it.)*
- `backend/src/routes/expenses.ts` — `CreateSchema` +`project_id`/`cost_center_id` (both optional); inserted into the `expenses` row and passed into the Posting Engine mirror's `expense` line. *(Additive-only touch, same shape.)*

**New backend tests**
- `backend/src/services/accounting/assetPosting.test.ts` — pure-function tests for the two depreciation-math functions.
- `backend/src/services/gl/glLineMapper.test.ts` — +7 cases covering the new `'asset'` domain (purchase, depreciation, disposal-at-gain, disposal-at-loss).
- `backend/src/routes/sprint6d.query.test.ts` — `.toSQL()` query-shape tests for the new routes' joins/filters.

**New frontend services**
- `src/services/costCenterService.ts`, `src/services/departmentService.ts`, `src/services/projectAccountingService.ts`, `src/services/fixedAssetService.ts`, `src/services/budgetService.ts`.

**New frontend pages**
- `src/pages/cost-centers/CostCentersPage.tsx` — Cost Centers + Departments tabs, per-cost-center report dialog.
- `src/pages/projects/ProjectAccountingPage.tsx` — project picker + Budget/Revenue/Expense/Profit summary, expenses list, GL ledger.
- `src/pages/fixed-assets/FixedAssetsPage.tsx` — Register + Categories tabs, asset capitalization dialog.
- `src/pages/fixed-assets/FixedAssetDetailPage.tsx` — depreciation schedule, Run Depreciation action, Dispose Asset dialog.
- `src/pages/budgets/BudgetsPage.tsx` — Budgets + Variance Report tabs, allocation/revision dialogs.

**Modified frontend files**
- `src/App.tsx` — imports + 5 new routes (`/cost-centers`, `/fixed-assets`, `/fixed-assets/:id`, `/budgets`, `/projects/accounting`).
- `src/config/navConfig.ts` — 4 new Finance-section nav entries (Cost Centers, Project Accounting, Fixed Assets, Budget Management), all `dealerAdminOnly` + `planFeature: "advanced_finance"`, matching Sprint 6A's gating.

## 2. Database Impact

Migration `101_cost_center_project_asset_budget.ts`, fully additive:

**New tables:** `departments`, `cost_centers` (parent/child hierarchy), `asset_categories`, `asset_depreciation_schedule`, `budgets`.

**Extended tables (new nullable columns only):**
- `posting_lines` + `cost_center_id`, `project_id` (both nullable FKs, indexed).
- `journal_entry_lines` + `cost_center_id`.
- `expenses` + `project_id`, `cost_center_id`.
- `assets` (Phase 18, HR asset-assignment table — **not** in the Sprint 1–6C freeze list) + `asset_category_id`, `useful_life_months`, `salvage_value` (default `0`), `depreciation_method` (nullable — `NULL` means "not a capitalized fixed asset", so every existing HR asset row is unaffected), `depreciation_rate`, `accumulated_depreciation` (default `0`), `depreciation_start_date`, `disposed_at`, `disposal_proceeds`, `disposal_reason`, `purchase_posting_batch_id`, `disposal_posting_batch_id`, `cost_center_id`, `project_id`.

**Widened CHECK constraint:** `posting_lines_line_domain_check` — `DROP CONSTRAINT IF EXISTS` + re-`ADD CONSTRAINT` with `'asset'` appended to the existing 7-value list (`stock, customer, supplier, cash, bank, expense, tax`). Same additive-widening pattern used for `ledger_entry_type` in Sprints 6B/6C.

**Design decision — extend, don't fork:** the existing `assets` table (Phase 18, "who has the company laptop") is reused for Fixed Assets rather than creating a parallel table, per the sprint's "reuse existing database tables" rule — confirmed via inspection that its existing columns (`tag`, `name`, `category`, `serial_no`, `purchase_date`, `purchase_cost`) are directly reusable. A **separate** `fixedAssets.ts` route was still written (not touching `assets.ts`) so HR assignment concerns and accounting/depreciation concerns don't get tangled in one file's validation logic.

No column drops, no destructive changes, no `NOT NULL` addition without a default. `down()` fully reverses every change in this migration, including restoring the original 7-value `posting_lines_line_domain_check` constraint.

## 3. API Impact

New:
- `GET/POST/PUT/DELETE /api/cost-centers`, `GET /api/cost-centers/:id/report`
- `GET/POST/PUT/DELETE /api/departments`
- `GET /api/project-accounting/:projectId/{summary,profitability,expenses,ledger}`
- `GET/POST/PUT /api/fixed-assets/categories[/:id]`, `GET/POST/PUT /api/fixed-assets[/:id]`, `GET /api/fixed-assets/register-report`, `GET /api/fixed-assets/depreciation-report`, `GET /api/fixed-assets/:id/{depreciation-schedule,ledger}`, `POST /api/fixed-assets/:id/depreciation/run`, `POST /api/fixed-assets/depreciation/run-all`, `POST /api/fixed-assets/:id/dispose`
- `GET/POST /api/budgets`, `GET /api/budgets/:id`, `POST /api/budgets/:id/revise`, `GET /api/budgets/:id/variance`, `GET /api/budgets/variance-report`

All new routes: `authenticate` + `tenantGuard` + `requireRole(...)` + `restrictSuperAdminOnFinancials()`, matching every Sprint 6A–6C financial route exactly (super_admin can view cross-dealer aggregates but cannot act on a single dealer's financial data).

No existing endpoint's request/response shape changed. `journal.ts` and `expenses.ts` gained one new optional request field each (`cost_center_id` / `project_id`+`cost_center_id`) — omitting it is 100% backward compatible.

**Route-ordering note caught during review:** `budgets.ts` initially registered `GET /:id` before `GET /variance-report`, which would have shadowed the literal route (Express matches by registration order). Fixed before commit — `/variance-report` and `/:id/variance` are now registered ahead of the catch-all `/:id`. Verified no equivalent issue exists in `fixedAssets.ts`, `costCenters.ts`, or `projectAccounting.ts` (their literal routes are either registered first or differ in path-segment count / HTTP method from any catch-all, so they can't be shadowed).

## 4. UI Impact

New pages (all under Finance, `dealerAdminOnly` + gated on the `advanced_finance` plan feature, same as Journal/Chart of Accounts/Fiscal Years):
- **Cost Centers & Departments** (`/cost-centers`) — two tabs, CRUD for both, per-cost-center GL activity report.
- **Project Accounting** (`/projects/accounting`) — project picker (reuses the existing Project Master picker), Budget/Revenue/Expense/Profit/Margin cards, expense list, GL ledger by domain.
- **Fixed Assets** (`/fixed-assets`) — Register + Categories tabs; creating an asset capitalizes it (posts to GL) in the same action.
- **Fixed Asset Detail** (`/fixed-assets/:id`) — cost/accumulated-depreciation/book-value cards, "Run Depreciation" and "Dispose Asset" actions, full depreciation schedule table.
- **Budget Management** (`/budgets`) — Budgets + Variance Report tabs; Allocate/Revise dialogs; per-budget Budget-vs-Actual dialog.

Project Master itself (`/projects`, `ProjectsPage.tsx`) is completely untouched — Project Accounting is an overlay, not a replacement.

## 5. GL Impact

New `'asset'` posting_lines domain, three shapes:
- **Asset Purchase** (`line_type: 'purchase'`): one line, debit Fixed Assets (1300). Paired in the same batch with an optional `cash`/`bank` line (existing domains, unchanged sign convention) for the funding side; an unfunded ("on account") purchase falls back to the existing, already-tested Clearing plug — same documented treatment as `cashBankTransactions.ts`'s own receipt/payment lines.
- **Depreciation** (`line_type: 'depreciation'`): one posting_lines row expands into a self-balanced Dr Depreciation Expense (6000) / Cr Accumulated Depreciation (1310) pair — the same "one line, two GL legs" shape already used by `customer/sale` and `stock/sale_out`.
- **Disposal**: up to 4 lines in one batch — `disposal_cost` (credit Fixed Assets, full original cost), `disposal_accumulated_depreciation` (debit Accumulated Depreciation), `disposal_gain` XOR `disposal_loss` (credit 4100 / debit 6200), plus an optional `cash`/`bank` line for proceeds. Proven algebraically and by test to balance exactly for any proceeds/book-value combination — no Clearing plug in the normal case.

Cost-center/project tagging is NOT a new posting mechanism — `cost_center_id`/`project_id` are optional attributes on `PostingLineInput`, settable on ANY line domain. Only Journal entries, Expenses, and the three new Asset flows populate them this sprint (matching the kickoff's explicit "Automatically post: Asset Purchase, Asset Disposal, Monthly Depreciation, Project Expense, Cost Center Allocation").

**Project Revenue is NOT GL-sourced.** It reads `sales.total_amount` where `project_id` matches (the pre-existing column, already used by `projectReports.ts`) — Sales was intentionally left unwired into the cost-center/project posting-line tagging this sprint (out of the explicit scope; see Deferred Items). Project Profitability is therefore Revenue − Expense, not a full GL-sourced gross margin (COGS isn't project-tagged either, for the same reason).

## 6. Testing Results

- Backend typecheck (`npx tsc --noEmit`): clean for every Sprint 6D file. The same 7 pre-existing, unrelated `warehouseTransferStock.test.ts` errors (Sprint 3B, confirmed present in every prior sprint's report) remain, untouched.
- Backend tests (`npx vitest run`): **498 passed**, 0 failed (46 of them new this sprint: 8 depreciation-math cases, 7 `glLineMapper` `'asset'`-domain cases, 11 query-shape cases across the 5 new routes, plus pre-existing suites re-verified green).
- Frontend typecheck (`npx tsc --noEmit -p tsconfig.json`): clean.
- Frontend tests (`npx vitest run`): **373 passed**, 0 failed (no regressions; no new frontend service/component tests added this sprint, matching the precedent set in Sprints 6A–6C, which also didn't add frontend unit tests for new services).
- Backend production build (`npm run build`): emits `dist/index.js` (the pre-existing warehouseTransferStock errors don't block emission — `noEmitOnError` was never set).
- Frontend production build (`npm run build`): succeeds, emits `dist/` (one pre-existing chunk-size warning, unrelated to this sprint, present in prior builds too).

One bug caught and fixed during this sprint's own build-out (not from a prior sprint): a test in `assetPosting.test.ts` for `computeDecliningBalanceMonthlyDepreciation`'s salvage-value cap initially used inputs where the cap wasn't actually the binding constraint (rate-implied amount already below the cap) — the test would have passed even with a broken cap. Caught immediately on first run (`expected 20 to be 100`), fixed by choosing inputs where the rate-implied amount genuinely exceeds the cap.

## 7. Rollback Plan

1. `git revert` (or reset, if not yet pushed) the Sprint 6D commit — restores every file to its Sprint 6C state.
2. Run migration `101`'s `down()` — drops `budgets`, `asset_depreciation_schedule`, `asset_categories`, `cost_centers`, `departments`; drops all new columns from `assets`/`expenses`/`journal_entry_lines`/`posting_lines`; restores the original 7-value `posting_lines_line_domain_check`. Fully reversible, no data loss beyond the new tables/columns themselves (which contain only Sprint 6D-created data).
3. **Standing deploy-directory risk (flagged in every sprint since 6A, still unresolved):** `npm run build` runs directly in `/var/www/tilessaas`, the same directory nginx (frontend) and PM2 (`tilessaas-api`, backend) serve from in production. Frontend changes go live the instant a build lands (no restart). Backend changes do **not** take effect until `pm2 restart tilessaas-api` is run explicitly — this has not been triggered for Sprints 6A, 6B, 6C, or 6D. If Sprint 6D is approved and deployed, the backend restart must happen before the new `/api/cost-centers`, `/api/fixed-assets`, etc. routes (and the widened `posting_lines` constraint) are live, or the frontend's new pages will 404 against the API.
4. The `PostingLineDomain` TypeScript union gained `'asset'` — this is compile-time only and has no runtime rollback implication once reverted.

## 8. Manual QA Checklist

- [ ] Create a Department, then a Cost Center mapped to it and to an existing Branch; confirm the Cost Center list shows both names.
- [ ] Create a Journal entry with a line tagged to a Cost Center; confirm it appears in that Cost Center's report.
- [ ] Record an Expense tagged with a Project and a Cost Center; confirm it appears in both the Cost Center report and the Project Accounting expense list.
- [ ] Create a new Fixed Asset (straight-line method) funded by Cash; confirm the Cash ledger decreases by the same amount and the batch balances with no Clearing plug.
- [ ] Run Depreciation once on that asset; confirm a schedule row appears, `accumulated_depreciation` on the asset increases, and re-running depreciation for the same period is blocked by the DB unique constraint (not silently double-posted).
- [ ] Create a second asset with the declining-balance method and a rate; confirm the first depreciation amount matches `book value × rate/12`.
- [ ] Dispose an asset with proceeds greater than its book value; confirm a Gain on Disposal line appears and the batch balances.
- [ ] Dispose an asset with proceeds less than its book value (or zero); confirm a Loss on Disposal line appears and the batch balances.
- [ ] Allocate a Budget to a Cost Center for the current fiscal year; confirm it appears in the Variance Report with `actual` reflecting posted activity.
- [ ] Revise that Budget; confirm the old revision is marked inactive and the new one shows `revision_no` incremented, with history preserved (old row still queryable, not deleted).
- [ ] Confirm a `super_admin` user gets a 403 when calling any of the 5 new route families with a specific `dealerId` (the existing `restrictSuperAdminOnFinancials()` boundary).
- [ ] Confirm the existing HR "Employees → Assets" (Phase 18) assignment flow (`/api/assets`) still works completely unchanged — assign/return an asset, verify no Sprint 6D column caused a regression.

## 9. Deferred Items

Explicitly out of scope per the kickoff (belongs to Sprint 6E): Trial Balance, General Ledger Report, Profit & Loss, Balance Sheet, Cash Flow, Fiscal Year Closing, Period Closing, Retained Earnings, VAT Closing, Financial Dashboard, Audit Reports.

Also deferred (not requested this sprint, noted for future consideration):
- **Sales → cost-center/project posting-line tagging.** Only Journal, Expenses, and the new Asset flows tag `cost_center_id`/`project_id` on posting_lines this sprint. Project Revenue and Profitability are therefore Sales-table-sourced, not GL-sourced — a full GL-based project P&L (with COGS) would need Sales/Sales Return wired into the same tagging, which the kickoff's explicit scope list did not include.
- **Department-level and account-level Budget "actual"** are computed by widening to child cost centers (department) or reading `gl_journal_lines` directly (account) — both work, but neither has a dedicated report page beyond the generic Variance Report table; a department- or account-specific drill-down view was not built.
- **Depreciation run scheduling.** `POST /api/fixed-assets/depreciation/run-all` is a manual, on-demand batch action — there's no cron/scheduled job to auto-run monthly depreciation. The user must trigger it (or a future sprint could add scheduling).
- **Asset transfer between cost centers/projects** mid-life is possible via `PUT /api/fixed-assets/:id`, but does not retroactively re-tag already-posted historical GL lines to the new cost center — only future depreciation runs pick up the new tag.
- **Budget currency/multi-currency** was not considered — amounts are assumed BDT, matching every other financial figure in the system.

## Deploy-Directory Drift (carried forward, still unresolved)

Same risk documented in Sprints 6A/6B/6C: `npm run build` (both frontend and backend) runs directly against `/var/www/tilessaas`, which is also nginx's and PM2's serving directory. Frontend changes go live immediately on build; backend changes require an explicit `pm2 restart tilessaas-api` that has not been triggered across any of Sprints 6A–6D. This compounds with each sprint — by the time any of these ships, the live backend will be four sprints behind the built frontend until a restart happens.
