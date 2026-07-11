# Accounting Engine — Completion Report

Covers Phase 6 (architecture) through Sprint 6E, on branch `v2/sprint-6e-financial-statements-closing`. Written at the close of Sprint 6E per the sprint kickoff's own request for a final accounting-readiness assessment.

## Accounting Modules Completed

| Module | Sprint | Status |
|---|---|---|
| Chart of Accounts (groups/categories/parent-child/contra) | 6A | Complete |
| Fiscal Year / Accounting Period (create, set-current, close/reopen) | 6A | Complete |
| Manual Journal (Draft → Approve → Post → Reverse) | 6A | Complete |
| GL Spine foundation (`gl_accounts`/`gl_journal_entries`/`gl_journal_lines`, Posting Engine mirror) | 6A (foundation predates as P6-01/02) | Complete |
| Customer/Supplier Ledger cleanup, Opening Balances, AR/AP aging, Payment Allocation | 6B | Complete |
| Cashbook, Bank Book, Cheque Register, Bank Reconciliation | 6C | Complete |
| Cost Centers, Departments, Project Accounting, Fixed Assets + Depreciation (straight-line & declining-balance), Budget Management | 6D | Complete |
| Trial Balance (opening/period/closing, fiscal-year + branch filtering) | 6E | Complete |
| General Ledger (per-account drill-down, running balance, export, journal links) | 6E | Complete |
| Profit & Loss (Operating Profit, Other Income/Expenses) | 6E | Complete |
| Balance Sheet (Current/Non-current split, VAT Payable, Fixed Assets) | 6E | Complete |
| Cash Flow (Operating/Investing/Financing classification) | 6E | Complete |
| Financial Closing (Period Closing validation, Fiscal Year Closing, Closing Journal, Retained Earnings posting) | 6E | Complete |
| VAT Closing (Input/Output summaries, Reconciliation, Mushak 9.1 internal draft) | 6E | Complete |
| Financial Dashboard (Current Ratio, Working Capital + reused KPIs) | 6E | Complete |

## GL Finalized

Yes, with one deliberate architectural characteristic worth stating plainly rather than hiding: the system has **two ledgers**, not one —

1. The **GL Spine** (`gl_journal_entries`/`gl_journal_lines`), written automatically by the Posting Engine for every business event (sales, purchases, payments, expenses, fixed assets, cost-center allocations).
2. **Manual Journal** (`journal_entries`/`journal_entry_lines`, Sprint 6A), a free-text-account double-entry workbook for adjustments/accruals/opening balances that a human enters directly.

These were never merged, and Sprint 6E's inspection confirmed why merging them automatically would be unsafe: manual Journal's `account` column is genuinely free text (no Chart-of-Accounts binding — verified against both the schema and the actual `<Input>` field in `JournalPage.tsx`), so there's no reliable way to match "Cash on Hand" typed by a user to GL code `1000` without real risk of silently grouping two different accounts together. Sprint 6E's Trial Balance and General Ledger both read **both** sources and present them as two clearly labeled groups — complete, not hidden, not guessed. Every financial statement built or extended this sprint is aware of this split and sources correctly from each side (e.g., Retained Earnings from Fiscal Year Closing is tracked as its own Journal-sourced figure, separate from the legacy Balance Sheet plug).

## Posting Engine Finalized

