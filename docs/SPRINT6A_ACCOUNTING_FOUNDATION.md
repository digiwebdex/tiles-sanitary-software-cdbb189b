# Sprint 6A — Accounting Foundation (Fix the GL Spine's Defects, Then Activate It, With Fiscal Year Foundation)

Branch: `v2/sprint-6a-accounting-foundation` (created from `v2/sprint-5e-purchase-return` tip `00c07f4`)
Source of truth: `docs/ACCOUNTING_V2_ARCHITECTURE.md` (Rev 2), `docs/ACCOUNTING_IMPLEMENTATION_ROADMAP.md` (Rev 2), `docs/ACCOUNTING_REVIEW_RESPONSE.md`. None of these three documents were modified by this sprint.

## 1. Files Changed

### Backend — new files
- `backend/src/db/migrations/098_accounting_foundation.ts` — Chart of Accounts widening, Fiscal Year + Accounting Period tables, Journal status workflow columns, GL journal line dealer scoping.
- `backend/src/services/accounting/periodLock.ts` — `assertPeriodOpen()` / `PeriodClosedError`, the single period-lock choke point.
- `backend/src/routes/fiscalYears.ts` — Fiscal Year / Period / Opening Balance link endpoints.
- `backend/src/services/accounting/periodLock.test.ts`
- `backend/src/routes/fiscalYears.query.test.ts`
- `backend/src/routes/journal.query.test.ts`
- `backend/src/routes/gl.query.test.ts`

### Backend — modified files
- `backend/src/lib/glChart.ts` — default chart extended 11 → 17 accounts (Accumulated Depreciation, Retained Earnings, Sales Returns & Allowances, Depreciation Expense, etc.); `GlAccountTemplate` extended with `normal_balance`/`is_contra`/`is_group`/`category`.
- `backend/src/services/gl/glJournalWriter.ts` — `ensureDealerGlChart` writes the new columns; new `lookupTaxSplit()` (reversal-aware `tax_posting_lines` lookup); `mirrorPostingBatchToGl` passes tax split through and logs unbalanced batches; `backfillGlForDealer` carries `event_type`/`reverses_batch_id`.
- `backend/src/services/gl/glLineMapper.ts` — rewritten. Fixes Bugs A (VAT never reached GL), B (sale stock sign), C (reversal produced zero GL lines), and D (purchase double-counted Inventory via both Clearing and AP legs).
- `backend/src/services/posting/types.ts` — `PostingDocumentType` widened additively.
- `backend/src/services/posting/postingLineWriter.ts` — calls `assertPeriodOpen()` before `createPostingBatch`; passes `eventType`/`reversesBatchId` to the GL mirror.
- `backend/src/services/posting/PostingOrchestrator.ts` — `isPostingEngineEnabled()` inverted to on-by-default (kill-switch semantics).
- `backend/src/services/gl/glConfig.ts` — `isGlSpineEnabled()` inverted identically.
- `backend/src/middleware/roles.ts` — `AppRole` widened with `senior_accountant` / `finance_manager`; new `restrictSuperAdminOnFinancials()` guard.
- `backend/src/routes/gl.ts` — rewritten: Chart of Accounts CRUD (groups/categories/contra), seed endpoint, GL consistency check, all role-gated.
- `backend/src/routes/journal.ts` — rewritten: Draft/Approve/Post/Reverse workflow, immutability (DELETE restricted to draft only).
- `backend/src/services/gl/glLineMapper.test.ts` — rewritten for the new mapper API and bug-fix coverage.
- `backend/src/index.ts` — registers `fiscalYearsRoutes` at `/api/fiscal-years`.

### Frontend — new files
- `src/services/glAccountService.ts` — Chart of Accounts API client.
- `src/services/fiscalYearService.ts` — Fiscal Year / Period API client.
- `src/pages/journal/ChartOfAccountsPage.tsx` — list/create/edit accounts, seed default chart, GL/Posting-engine status badges.
- `src/pages/journal/FiscalYearPage.tsx` — create fiscal year (auto-generates monthly periods), set current, link Opening Balance journal entry, close/reopen periods.

