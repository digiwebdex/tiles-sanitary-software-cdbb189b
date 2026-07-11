# Accounting Engine (Phase 6) — Implementation Roadmap

**Revision 2.** Companion to `docs/ACCOUNTING_V2_ARCHITECTURE.md` (Revision 2) and `docs/ACCOUNTING_REVIEW_RESPONSE.md`. Step 5 of the Phase 6 design task. **Planning only — no code, no migrations have been written.** Every place this revision changes scope or sequencing from Revision 1 is marked **[REVISED]**.

**What changed from Revision 1, in one paragraph:** Revision 1 believed Sales/Purchase's posting-engine/GL wiring was still to be built, and sequenced Sprint 6A as "retrofit the dual-write." That premise was wrong — the wiring already exists and already runs (behind env flags) with three live, undetected bugs (VAT never reaching the GL, a sale's COGS mis-signed as a purchase receipt, reversed sales posting nothing to the GL). Sprint 6A is now **"fix the three bugs, then activate,"** not **"build the dual-write."** Every other sprint's scope is adjusted for the corrected understanding of dealer-scoping requirements, VAT complexity, and the mid-fiscal-year cutover problem.

---

## Sprint 6A — Fix the GL Spine's Existing Defects, Then Activate It, With Fiscal Year Foundation

**[REVISED scope — was "activate," now "fix, then activate."]**

**Why first, unchanged:** everything downstream needs a GL that's both turned on and *correct*. Activating a broken mapper across every dealer's live transactions would be worse than leaving it off.