Yes. Every business event that moves money now flows through the single choke point (`persistPostingBatch` → `mirrorPostingBatchToGl`), including the `'asset'` line domain added in Sprint 6D for Fixed Asset Purchase/Disposal/Depreciation. No new posting mechanism was added in Sprint 6E — Financial Closing deliberately reuses the **Manual Journal** mechanism instead (a closing entry is an arbitrary "debit this account, credit that one" operation, which is what Manual Journal is for, not what the Posting Engine's business-event line-domain mapper is shaped for).

## Financial Statements Completed

Trial Balance, General Ledger, Profit & Loss, Balance Sheet, Cash Flow, Financial Closing, VAT Closing, and Financial Dashboard are all implemented per Sprint 6E's explicit scope, verified via full backend/frontend typecheck, 511 backend + 373 frontend tests (all passing), and both production builds succeeding. See `docs/SPRINT6E_FINANCIAL_STATEMENTS_CLOSING.md` for full detail on each statement.

## Remaining Accounting Items

Genuine gaps, explicitly out of every sprint's scope so far (not oversights — each was either explicitly deferred by a kickoff or surfaced during inspection and consciously left for a future sprint):

- **Input VAT GL recognition.** GL account `2200 VAT Receivable/Input VAT` is seeded but nothing posts to it — purchase VAT is absorbed into Inventory/AP rather than tracked as a separate recoverable credit. VAT Closing/Reconciliation work entirely from the existing Mushak register totals instead, which are correct but subledger-sourced, not GL-sourced. Fixing this would require touching frozen Sprint 5D/5E purchase-posting logic.
- **Sales/Purchase cost-center and branch tagging.** Only Journal, Expenses, and Fixed Asset events tag `cost_center_id`/`project_id` on posting lines (Sprint 6D's own scope). Sales and Purchases don't, so the Trial Balance's branch filter and Project Accounting's profitability view are both narrower than "all financial activity."
- **Audit Reports.** Referenced in early Phase 6 planning as a "belongs to a later sprint" item but never explicitly assigned to Sprint 6E's own kickoff (which named CRM/Marketing/BI/AI/Manufacturing/Mobile/HR Enhancements as its exclusions, not Audit Reports specifically) — still unbuilt. `audit_logs` table exists and is written to by several routes (GL account edits, journal actions), but there's no dedicated Audit Report UI/endpoint.
- **Financial Ratios beyond Current Ratio and Working Capital.** The Sprint 6E kickoff asked for exactly these two; Quick Ratio, Debt-to-Equity, Return on Equity, and similar ratios were not requested and aren't built.
- **Fiscal Year reopening.** By design — undoing a Fiscal Year Closing requires a reversing Manual Journal entry (the existing `/reverse` workflow), not a "reopen" button. This matches standard accounting practice (a closed year isn't meant to be silently reopened) rather than being an incomplete feature.
- **VAT Closing → GL/cash posting.** VAT Closing records the period's net position for compliance purposes; it does not post a settlement journal or record an actual payment, since no payment date/method is implied by the closing action itself.

## Readiness for ERP V2 Production

**The accounting logic itself is production-ready**: every sprint's verification gate (backend/frontend typecheck, backend/frontend tests, both production builds) has passed cleanly at every stage from 6A through 6E, with zero regressions introduced along the way, and every migration is additive/non-destructive with a working `down()`.

**The deployment is not yet ready**, and this is the one item that has been flagged in every single sprint's documentation since 6A without being resolved: `npm run build` for both frontend and backend runs directly against `/var/www/tilessaas`, which is also nginx's (frontend) and PM2's (`tilessaas-api`, backend) serving directory. Frontend builds go live the instant they land — no restart needed. Backend builds do **not** take effect until `pm2 restart tilessaas-api` is run explicitly, and that has never happened across Sprints 6A, 6B, 6C, 6D, or 6E. Concretely, this means:

- The live backend today is still running Sprint 6A-era code (or earlier), five sprints of accounting logic behind what's been built and committed.
- If the frontend were ever rebuilt and deployed on its own (e.g. for an unrelated fix) without a corresponding backend restart, every new page built in Sprints 6B–6E would call API routes that don't exist yet on the live server, and users would see errors.
- Before any of this ships to real dealers, the recommended sequence is: (1) review and approve this branch, (2) merge/deploy in the normal way, (3) run the actual `pm2 restart tilessaas-api` (and confirm the frontend build lands in the same deploy), (4) smoke-test a few of the new pages against production data for one dealer before wider rollout.

No commits in this engagement have been pushed to any remote, per every sprint's standing instruction — that decision and the actual deploy sequencing remain entirely in the user's hands.