### Frontend — modified files
- `src/services/financialService.ts` — `JournalEntryStatus` type; `JournalEntry` extended with status/timestamps/reversal fields; `journalService.list()` accepts a `status` filter; added `createDraft`/`approve`/`post`/`reverse`; fixed `remove()` error parsing.
- `src/pages/journal/JournalPage.tsx` — status badges, per-row Approve/Post/Reverse actions, Delete restricted to draft rows, "Save as Draft" vs "Save & Post" in the create dialog.
- `src/App.tsx` — routes for `/journal/chart-of-accounts` and `/journal/fiscal-years`.
- `src/config/navConfig.ts` — nav entries for both new pages (same visibility as the existing `/journal` entry: `dealerAdminOnly`, gated by the `advanced_finance` plan feature).

## 2. Database Impact

Migration `098_accounting_foundation.ts`, fully additive:
- `gl_accounts`: + `normal_balance`, `is_contra`, `is_group`, `category` (all nullable/defaulted; existing rows backfilled).
- `fiscal_years` (new table): `dealer_id`, `name`, `start_date`, `end_date`, `is_current`, `opening_balance_journal_id`, `created_by`. Unique on `(dealer_id, name)`.
- `accounting_periods` (new table): `dealer_id`, `fiscal_year_id`, `period_no`, `start_date`, `end_date`, `status` (`open`/`closed`), `closed_at`, `closed_by`.
- `journal_entries`: + `status`, `approved_by`, `approved_at`, `posted_by`, `posted_at`, `reverses_journal_entry_id`. All existing rows backfilled to `status = 'posted'`.
- `gl_journal_lines`: + `dealer_id` (backfilled via join to `gl_journal_entries`), for the same reason every other financial table is directly dealer-scoped rather than relying on a join.

No column drops, no data deletion, no `NOT NULL` added without a default+backfill. `down()` reverses every step.

## 3. API Impact

New:
- `GET/POST/PUT /api/gl/accounts`, `POST /api/gl/accounts/seed`, `GET /api/gl/consistency-check`
- `GET /api/fiscal-years`, `GET /api/fiscal-years/current`, `POST /api/fiscal-years`, `POST /api/fiscal-years/:id/set-current`, `POST /api/fiscal-years/:id/set-opening-balance-journal`, `GET /api/fiscal-years/:id/periods`, `POST /api/fiscal-years/:fyId/periods/:pId/close`, `POST /api/fiscal-years/:fyId/periods/:pId/reopen`
- `POST /api/journal/draft`, `POST /api/journal/:id/approve`, `POST /api/journal/:id/post`, `POST /api/journal/:id/reverse`

Changed (backward-compatible):
- `POST /api/journal` — unchanged request/response shape, now additionally enforces the period lock and role gate.
- `DELETE /api/journal/:id` — now rejects with 409 unless the entry's `status = 'draft'` (previously any entry could be soft-deleted).
- `GET /api/journal`, `GET /api/journal/:id` — response now includes the new status/timestamp fields; existing consumers reading only the pre-existing fields are unaffected.
- `GET /api/gl/trial-balance` — unchanged behavior, now gated by `restrictSuperAdminOnFinancials()`.