**Scope:**
1. **Fix Bug A (VAT never reaches the GL):** retire the dead `tax` `line_domain` case in `glLineMapper.ts`; have the GL mirror step for a sale/purchase read the corresponding `tax_posting_lines` row directly and synthesize the VAT/SD GL lines from there (debit/credit `2100 VAT Payable`), and change the `customer`/`sale` GL line to credit `4000 Sales Revenue` at the **taxable** amount, not the VAT-inclusive gross, with AR still debited at the full gross (architecture §2.5).
2. **Fix Bug B (stock sign):** `glLineMapper.ts`'s `stock` case branches on `line_type` (`sale_out` → debit COGS/credit Inventory; `purchase_in` → debit Inventory/credit AP-or-Clearing), not on numeric sign alone.
3. **Fix Bug C (reversal dead branch):** extend the `customer`/`sale` and `supplier`/`purchase` GL mapping cases to handle their own negative-amount (reversed) form directly, removing dependence on the never-populated `'return'` line type.
4. **Add `gl_accounts.normal_balance`** (contra-asset support) and seed the 5 new accounts (`1300`, `1310`, `2200`, `3100`, `6000`) with explicit normal-balance direction, automatically for every dealer (not manual `POST /seed`).
5. **Add `gl_journal_lines.dealer_id` directly** (backfilled via join), matching `posting_lines`' existing convention.
6. Turn `USE_POSTING_ENGINE`/`USE_GL_SPINE` on by default (env vars kept as an emergency kill-switch only) — for Sales and Purchase Order/GRN/Invoice, which already dual-write once Bugs A/B/C are fixed.
7. **Wire Payments and Expenses into the posting engine for the first time** (genuinely new work, unlike Sales/Purchase — confirmed unwired today).
8. **Wire Purchase Return, Landed Cost, and Batch/Stock Cost Adjustment into the posting engine for the first time**, including the two new additive columns on `landed_cost_sheets` (`payment_status`, `charge_vendor_id`) required before Landed Cost can be mapped at all.
9. Build `fiscal_years`/`accounting_periods` (both directly `dealer_id`-scoped) and the period-lock check at the two existing choke points (`persistPostingBatch`, `journal.ts`'s POST handler) — no other route file is touched.
10. Migrate `customer_ledger.type` to the shared enum, **preceded by** the one-time `refund`-vs-`credit_note` classification pass using `sales_returns.refund_mode` (architecture §2.6) — not a blind string→enum rename.
11. Run the newly-correct GL-derived Trial Balance in **parallel** with the existing operational-aggregation one for the remainder of this sprint's testing — do not cut any report over yet.

**Explicitly do NOT implement this sprint:** Cost Centers, Projects cost-side, Fixed Assets/Depreciation, Budget, Bank Reconciliation, Mushak-9.1, Financial Closing, the P&L/Balance Sheet/Cash Flow cutover, the `super_admin` financial restriction (Sprint 6E — it only matters once financial routes with real single-dealer detail exist to protect).

**Verification requirement specific to this sprint:** in addition to the standard bar (below), Sprint 6A must include a test asserting that a sale with non-zero VAT, when GL-mirrored, produces a `2100 VAT Payable` credit equal to the VAT amount and a `4000 Sales Revenue` credit equal to the taxable amount only (not gross) — this is the regression test for Bug A. Equivalent tests for Bugs B and C.

---

## Sprint 6B — Accounts Receivable / Accounts Payable Consolidation

**[REVISED scope — added bad-debt write-off, corrected the advance/credit-note reconciliation logic, added the supplier-side advance-receipt prerequisite.]**

**Scope:**
- Bring Customer Ledger to full parity with Supplier Ledger: Statement, Aging, Credit/Debit Note UI (now meaningfully distinct from `refund`, per Sprint 6A's classification pass).
- Build `receiveSupplierAdvance` (the missing unattached-advance-receipt function, mirroring `receiveAdvancePayment`'s null-`sale_id`-equivalent shape) **before** building `supplier_advance_applications` — the roadmap's dependency order matters here, since the table's `purchase_id` nullability decision depends on this function existing first.
- Build the nightly AR consistency-check job, **corrected** to net out each customer's outstanding unapplied advance/credit-note balance before comparing `mv_customer_outstanding` against a ledger-derived figure — it must not alarm on the normal, structural divergence that partial advance/credit-note application produces.
- **[NEW]** Build the AR/AP bad-debt write-off workflow: a Finance-Manager-approved write-off posts to the new `6100 Bad Debt Expense` GL account and a `write_off`-flagged `adjustment`/`debit_note` ledger row.
- Add `paid_account_id` support to Expense recording, **preceded by** the two prerequisite schema additions (`expenses.paid_account_id`, `expense_ledger.reference_type`/`reference_id`).

**Explicitly do NOT implement this sprint:** Cost Centers, Fixed Assets, Budget, Bank Reconciliation, Mushak-9.1, Financial Closing.

---

## Sprint 6C — Cashbook, Bank Book, Bank Reconciliation & Trial Balance Drill-Down

**[REVISED scope — added the tie-breaking rule and explicit dealer-scoping requirement for reconciliation matching; added Trial Balance drill-down, moved here from being absent entirely.]**

**Scope:**
- Formalize Cashbook/Bank Book to show each entry's GL account (now populated correctly since Sprint 6A fixed the mapper).
- Build Bank Reconciliation: `bank_statement_imports`/`bank_statement_lines` (both directly `dealer_id`-scoped), CSV upload, date+amount auto-matching **with the corrected tie-breaking rule** (§2.14: same-day/same-amount groups are proposed in insertion order but always require manual confirmation, never silently auto-confirmed), manual match/unmatch UI, `bank_ledger.reconciled_at`/`reconciled_by`.
- **[NEW]** Build the Trial-Balance-line → `gl_journal_lines`-detail drill-down view.
- Extend Audit Trail to Bank accounts/transactions and Customer create/update.

**Explicitly do NOT implement this sprint:** live bank-API integration (CSV import only), Cost Centers, Fixed Assets, Budget, Mushak-9.1, Financial Closing.

---

## Sprint 6D — Cost Centers, Project P&L, Fixed Assets & Depreciation, Budget

**[REVISED — every new table explicitly restated as directly `dealer_id`-scoped; otherwise scope unchanged from Revision 1.]**

**Scope:**
- Cost Centers: table + hierarchy, **explicit direct `dealer_id` column** (not transitive), optional `cost_center_id` on posting lines/expenses/purchase items, cost-center slicing on P&L.
- Project cost-side: optional `project_id` on expenses and purchase items, real Project P&L.
- Fixed Asset Register (**explicit direct `dealer_id`**) + straight-line Depreciation schedule (**explicit direct `dealer_id`**, not only inherited via the parent asset) + automated monthly depreciation journal posting (debit `6000`, credit `1310`, now correctly a contra-asset per Sprint 6A's `normal_balance` addition) + disposal workflow.
- Budget vs. Actual: `budgets` table (**explicit direct `dealer_id`**), monitoring only, no spend-blocking.

**Explicitly do NOT implement this sprint:** declining-balance depreciation, automatic budget-overrun blocking, Bank Reconciliation, Mushak-9.1, Financial Closing, the P&L/Balance Sheet/Cash Flow GL cutover (still Sprint 6E), recurring/standing journal entries (deferred indefinitely, not planned in this roadmap at all — a documented, deliberate exclusion, not a silent gap).

---

## Sprint 6E — Financial Statement Cutover, Bangladesh VAT Completion, Financial Closing, Audit Trail Hardening, Super Admin Restriction

**[REVISED — added the Inventory reconciliation job, the corrected mid-fiscal-year closing bootstrap, the corrected/expanded Mushak-9.1 scope, the SD formula fix, the corrected BIN fix (now covering customers too), and the newly-designed `super_admin` financial restriction.]**

**Why last, unchanged:** the highest-stakes cutover in the whole roadmap — only proceeds once the GL has been the correct primary posting path for a full fiscal period and reconciles.

**Scope:**
- Cut Profit & Loss, Balance Sheet, and Trial Balance over to GL-derived only, **only after** a full fiscal period's parallel-run numbers reconcile to the cent for every active dealer.
- **[NEW]** Build the Inventory GL-vs-live-`stock` reconciliation job (architecture §2.13) — the same drift risk the AR/AP job addresses, applied symmetrically to Inventory, which Revision 1 omitted.
- Build the real three-statement Cash Flow (Operating/Investing/Financing).
- **[REVISED]** Fix the Supplementary Duty calculation order in `computeVatBreakdown` (SD folded into the VAT base before VAT is computed, architecture §2.15) **before** activating any non-zero `sd_rate` — this is now an explicit, ordered prerequisite, not bundled loosely with "add SD support."
- **[REVISED]** Build Mushak-9.1 as an **internal draft report with a mandatory review disclaimer**, with its v1 data model explicitly including a rebate-eligibility flag, a goods/services flag, an Advance Trade VAT placeholder field, and a carry-forward-aware `2200 VAT Receivable` balance — not the bare "Output − Input" netting Revision 1 specified. **Validate the report's field layout against the then-current official NBR Mushak-9.1 form** before shipping, as an explicit acceptance criterion.
- **[REVISED]** Add `bin` to both `suppliers` and `customers` (Revision 1 only addressed suppliers), backfill from `gstin`/`tax_id`, and update every read path (`vatReportService.ts`, `taxPostingService.ts`, `purchases.ts`, `purchaseInvoices.ts`) to read `bin` — listed explicitly, not left to be inferred.
- **[NEW]** Add VAT-domain reversal on sale return, so the Mushak-6.3 register nets out VAT on returned goods correctly.
- Financial Closing: month-end/year-end close action, Clearing-account-must-be-zero check, year-end Income/Expense-to-Retained-Earnings rollover — **[REVISED]** now an explicit, tested requirement that the rollover query is `dealer_id`-parameterized and touches only the closing dealer's rows (acceptance test: "closing dealer A's fiscal year does not affect dealer B's Retained Earnings"), and **[NEW]** the mid-fiscal-year activation bootstrap procedure (architecture §2.3/§2.16) is implemented for every dealer whose GL activation date doesn't align with their fiscal year boundary — which will be the default case, not the exception, for every dealer active before Phase 6 ships.
- **[NEW]** Design and ship `restrictSuperAdminOnFinancials()`, applied to every Phase 6 financial route (GL detail, Journal unified view, Fixed Assets, Budget, Bank Reconciliation, cut-over Financial Statements), plus a genuine cross-tenant aggregate-only view for `super_admin`, built by extending the existing `adminStats.ts` pattern — not a change to `requireRole` or any pre-Phase-6 route.
- Final Audit Trail hardening: GL/Journal entries, Fixed Assets, Budgets, Cost Centers, Fiscal Year/Period actions all gain audit logging, explicitly covered by the new `super_admin` restriction for the financial-action subset.

**Explicitly do NOT implement this sprint:** NBR e-filing integration, multi-currency, consolidated multi-dealer/group reporting, live Advance Trade VAT automation (the ATV field is manually populated in v1), VAT deduction-at-source (VDS) automation.

---

## Cross-Sprint Requirements (unchanged, apply to every sprint above)

- **Verification per sprint:** backend typecheck, frontend typecheck, backend tests, frontend tests, production backend build, production frontend build.
- **Documentation per sprint:** `docs/SPRINT6X_<NAME>.md` with Files Changed, Database Impact, API Impact, UI Impact, Testing Report, Rollback Plan, Manual QA Checklist, Out-of-Scope List.
- **No destructive migrations, ever** — every schema change in this roadmap is additive.
- **Stop after each sprint, wait for approval** before starting the next.