All new/changed endpoints require one of `dealer_admin`, `super_admin`, `accountant`, `manager`, `senior_accountant`, `finance_manager` to view, and a narrower `MANAGE`/`EDIT`/`SEED` role set to mutate — see `docs/ACCOUNTING_V2_ARCHITECTURE.md` §4 for the full matrix. `restrictSuperAdminOnFinancials()` additionally rejects `super_admin` outright on every one of these routes as soon as a `dealerId` is supplied — and since `resolveDealer()` requires `super_admin` to supply one (there is no `req.dealerId` for a super_admin), the practical effect is that `super_admin` cannot call any Sprint 6A financial endpoint at all. This is the corrected, enforced version of the "no drill-down" behavior the Phase 6 review found was only ever claimed, never implemented (findings #7/#29/#30) — not a preservation of the old permissive behavior.

## 4. Accounting Impact

- **GL Spine activated.** `USE_GL_SPINE` / `USE_POSTING_ENGINE` now default to **on** (previously off-by-default); either can still be force-disabled via `=false`/`=0` as an emergency kill switch.
- **Bug A fixed:** VAT/SD now reach the GL (previously the `tax` domain was silently dropped by the mapper).
- **Bug B fixed:** a sale's stock/COGS leg now posts with the correct sign.
- **Bug C fixed:** reversing a posted sale or purchase now correctly reverses BOTH the AR/AP-Revenue leg AND its VAT leg (previously a reversal's tax lookup silently found nothing and posted the gross amount, leaving VAT Payable permanently wrong).
- **Bug D fixed (newly discovered this sprint, not in the original review):** a purchase no longer double-books Inventory (once via a Clearing-account leg, once via the AP leg) — `stock`/`purchase_in` lines now produce zero GL entries since the `supplier`/`purchase` leg alone fully captures the effect.
- **Period Lock enforced** at the single choke point (`persistPostingBatch`, used by every posting-engine-mirrored document) and in the manual Journal — once a period is closed, no entry dated inside it can post, until explicitly reopened with a reason.
- **Journal is now Draft → Approve → Post → Reverse**, immutable once posted (correcting a posted entry requires a Reversal, never an edit/delete).
- **Chart of Accounts** gains Account Groups (`is_group`), Contra Accounts (`is_contra` + explicit `normal_balance` override), and free-text Categories, without a rigid new lookup table.
- **Trial Balance, P&L, Balance Sheet, Cash Flow, AR/AP redesign, Cost Centers, Projects, Assets, Budget, VAT/Mushak reports, Financial Closing** — explicitly NOT touched this sprint, per the roadmap's Sprint 6A scope boundary.

## 5. UI Impact

- Journal Entries page: status badges (Draft/Approved/Posted), a "reversed" indicator, per-row Approve/Post/Reverse actions, Delete limited to draft rows, and a Draft-vs-Post choice in the create dialog.
- New Chart of Accounts page: list, create, edit (system accounts restricted to name/parent/category/active edits), seed default chart, GL Spine / Posting Engine status badges.
- New Fiscal Years page: create a fiscal year (auto-generates monthly periods), set current, link an Opening Balance journal entry, view/close/reopen periods (reopen requires a reason).
- Both new pages are nav-gated identically to the existing `/journal` entry (dealer owner + super_admin only, requires the `advanced_finance` plan feature) — no new frontend role-visibility plumbing was introduced for Senior Accountant/Finance Manager, since those roles aren't yet assignable from the Role Management UI; API-level enforcement for them is already in place and ready for when that UI catches up.
- No dashboards or financial-statement UI were added — out of scope per the roadmap.

## 6. Testing Report

- Backend: **56 test files, 424 tests, all passing** (`cd backend && npx vitest run`). New: `glLineMapper.test.ts` (16, rewritten), `fiscalYears.query.test.ts` (14), `journal.query.test.ts` (14), `periodLock.test.ts` (6), `gl.query.test.ts` (11).
- Frontend: **57 test files, 373 tests, all passing** (`npx vitest run`).
- Backend typecheck (`npx tsc --noEmit`): clean for every Sprint 6A file. Seven pre-existing errors remain in `backend/src/services/warehouseTransferStock.test.ts` (Sprint 3B, unmodified since, confirmed byte-identical to the `v2/sprint-5e-purchase-return` baseline) — unrelated to this sprint and left untouched per "refactor only where approved."
- Frontend typecheck (`npx tsc --noEmit`): clean, zero errors.
- Backend production build (`npm run build`): emits `dist/index.js` (the pre-existing warehouseTransferStock.test.ts errors don't block emission — `noEmitOnError` was never set, matching prior sprints).
- Frontend production build (`npm run build`): succeeds, `dist/assets/index-*.js` ~3.8MB (910KB gzip) — pre-existing bundle-size warning, not introduced by this sprint.

## 7. Rollback Plan

- **Fastest rollback (no code change):** set `USE_GL_SPINE=false` and `USE_POSTING_ENGINE=false` in the environment and restart the API. This restores the exact pre-Sprint-6A dormant-GL behavior instantly, since the flags are still fully respected as a kill switch.
- **Journal workflow:** if Draft/Approve/Post/Reverse causes issues, the plain `POST /api/journal` (immediate-post) path is unchanged and still works; only `DELETE` behavior tightened (draft-only) — reverting requires re-deploying the pre-Sprint-6A `journal.ts`.
- **Schema:** `098_accounting_foundation.ts` has a complete `down()` that drops `accounting_periods`/`fiscal_years`, removes the added columns from `gl_accounts`/`journal_entries`/`gl_journal_lines`. Nothing in this migration is destructive to pre-existing data, so rollback is safe to run even after production use, as long as no fiscal year/period/new-status journal rows need to be preserved.
- **Git:** this sprint is isolated to `v2/sprint-6a-accounting-foundation`; nothing has been merged or pushed, so simply not merging the branch is itself a full rollback.
- **⚠️ Deploy-directory note:** as part of this sprint's required verification, `npm run build` was run in both the frontend and `backend/`. Since `/var/www/tilessaas/dist` is what nginx serves live and `/var/www/tilessaas/backend/dist` is what the running `tilessaas-api` PM2 process was originally launched from, both on-disk build outputs now reflect Sprint 6A's uncommitted code. The **frontend** change is already live (nginx serves static files with no separate deploy step). The **backend** change is NOT yet live — Node has the old code cached in memory and only picks up the new `backend/dist` on a PM2 restart, which was deliberately not triggered. Flagging this so you can decide when (or whether) to restart `tilessaas-api`, since among this sprint's changes are the GL/Posting-engine flags flipping to on-by-default.

## 8. Manual QA Checklist

- [ ] Seed the default chart for a test dealer (`POST /api/gl/accounts/seed`) and confirm 17 accounts appear, including the 6 new ones.
- [ ] Create a custom account with `is_group: true`; confirm it cannot receive postings (no consumer treats it as postable — verify via the UI, since posting-time enforcement of `is_group` is a Sprint 6B+ concern).
- [ ] Create a contra account (e.g. Accumulated Depreciation) under `asset` with `normal_balance: credit`; confirm it saves and displays correctly.
- [ ] Create a fiscal year spanning e.g. 12 months; confirm 12 monthly `accounting_periods` rows are auto-created.
- [ ] Close a period, then attempt to post a Journal entry or a Sale dated inside it; confirm it's rejected with a period-closed error.
- [ ] Reopen that period with a reason; confirm the same posting now succeeds.
- [ ] Create a Journal entry as Draft; confirm it does NOT appear in the GL/Trial Balance until posted.
- [ ] Approve, then Post that draft; confirm posted entries can no longer be deleted (button hidden, and a direct DELETE call returns 409).
- [ ] Reverse a posted entry; confirm a new mirrored entry appears and the original shows a "reversed" indicator.
- [ ] Post a Sale with VAT; confirm the GL now shows a VAT Payable credit (Bug A) alongside Revenue and AR.
- [ ] Reverse that same sale; confirm VAT Payable is credited back down to zero, not left stranded (Bug C).
- [ ] Post a Purchase; confirm Inventory is debited exactly once, not twice (Bug D).
- [ ] Run `GET /api/gl/consistency-check`; confirm `unbalanced_count: 0` on a dealer with normal activity.
- [ ] Log in as a user with only the `senior_accountant` or `finance_manager` role (assign directly in the DB, since the Role Management UI doesn't expose these yet) and confirm the API-level permissions match the approved matrix.
- [ ] Confirm `super_admin` cannot call any Chart of Accounts / Fiscal Year / Journal / GL Trial Balance endpoint for any dealer at all (per `restrictSuperAdminOnFinancials()` — there is no impersonation exception).

## 9. Deferred Items

Everything explicitly out of scope per the roadmap, unchanged from the plan: Trial Balance / P&L / Balance Sheet / Cash Flow report UI, Bank Reconciliation, AR/AP redesign, Cost Centers, Projects, Assets, Depreciation, Budget, VAT/Mushak reports, Financial Closing (fiscal-year-end rollover), dashboards. Also still deferred, called out in earlier Phase 6 documents and unaffected by this sprint: VAT-inclusive pricing option (#20), recurring journal entries (#39), inter-branch accounting (#40), and giving a reversal batch its own `tax_posting_lines` row (tracked for Sprint 6E — this sprint's `lookupTaxSplit()` fix works around the gap by keying off the original batch, not eliminating it). Frontend role-based nav visibility for Senior Accountant/Finance Manager is deferred until those roles are assignable from the Role Management UI.
