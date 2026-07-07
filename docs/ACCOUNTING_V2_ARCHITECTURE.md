# Accounting Engine (Phase 6) — Architecture

**Status:** Design document only. No code, no migrations were written for this phase. Product, Inventory, Sales, and Purchase (V2 Sprints 1–5E) are frozen and are inputs to this design, not modified by it.

**Revision note:** This is Revision 2, written in response to a five-persona adversarial review of Revision 1 (see `docs/ACCOUNTING_REVIEW_RESPONSE.md` for the full finding-by-finding disposition). Revision 1's Step 1 inspection contained a materially wrong claim — that Sales and Purchase do not yet dual-write into the posting engine — which this revision corrects, and which is why the review caught two live bugs (§1.1) that Revision 1 missed entirely. Every place this revision changes a substantive claim or design decision from Revision 1 is marked **[REVISED]**.

**Written as:** ERP Architect / Accounting Software Architect / Bangladesh VAT Consultant / Financial System Designer / SaaS Multi-Tenant Architect, for Digiwebdex SaniTiles ERP.

---

# STEP 1 — Inspection of the Existing System (Corrected)

## 1.0 [REVISED] Correction to Revision 1's central claim

Revision 1 stated: *"today, only the VAT domain actually writes here in practice... Sales, Purchases, Payments, and Expenses do not yet dual-write into `posting_batches`/`posting_lines` despite the infrastructure being ready."*

**This is factually wrong, verified directly against the code:**

- `backend/src/routes/sales.ts:1155-1206` and `backend/src/routes/purchases.ts:1057-1107` **already call** `mirrorToPostingTables(...)`, gated only by `isPostingEngineEnabled()` (an env-var check, not missing code) — on both create/finalize **and** reversal (`sales.ts:361-378`, `purchases.ts:346-388`, using `invertPostingLines` to build the reversing batch).
- `backend/src/services/posting/postingLineWriter.ts:91-124` (`persistPostingBatch`) **already unconditionally mirrors every posting batch into the GL** (`mirrorPostingBatchToGl`) whenever `isGlSpineEnabled()` is true — this is not new work either.
- `backend/src/services/gl/glFinancialsBridge.ts` and its wiring into `backend/src/routes/financials.ts:51-54` already implement the "run GL Trial Balance in parallel" mechanism Revision 1 described as future work.

**What is actually true:** Sales and Purchase are wired end-to-end (posting engine + GL mirror + reversal), gated behind `USE_POSTING_ENGINE`/`USE_GL_SPINE`. **Payments** (`recordCustomerPayment`, `recordSupplierPaymentFifo` and their `lib/` helpers) and **Expenses** (`expenses.ts`) genuinely do not dual-write yet — Revision 1's claim was correct for those two domains only. VAT's separate path (`tax_posting_lines`, entirely disconnected from `posting_lines`) is unchanged from Revision 1's description.

**Why this correction matters for the whole design:** because Revision 1 believed the existing mapper code was dormant and therefore presumptively untested/harmless, its own inspection never asked "does this code actually produce correct output when exercised?" It does not, in two concrete, verified ways:

### Bug A — VAT never reaches the GL; Sales Revenue is overstated by the VAT amount
`backend/src/services/posting/types.ts:15` defines a `'tax'` `line_domain`, and `glLineMapper.ts:102-111` has a full, plausible-looking mapping case for it (`credit VAT_PAYABLE / debit CLEARING`) — but **nothing in the codebase ever constructs a `posting_lines` row with `line_domain: 'tax'`** (verified: zero matches for `lineDomain: 'tax'` anywhere in `LedgerPostingEngine.ts`/`StockPostingEngine.ts`). VAT instead flows exclusively through the separate `tax_posting_lines` table via `insertTaxPostingLine`, which the posting engine never sees. Meanwhile, `backend/src/routes/sales.ts:783` sets `totalAmount = vatBreakdown.total_with_tax` (the VAT-**inclusive** gross figure), which is exactly what `buildSaleLedgerLines` (`LedgerPostingEngine.ts:145-159`) posts as the `customer`/`sale` line — mapped by `glLineMapper.ts:44-48` to `debit AR / credit SALES` for the **full gross amount, VAT included**. Net effect: with GL flags on today, a 1000+150(VAT)=1150 sale posts `debit AR 1150 / credit Sales Revenue 1150` and nothing ever credits `2100 VAT Payable`. **Sales Revenue is permanently overstated by the VAT collected, for every VAT-registered dealer, the moment the flags are flipped.**

### Bug B — A sale's COGS is mis-signed as a purchase-in
`backend/src/services/posting/StockPostingEngine.ts` (`buildSaleStockLines`) posts `stock`-domain lines with `lineType: 'sale_out'`, `amount: round2(item.cogsAmount)` — always **positive**, since `itemCogs` (`sales.ts:1102-1104`) is computed as a plain cost magnitude, never negated. `glLineMapper.ts:112-125`'s `stock` case branches purely on the numeric sign of `amt` (`amt > 0` → debit Inventory/credit Clearing, the purchase-receipt shape; `amt < 0` → debit COGS/credit Inventory, the correct sale shape) — it has no awareness of `line_type` at all for this domain. A sale's always-positive `cogsAmount` therefore **always falls into the purchase-receipt branch**: every sale, once GL is trusted, would incorrectly inflate Inventory and Clearing instead of recognizing COGS and depleting Inventory.

### Bug C — Reversed sales silently post nothing to the GL
`glLineMapper.ts:53-59`'s `customer` case has a `line_type === 'return'` branch, but nothing ever sets `lineType: 'return'` — the actual reversal path (`invertPostingLines.ts:12-19`) preserves the original `line_type` (`'sale'`) and only negates the `amount`. A negative-amount `'sale'`-typed line matches neither the `amt > 0` `'sale'` branch nor the never-populated `'return'` branch — it produces **zero GL lines**. A sale reversal today, with GL flags on, would correctly reverse `customer_ledger`/`cash_ledger`/`stock` but leave the GL's AR/Sales Revenue completely unreversed.

None of these three bugs is hypothetical or requires new code to trigger — they are live, dormant defects in already-shipped code, invisible today only because `USE_GL_SPINE` defaults off. **Fixing all three is now the first, mandatory prerequisite of Sprint 6A** (§2.5, Roadmap 6A) — GL activation cannot proceed on top of them.

## 1.1 What Already Exists (unchanged findings, carried forward from Revision 1)

*(Everything below was independently re-verified during the review and stands as originally reported, except where marked.)*

### A real, working double-entry Journal
- **Tables:** `journal_entries` + `journal_entry_lines` (migration `031`), hardened with soft-void (`voided_at`/`voided_by`/`void_reason`) in migration `081`.
- **Route:** `backend/src/routes/journal.ts` — `dealer_admin`-only, enforces `SUM(debit) = SUM(credit)` (±0.01) and exactly one of debit/credit > 0 per line at insert time. Auto-numbers vouchers `JV-YYYYMM-NNNN`.
- This remains the one clean, verified-correct, human-authored double-entry mechanism in the system.

### A GL spine (chart of accounts + mirrored double-entry journal) — built, wired, and **live the moment its flag flips**, not merely "dormant"
- **Tables:** `gl_accounts` (`code`, `name`, `account_type` ∈ asset/liability/equity/income/expense, `parent_code` hierarchy — CHECK-constrained, migration `068`), `gl_journal_entries` (1:1 with a `posting_batches` row), `gl_journal_lines` (debit/credit pairs, CHECK-constrained to exactly one side, with a `posting_line_id` back-reference).
- **[REVISED]** `gl_journal_lines` has **no direct `dealer_id` column** — it can only be scoped by joining through `gl_journal_entries.dealer_id`. This deviates from this same migration era's own convention (`posting_lines`, migration `053`, carries `dealer_id` directly specifically so dealer-scoped filters can't be forgotten). `getTrialBalance()` (`glJournalWriter.ts`) does the join correctly today, but as this table becomes the sole source of every financial statement (§2.13), a missing direct column on the highest-volume, highest-stakes table in the whole design is a real risk, not a style nit. **Fixed in §2.5.**
- **Default chart** (`backend/src/lib/glChart.ts`, in-memory): `1000 Cash`, `1010 Bank`, `1100 AR`, `1200 Inventory`, `2000 AP`, `2100 VAT Payable`, `3000 Owner Equity`, `4000 Sales Revenue`, `5000 COGS`, `5100 Operating Expenses`, `5900 GL Clearing/Suspense`.
- **[REVISED]** `gl_accounts` has no way to represent a **contra-asset** (a natural-credit-balance account nested under an asset type, e.g. Accumulated Depreciation) — the schema only carries `account_type`, not a normal-balance direction. **Fixed in §2.1/§2.11.**
- **Mapping engine:** `glLineMapper.ts` — see Bugs A/B/C above for what's actually wrong with it today. The `customer`/`payment`, `supplier`/`purchase`, `supplier`/`payment`, `cash`, and `bank` cases were independently re-verified during the review and do balance correctly as originally described — only the `tax`, `stock`, and `customer`/reversal cases are broken.
- **Feature flag:** `USE_GL_SPINE`. Off by default in production today — but "off" means "untested in production," not "doesn't exist" or "isn't wired."

### A posting engine (append-only financial-effects log) — wired into Sales/Purchase already; genuinely unwired only for Payments and Expenses
- **Tables:** `posting_batches` (one per document post/reverse, `event_type` ∈ posted/reversed, `reverses_batch_id` self-link, idempotency key) + `posting_lines` (7 `line_domain`s: `stock`, `customer`, `supplier`, `cash`, `bank`, `expense`, `tax`) — migration `053`.
- **[REVISED]** Every existing call site funnels through exactly one shared function: `persistPostingBatch`/`createPostingBatch` in `backend/src/services/posting/postingLineWriter.ts`. This is a genuine architectural asset the review surfaced implicitly and this revision makes explicit: **there is already a single choke point every dual-writing transaction passes through**, which is the natural place to add fiscal-period-lock enforcement (§2.2/§2.5) without touching 20+ individual route files.
- `postingTraceService.ts`'s hybrid read (prefers posting-engine batches, falls back to legacy ledgers) remains a sound, reusable pattern.
- `PostingDocumentType` (`posting/types.ts`) is a closed union, currently `'purchase' | 'sale'` only — will need additive widening for `payment`, `expense`, `purchase_return`, `landed_cost`, `stock_cost_adjustment` as those domains are wired in (§2.5).

### A live Bangladesh VAT engine (partial Mushak compliance) — with two real, fixable defects the review surfaced
- **Math:** `backend/src/lib/vatMath.ts` — `computeVatBreakdown(amountAfterDiscount, settings, sdRatePct)`, VAT-exclusive, per-dealer `default_vat_rate` (default 15%).
- **[REVISED — CORRECTED FORMULA REQUIRED]** The existing formula computes VAT and SD **independently off the same base and sums them**: `vat_amount = taxable_amount × vat_rate`, `sd_amount = taxable_amount × sdRatePct`. Bangladesh's VAT and SD Act 2012 requires SD to be **folded into the VAT base before VAT is computed** — i.e. `SD = base × sd_rate`, then `VAT = (base + SD) × vat_rate`. At 15% VAT + 20% SD on a 1000 taxable base, the correct result is SD=200, VAT base=1200, VAT=180, total=1380; the existing formula gives SD=200, VAT=150 (on 1000 only), total=1350 — understating VAT by 30 per 1000 of SD-bearing value. This has had zero production impact to date only because `sdRatePct` is never passed by any caller (always defaults to 0) — but Sprint 6E's stated goal is to activate exactly this parameter, so **the formula itself must be corrected before SD is turned on**, not merely wired up. See §2.15.
- **Tax posting:** `backend/src/services/taxPostingService.ts` — `insertTaxPostingLine()` writes to `tax_posting_lines` (migration `063`) for every sale/purchase with non-zero tax, tagged `mushak_form: '6.3' | '6.1'`. **[REVISED]** No corresponding reversal call was found on the sale-reversal path (`sales.ts`'s reverse handler calls `insertSaleReverseLedgerEntries` and the posting-engine mirror, but no VAT-domain reversal) — meaning the Mushak-6.3 sales register likely overstates output VAT after a return today. This must be verified and fixed as part of Sprint 6A/6E's VAT work (§2.15).
- **Reports:** `GET /api/reports/vat/sales-register` (Mushak-6.3) and `/purchase-register` (Mushak-6.1) — real, live, unmodified.
- **Genuine gaps, more precisely scoped than Revision 1 stated:** no Mushak-9.1 monthly VAT return; no input-VAT recovery/net-VAT-payable; **[REVISED]** the "just add input VAT recovery" framing in Revision 1 was itself incomplete — Bangladesh VAT law restricts which input VAT is actually rebatable (supply must be for a taxable output, properly documented, claimed within the period's time limit), distinguishes goods from services, and has a separate Advance Trade VAT (ATV) mechanism for imports and a carry-forward (not always cash-refund) treatment for a net-input-VAT period — none of which existed in Revision 1's design. **Corrected in §2.15.** No dedicated Bangladesh BIN field — `suppliers.gstin` is an India-GST-era misnomer; `dealers.tax_id`/`customers.tax_id` are generic unlabeled text. **Fix plan corrected in §2.15** (Revision 1's "just add a synonym column" was underspecified).

### Financial statements — real, but computed as an operational aggregation, not from the GL spine
- **P&L** (`GET /api/financials/p-and-l`): revenue from `SUM(sales.total_amount)`, COGS from `sales.cogs`, expenses from `expenses.category`.
- **Balance Sheet** (`GET /api/financials/balance-sheet`): Cash from `cash_ledger`, Bank from `bank_ledger`, Inventory from live `stock` valuation, AR from `sales.total_amount - sales.paid_amount`, AP from supplier payable, **Equity from `director_transactions` with Retained Earnings plugged as the balancing residual** — verified accurate against `financials.ts:354-397` during the review.
- **Trial Balance** exists in two forms today: the operational-aggregation one and the GL-derived one (`/api/gl/trial-balance`, gated behind `USE_GL_SPINE`).
- **Cash Flow**: only a basic monthly cash-in/cash-out bucket — no real three-statement structure.
- **[REVISED]** No Trial-Balance-line → underlying-journal-entries drill-down exists anywhere, in either the legacy or GL-derived path — for a Finance Manager doing month-end review, an aggregate-only Trial Balance with no way to inspect what produced a number is a real, standard-accounting-package-table-stakes gap. **Added to scope, §2.13.**

### Customer Ledger / Supplier Ledger / Cashbook / Bank Book — live, single-entry, and asymmetric in ways deeper than Revision 1 identified
- **Customer ledger** (`customer_ledger`, migration `001`): `type` is a **free-text varchar**. Confirmed via exhaustive grep that only 5 literal values are ever written in the current codebase (`sale`, `payment`, `refund`, `adjustment`, `opening_balance`) — no messy/inconsistent legacy data exists, so a schema-level migration to an enum is mechanically safe.
- **[REVISED — Revision 1's stated rationale for this migration was incomplete]** Revision 1's plan to add `credit_note`/`debit_note` to the customer side, on the stated grounds that "the customer side has no dedicated credit_note/debit_note types, only a generic `adjustment`," is true as far as it goes but **misses that a customer credit note already exists as a live feature today**, implemented via `sales_returns.refund_mode = 'credit'` (`backend/src/services/creditNoteService.ts`, migration `092`), which writes a `customer_ledger` row with `type = 'refund'` — **the same type used for a genuine cash refund.** A dedicated `customer_credit_note_applications` table (mirroring `customer_advance_applications`) already tracks drawdown against these. Additionally, `adjustment` rows already carry **negative** amounts in production (`collections.ts`'s write-off endpoint, explicitly documented in-code as "a negative amount decreases it, e.g. a write-off"). **A straight string→enum migration that only adds new values, without first auditing and reclassifying which historical `refund` rows are real cash refunds vs. credit notes in disguise, would leave the new Credit/Debit Note UI (§2.6) unable to distinguish them — and would risk miscoding the GL mapping for `refund`-typed posting lines (which should credit Cash/Bank for a real refund but must NOT for a credit note, since no cash moves).** Corrected migration plan: §2.6.
- **Supplier ledger** (`supplier_ledger`, migration `001`, extended `096`/`097`): `type` is a strict Postgres enum — `sale, purchase, payment, refund, expense, receipt, adjustment, credit_note, debit_note, purchase_return`. `computeSupplierBalance`'s uniform `balance += -amount` rule was independently re-verified against every write site (`purchases.ts`, `supplierPayment.ts`, `supplierLedgerEntries.ts`) during the review and confirmed **accurate as originally described** — no issue here.
- **[REVISED]** `mv_customer_outstanding` (reads `sales.due_amount`) vs. `mv_supplier_payable` (reads `supplier_ledger` directly) is a real asymmetry, but it is **not only** the "manual SQL correction" scenario Revision 1 imagined. `applyAdvanceToSale`/`applyCreditNoteToSale` (`advancePaymentService.ts`, `creditNoteService.ts`) **already, by design, update `sales.due_amount` directly with no corresponding `customer_ledger` row** — meaning `mv_customer_outstanding` and a ledger-derived balance diverge as a matter of normal, everyday operation (a customer who partially applies an advance to one invoice, leaving the rest unapplied, produces exactly this divergence, not from an error). Revision 1's proposed "nightly consistency check, flag on any disagreement" would therefore misfire constantly. **Corrected design: §2.6.**
- **Cashbook** (`cash_ledger`) and **Bank Book** (`bank_ledger` + `bank_accounts`, multi-bank, `payment_mode` tracking) are both live and correctly described. **No bank reconciliation exists at all.**
- **Expense flow is cash-only**: `expenses` has no `paid_account_id`/`bank_account_id` column at all, and `expense_ledger` has no `reference_type`/`reference_id` either (unlike `cash_ledger`, which has both) — **[REVISED]** this is not a route-only change as Revision 1 implied; it requires two small additive schema changes first. Corrected in §2.8.

### Audit Trail — real but not universal, and with the same super_admin exposure as the rest of the system
- `audit_logs` (migration `008`) is actively written by Sales, Purchases, Returns, Challans, Deliveries, Sales Orders, Adjustments, Display Stock, Cash Closings, Reservations, Approvals, and some master-data updates. Not logged: Customers, Expenses, bank transactions, HR transactions, GL/Journal entries, Quotations.
- **[REVISED]** `GET /api/audit-logs` is gated with `requireRole('dealer_admin')` — and per the confirmed `requireRole` bypass (§1.5), `super_admin` already passes this today, and can retrieve any dealer's full audit log (including, once this phase lands, every GL/Journal/Fixed-Asset/Budget/Fiscal-Year action) with nothing more than a `dealer_id` query param. Revision 1 did not address this. **Fixed in §2.17/§4.**

### What genuinely does not exist anywhere (confirmed by exhaustive grep, unchanged from Revision 1)
- Fiscal Year / accounting period, Cost Centers, Fixed Assets/Depreciation, Budget, Bank Reconciliation, a real cutover "opening trial balance" concept, Project cost tracking, AR/AP bad-debt write-off, recurring/standing journal entries, Trial Balance drill-down.

## 1.2 [REVISED] A note on `docs/PURCHASE_COMPLETION_REPORT.md`

That report's §7 states "no double-entry ledger exists anywhere in this codebase." That claim is **superseded by this document's inspection**: a real, partially-wired GL spine exists (migrations `031`, `053`, `068`, `081`), built during an earlier, separately-numbered phase of hardening work (`P1`–`P6` tags in migration comments — a different numbering scheme than this engagement's "V2 Sprint" numbering) that was never reconciled with the Purchase-domain sprint work. The Purchase Completion Report's claim was accurate about the *Purchase-domain sprints' own additions* (none of Sprints 5A–5E wired themselves into the posting engine — confirmed: `purchaseReturns.ts`'s `complete()` handler never calls `mirrorToPostingTables`/imports `PostingOrchestrator` at all) but should not be read as a claim about the codebase as a whole.

## 1.3 What Can Be Reused (unmodified) — unchanged from Revision 1
- `journal_entries`/`journal_entry_lines` + `journal.ts` for manual entries.
- `gl_accounts`/`gl_journal_entries`/`gl_journal_lines` schema shape (with the additive fixes in §2.1/§2.5).
- `posting_batches`/`posting_lines` schema, `postingTraceService.ts`'s hybrid-read pattern, the reversal-aware (`reverses_batch_id`) design, and — newly recognized — the single `persistPostingBatch` choke point.
- `tax_posting_lines`, `computeVatBreakdown`'s overall shape (with the SD-order fix in §2.15), Mushak 6.3/6.1 registers.
- `customer_ledger`/`supplier_ledger`/`cash_ledger`/`bank_ledger`/`bank_accounts`/`expense_ledger` and every payment function that writes to them.
- `mv_customer_outstanding`/`mv_supplier_payable` as the AR/AP read models (with the corrected consistency-check design in §2.6).
- `projects`/`project_sites` and their revenue reporting.
- `audit_logs`.
- **[NEW]** `adminStats.ts` as the reference pattern for how a genuine cross-tenant-aggregate, non-drill-down view should be built (§4).

## 1.4 What Should Be Merged
- Customer ledger's `type` column onto the shared enum, **after** a one-time data classification pass distinguishing real `refund` rows from credit-note-flavored `refund` rows (§2.6) — not a blind rename.
- A new `supplier_advance_applications` table mirroring `customer_advance_applications`, **contingent on** first confirming/building an unattached-advance-receipt function on the supplier side (no such function was found in `supplierPayment.ts` — §2.7).
- The two Trial Balance implementations into one GL-derived source, **only after** Bugs A/B/C (§1.1/§2.5) are fixed and a full fiscal period's parallel run reconciles.
- Expense posting's cash-vs-bank choice with the pattern every other payment flow already has — **after** adding the two prerequisite schema columns (§2.8).

## 1.5 What Should Be Removed / Restricted
- The `5900 GL Clearing/Suspense` account's role as a routine imbalance plug for Expense and Tax — **fixed as part of correcting Bug A** (§2.5): once `tax` domain lines are actually produced and mapped correctly, Tax no longer needs Clearing at all in the normal case.
- **[NEW]** The **unconditional** `super_admin` bypass in `requireRole`, specifically for the new financial routes this phase introduces (Fiscal Year/Period, GL, Journal drill-down, Fixed Assets, Budget, Bank Reconciliation, Financial Statements). This is **not** a change to `requireRole` itself or to any existing route (out of scope, too broad a blast radius) — it is a **new, additional** guard layered only on top of Phase 6's own new endpoints. See §4.
- The operational-aggregation Trial Balance/P&L/Balance Sheet, once GL-derived versions are live and reconciled for a full fiscal period (unchanged from Revision 1, now correctly gated on the Bug A/B/C fixes above).

## 1.6 Genuine Gaps (net new work, updated)
1. Fiscal Year / Accounting Period with close/lock enforcement, **enforced at the existing `persistPostingBatch`/`journal.ts` choke points, not 20+ individual routes** (§2.2).
2. A real cutover Opening Trial Balance **with an explicit mid-fiscal-year activation procedure for existing, multi-year dealers** (§2.3/§2.16 — a genuine bootstrapping problem Revision 1 did not address).
3. Cost Centers, Fixed Assets/Depreciation, Budget, Bank Reconciliation — **every new table explicitly, directly `dealer_id`-scoped** (§2.9–§2.14 restate this as a standing rule).
4. Fixing Bugs A/B/C before any GL activation (§2.5).
5. Corrected Mushak-9.1/SD/BIN design (§2.15).
6. Financial Closing with an explicit, dealer-scoped rollover query requirement and the mid-fiscal-year bootstrap procedure (§2.16).
7. Universal Audit Trail coverage, reconciled against the super_admin exposure (§2.17).
8. Project cost-side tracking.
9. Two new staff roles: **Senior Accountant** and **Finance Manager**.
10. **[NEW]** An Inventory GL-vs-live-`stock` reconciliation job, mirroring the corrected AR/AP one (§2.13).
11. **[NEW]** An AR/AP bad-debt write-off workflow (§2.6/§2.7).
12. **[NEW]** A concrete, designed mechanism restricting `super_admin` from Phase 6's own financial routes (§4) — Revision 1 asserted this boundary without designing it, and it does not match today's actual `requireRole` behavior.

---

# STEP 2 — Accounting Architecture Design

The unifying principle is unchanged: **the posting engine becomes the single event log every financial action writes to; the GL spine becomes the single, always-on, double-entry derivation of that log; every financial statement is computed from the GL, and only the GL.** Party-level ledgers remain the human-facing audit trail. **[REVISED]** This principle is now stated with the corrected understanding that Sales/Purchase are already most of the way there — the work is fixing three live bugs and extending coverage to Payments/Expenses/Purchase-domain-Sprint-5E events, not building the mechanism from scratch.

## 2.1 Chart of Accounts

- Reuse `gl_accounts` unmodified in its five `account_type` values. Auto-seed the 11-account default chart for every dealer (today manual via `POST /api/gl/accounts/seed`).
- **[REVISED]** Add a `normal_balance` column (`'debit' | 'credit'`) to `gl_accounts`, additive and nullable-with-default-inferred-from-`account_type` (asset/expense default `debit`, liability/equity/income default `credit`), with an explicit **override** allowed per-account — this is what lets `1310 Accumulated Depreciation` be typed `asset` (so it lives under the Fixed Assets grouping) while correctly carrying a natural credit balance that a Balance Sheet renderer **subtracts** from Fixed Assets rather than adds. Every report that sums `account_type='asset'` must be updated to net `normal_balance='credit'` asset rows against the rest, not sum them blindly.
- New accounts, each assigned an explicit `normal_balance`: `1300 Fixed Assets` (debit), `1310 Accumulated Depreciation` (credit, contra-asset), `2200 VAT Receivable / Input VAT` (debit), `3100 Retained Earnings` (credit, split out of the single `3000 Owner Equity`), `6000 Depreciation Expense` (debit).
- **[REVISED]** `5900 GL Clearing/Suspense` keeps its `asset` `account_type` for schema simplicity, but is explicitly **excluded from every Balance Sheet asset total** unless non-zero — a non-zero Clearing balance renders on its own "Suspense — requires investigation" line, never silently folded into Cash/Bank/Other Assets. This resolves the ambiguity Revision 1 left open.

## 2.2 Fiscal Year

- `fiscal_years` (per dealer, `start_date`/`end_date`/`status: open|closed`) and `accounting_periods` (per dealer, typically monthly, `status: open|closed`) — **both tables carry `dealer_id` directly** (§4's standing rule), not only via a parent FK.
- **[REVISED — enforcement mechanism corrected]** Revision 1 described period-lock enforcement as something added "on every posting write," which the review correctly flagged as implying edits to 20+ route files, several of them frozen. The actual, corrected design: **the lock check is added in exactly two places** — `createPostingBatch` (`postingLineWriter.ts`, the single function every dual-writing route already calls) and `journal.ts`'s POST handler (the only path for manual entries). Both already receive `dealerId` and `entryDate` as parameters, so the check (`SELECT status FROM accounting_periods WHERE dealer_id = ? AND ? BETWEEN start_date AND end_date`) is inherently dealer-scoped by construction — it cannot accidentally check a different dealer's period, because it never sees dealer B's row unless dealer B's own `dealerId` is the one passed in. No frozen route file needs to change; the enforcement lives entirely inside the shared, already-non-frozen posting/journal infrastructure.
- Reopening a closed period is Finance-Manager-only, audit-logged, and — per the corrected design above — the reopen action's own authorization must check the requesting user's `dealer_id` against the period row's `dealer_id` (the same `resolveDealer` pattern already used by every dealer-scoped route in this codebase), not role alone.
- Fiscal year start month remains a per-dealer setting (July–June is the common Bangladesh government-aligned convention; calendar-year is equally supported), and because the lock check above is always parameterized by the specific dealer's own fiscal calendar, two dealers with different fiscal years sharing the same posting infrastructure cannot interfere with each other.

## 2.3 Opening Balance

- Modeled as one Opening Balance journal entry per dealer, dated the cutover date, covering Cash/Bank/Inventory/AR/AP and a balancing Owner Equity/Retained Earnings figure — additive on top of the existing per-row `opening_balance` fields, not a replacement.
- **[REVISED — the mid-fiscal-year activation procedure Revision 1 omitted]** For a **new** dealer signing up after Phase 6 ships, this is straightforward: the cutover date is the fiscal year start, and there is no prior history. For an **existing** dealer (years of trading history, the default case for every current customer of this SaaS), Phase 6 activation will not land precisely on that dealer's fiscal year boundary. The corrected procedure:
  1. The Opening Balance journal entry's cutover date is **the actual GL-activation date for that dealer** (not "the day before the fiscal year begins," which is only correct for a brand-new dealer) — it captures the dealer's full cumulative financial position (every year of trading) as of that exact date, with Retained Earnings as the balancing figure for everything before it.
  2. This means, for the **first** fiscal-year-end this dealer experiences after activation, the year-end closing entry (§2.16) only zeroes out Income/Expense GL accounts for the **partial period actually tracked by the GL** (activation date → fiscal year end) — which is correct and complete, because the pre-activation portion of that same fiscal year is already fully folded into the Opening Balance entry's Retained Earnings figure, not double-counted or omitted. The two entries are deliberately non-overlapping by construction (Opening Balance covers "everything before activation," the first year-end close covers "activation to fiscal year end") as long as the Opening Balance's cutover date and the first period's start date are the same day — which the corrected design requires and the second-year close does not need this special case, since by then the GL has tracked the entire fiscal year.
  3. This procedure — cutover date = activation date, not a fixed calendar boundary — is stated as an explicit, required step in Sprint 6A/6E's roadmap scope (Roadmap 6A, 6E), not left implicit.

## 2.4 Journal

- `journal_entries`/`journal_entry_lines` unchanged for manual entries.
- **[REVISED — corrected mechanism]** Revision 1 proposed adding a `journal_entries.source` column so the Journal list could show "manual vs. system-generated" — this is wrong on inspection: automated postings never write to `journal_entries` at all; they live in the structurally separate `gl_journal_entries`/`gl_journal_lines` (different schema: free-text `account` string vs. FK'd `account_id`), which `journal.ts` never reads. Adding a column to `journal_entries` alone would leave the Journal UI showing zero system-generated entries regardless of the filter. **Corrected design:** `GET /api/journal` gains a new, additive query mode that **unions** `journal_entries`(source='manual') with `gl_journal_entries`(source='system'), presenting both in one list via a shared response shape (each row normalized to `{date, description, lines: [{account_label, debit, credit}], source}` — for `gl_journal_lines`, `account_label` is resolved from `gl_accounts.name` via `account_id`; for `journal_entry_lines`, it's the existing free-text `account` string as-is). No schema column is added to either table; this is purely a new read-side merge.

## 2.5 General Ledger

- **[REVISED — prerequisite work, must happen before "activation"]** Before `USE_GL_SPINE`/`USE_POSTING_ENGINE` become always-on (Roadmap 6A), three existing bugs must be fixed:
  1. **Bug A (tax domain dead)**: either (a) have `sales.ts`/`purchases.ts` additionally construct a genuine `tax`-domain `posting_lines` row using the **taxable** amount (not the gross), alongside the existing `customer`/`sale` line which must then post the **taxable** amount instead of the gross `total_with_tax` (with a separate `tax` line supplying the VAT_PAYABLE credit) — or (b) retire the dead `tax` case in `glLineMapper.ts` and instead have the GL mirror step read `tax_posting_lines` directly for the same document and synthesize the VAT/SD GL lines from there, keeping `tax_posting_lines` as the single source of VAT truth (this revision recommends **option (b)** — it avoids duplicating VAT computation logic into a second code path and keeps `taxPostingService.ts` as the one place VAT amounts are decided). Either way, the `customer`/`sale` GL line must debit AR at the gross amount but credit **only** the taxable portion to `4000 Sales Revenue`, with the tax portion credited to `2100 VAT Payable` via the mechanism chosen above.
  2. **Bug B (stock sign)**: `glLineMapper.ts`'s `stock` case must branch on `line_type` (`'purchase_in'` vs. `'sale_out'`), not purely on numeric sign — `sale_out` (whatever its stored sign) always means debit COGS/credit Inventory; `purchase_in` always means debit Inventory/credit Clearing (or credit AP directly once Bug A's `tax`-vs-taxable split makes room for a cleaner purchase mapping too).
  3. **Bug C (reversal dead branch)**: extend the `customer` case's existing `line_type === 'sale'` branch to also match `amt < 0` (producing the mirrored `credit AR / debit Sales` entry), removing the dependency on the never-populated `'return'` type. The same fix pattern applies to the `supplier`/`purchase` case for purchase reversals.
- Once these are fixed, `USE_POSTING_ENGINE`/`USE_GL_SPINE` become always-on for all dealers, and every additional Purchase-domain event from Sprints 5A–5E that doesn't yet participate in the posting engine at all — **confirmed: Purchase Return (`purchaseReturns.ts`) never calls `mirrorToPostingTables` today, contradicting `PURCHASE_COMPLETION_REPORT.md`'s "ready for GL" framing** — gets wired in for the first time, not merely "extended":
  - **Purchase Return**: posts a `supplier`-domain line, `line_type: 'purchase_return'`, mapped as `debit AP / credit Inventory` for the portion of the returned goods still in stock. **[REVISED — the partial-COGS-recognition case Revision 1 ignored]**: if some of the returned batch has already been sold before the return is processed, the portion already expensed to COGS cannot correctly credit Inventory (it's no longer there) — that portion instead credits `5000 COGS` (reversing the earlier COGS recognition), with the split computed from the same `stock_cost_adjustments`/batch-quantity data `purchaseReturns.ts` already tracks. This split rule is now an explicit, required part of the mapping, not a one-line gloss.
  - **Landed Cost**: **[REVISED — the missing schema Revision 1 didn't flag]** `landed_cost_sheets` today has no field distinguishing a pre-paid charge from a billed one, and no vendor/party field for the charge itself (freight/customs agents are typically not the goods supplier on `purchase_id`). Before this event can be GL-mapped at all, Sprint 6A must add two additive, nullable columns to `landed_cost_sheets` via a **new** migration (consistent with the established "widen a frozen-sprint table via a later additive migration" pattern already used repeatedly in this codebase, e.g. Sprint 5D adding `purchase_items.source_goods_receipt_item_id` without touching the original frozen migration): `payment_status: 'prepaid' | 'billed'` and `charge_vendor_id` (nullable FK → `suppliers`). Only once these exist can the mapping be `debit Inventory / credit Cash-or-Bank` (prepaid) or `debit Inventory / credit AP` (billed, crediting `charge_vendor_id`'s payable, not the original goods supplier's).
  - **Batch/Stock Cost Adjustment**: posts a `stock`-domain line, sign following the direction of `stock_cost_adjustments.new_avg_cost - old_avg_cost`, credited/debited against `5900 Clearing` — this is one of Clearing's legitimate, intended use cases (§2.1), and is investigated (not routinely expected to be zero) at each period close.
  - **[NEW]** Landed-cost proportional-allocation rounding leakage (per-line `round2()` shares not summing exactly to the sheet total) is explicitly named as a second legitimate Clearing use case: any leftover taka from apportionment rounds to the **largest allocation line** (standard apportionment practice), and any residual after that is swept to Clearing for period-close investigation.
- `PostingDocumentType` is widened (additively) to include `payment`, `expense`, `purchase_return`, `landed_cost`, `stock_cost_adjustment`.
- **[NEW]** `gl_journal_lines` gains a direct, additive `dealer_id` column (backfilled via a one-time join against `gl_journal_entries`), matching `posting_lines`' own convention, before it becomes the sole source of every financial statement in §2.13.

## 2.6 Accounts Receivable

- `customer_ledger.type` migrates from free text to the shared `ledger_entry_type` enum. **[REVISED — corrected migration plan]**: because only 5 clean literal values exist today (verified by exhaustive grep — no messy legacy data), the enum widening itself is mechanically safe. But **before** adding `credit_note`/`debit_note` and treating them as "the" way credit notes work going forward, Sprint 6B must run a one-time classification pass over existing `refund`-typed rows, using the existing `sales_returns.refund_mode` field to split them: rows where `refund_mode = 'credit'` are relabeled `credit_note` (positive amount, matching the supplier-side sign convention); rows where `refund_mode` indicates an actual cash/bank refund stay `refund`. Going forward, `creditNoteService.ts` is updated to write `type='credit_note'` directly instead of overloading `refund`.
- Every `customer_ledger` insert also emits a `customer`-domain `posting_lines` row, mapped by the corrected `glLineMapper.ts` (§2.5) — `refund`-typed lines credit Cash/Bank (money actually left), `credit_note`-typed lines credit AR only (no cash movement), keeping the GL correct for both cases now that they're distinguishable.
- **[REVISED — corrected reconciliation design]** `mv_customer_outstanding` (`sales.due_amount`) is kept as the fast operational read model; a nightly consistency job compares it against a ledger-derived balance — but the job's comparison is corrected to **net out any outstanding, unapplied advance or credit-note balance for that customer first** (queryable from `customer_advance_applications`/the new `customer_credit_note_applications`-aware logic), since a customer with a partially-applied advance is *expected* to show a real, structural difference between `sales.due_amount` and a naive `computeCustomerBalance(customer_ledger)` sum — this is normal operation, not drift, and the check must not alarm on it.
- **[NEW]** AR write-off workflow: a `write_off` sub-classification (stored as `type='adjustment'` with a `metadata`/reason field, consistent with how `adjustment` already supports negative write-off amounts today) posts to a new `6100 Bad Debt Expense` GL account, requiring Finance Manager approval — closing the gap Revision 1 left open despite Sprint 6B being the dedicated AR/AP sprint.
- Customer Aging, Statement, and Credit/Debit Note UI brought to parity with the supplier side (Sprint 5D).

## 2.7 Accounts Payable

- `supplier_ledger` unchanged — its sign convention was independently re-verified as correct.
- **[REVISED]** A new `supplier_advance_applications` table mirrors `customer_advance_applications`, but **only after** confirming/building the missing prerequisite: no unattached-advance-receipt function (an equivalent of `receiveAdvancePayment`, which explicitly allows a null `sale_id`) exists today in `supplierPayment.ts` — `recordSupplierPaymentFifo` requires an outstanding due bill to allocate against. Sprint 6B's scope now explicitly includes building this function first (`receiveSupplierAdvance`, writing an unattached `supplier_ledger` payment row) before `supplier_advance_applications.purchase_id` can be meaningfully nullable to track it.
- Everything from Sprints 5A–5E continues unmodified; Phase 6 adds the posting-engine/GL mirror on top (§2.5), it does not touch any Purchase-domain route file directly — new columns needed on `landed_cost_sheets` (§2.5) are added via a new migration, per the established additive-widening pattern, not an edit to Sprint 5E's own migration file.

## 2.8 Cashbook / Bank Book

- `cash_ledger`/`bank_ledger`/`bank_accounts` unchanged.
- **[REVISED]** Expense's `paid_account_id` support requires two additive schema changes, stated explicitly rather than assumed to be route-only: a nullable `paid_account_id` column on `expenses` (so a later edit/list screen can show/filter by funding account) and nullable `reference_type`/`reference_id` columns on `expense_ledger` (matching `cash_ledger`'s existing shape, so an expense's ledger row can link back to the specific `bank_ledger` row it produced).

## 2.9 Cost Centers

- `cost_centers` table (name, code, `parent_id` hierarchy) — **carries `dealer_id` directly** (§4's standing rule), attachable as an optional `cost_center_id` on `posting_lines`, `expenses`, and `purchase_items`. Not retroactive.

## 2.10 Projects

- Extend `projects`/`project_sites` with an optional `project_id` on `expenses`, `purchase_items`, and `posting_lines` generally, enabling a real Project P&L for the first time.

## 2.11 Assets & Depreciation

- `fixed_assets` (name, category, acquisition date/cost, useful life, salvage value, straight-line only for v1) and `fixed_asset_depreciation_schedule` (one row per asset per period) — **both carry `dealer_id` directly**. Monthly depreciation posts an automated Journal entry: debit `6000 Depreciation Expense`, credit `1310 Accumulated Depreciation` (now correctly representable as a contra-asset per §2.1's `normal_balance` fix).
- Disposal is an explicit action posting a final reconciling entry (accumulated depreciation, proceeds, gain/loss), not a delete.

## 2.12 Budget

- `budgets` table (per fiscal year, per account or per cost-center-and-account) — **carries `dealer_id` directly**, not only transitively via `fiscal_years`. Budget vs. Actual report, monitoring only, no spend-blocking enforcement.

## 2.13 Trial Balance / Profit & Loss / Balance Sheet / Cash Flow

- All four become GL-derived only, **replacing the operational-aggregation computations only after**: (a) Bugs A/B/C are fixed, (b) the GL has been the primary posting path for a full fiscal period, and (c) that period's parallel-run numbers reconcile exactly.
- **[NEW]** A Trial-Balance-line → underlying-`gl_journal_lines`-detail drill-down endpoint/view is added — an aggregate-only Trial Balance was correctly flagged as close to unusable for real month-end error hunting.
- **[NEW]** An Inventory reconciliation job, mirroring the corrected AR/AP one (§2.6): the GL-summed Inventory balance (Σ stock-domain postings) and the live `stock.average_cost_per_unit × quantity` figure are two independently-rounded reductions of the same purchase/sale/landed-cost/cost-adjustment history and are not guaranteed to agree to the cent over time (repeated `round2()` on a rolling average compounds; landed-cost proportional allocation leaks per §2.5). A nightly job flags any product where the two differ by more than a small tolerance, for Finance Manager review — the same pattern as the AR/AP check, applied symmetrically where Revision 1 only applied it to one side.
- Cash Flow gains a real three-statement structure (Operating/Investing/Financing).
- The Balance Sheet's Director-Capital-plus-plugged-Retained-Earnings equity section becomes a real, rolled-forward GL account per the corrected §2.3/§2.16 procedure.

## 2.14 Bank Reconciliation

- `bank_statement_imports`/`bank_statement_lines` — **both carry `dealer_id` directly**. CSV upload, date+amount auto-matching proposal.
- **[REVISED — tie-breaking rule added]** Same-day, same-amount duplicate transactions (a genuinely common pattern for a B2B tiles distributor settling several similar-sized supplier invoices on one day) are a real ambiguity Revision 1 left unaddressed. Corrected rule: within a date+amount tie group, propose matches in **insertion order** (oldest unreconciled `bank_ledger` row to oldest unmatched statement line, and so on down the group) as a low-confidence suggestion, but **any group with more than one tie is flagged for mandatory manual confirmation** rather than auto-confirmed — the system never silently marks a tied group "reconciled" without a human looking at it. The matching query itself is always scoped `WHERE dealer_id = :dealerId`, never matching across tenants.

## 2.15 Bangladesh VAT (Mushak) — corrected

- **[REVISED — SD formula fix]** `computeVatBreakdown` must be corrected before Sprint 6E activates any non-zero `sdRatePct`: `SD = taxable_amount × sd_rate`; `VAT = (taxable_amount + SD) × vat_rate`; `total_with_tax = taxable_amount + SD + VAT`. This is a documented target for the eventual code change (no code is written in this phase) but is now the explicit, correct spec Sprint 6E must implement, replacing the current independent-sum formula.
- **[REVISED — Mushak-9.1 scope corrected]** Mushak-9.1 is built as an **internal draft report requiring mandatory accountant review before filing**, not a filing-ready output as Revision 1 implied. Its v1 data model now explicitly includes (rather than silently omitting): a per-transaction **rebate-eligibility** flag on input VAT (defaulting to eligible, but overridable — since not all input VAT is legally creditable), a **goods vs. services** flag (this business is overwhelmingly goods-only today, but the flag exists so a future services line item doesn't silently miscalculate), a placeholder **Advance Trade VAT** field for import purchases (populated manually for v1, not automatically derived — genuine ATV automation is out of scope, this only ensures the number has somewhere to go on the report), and a **carry-forward balance** for a net-input-VAT period (the `2200 VAT Receivable` GL account tracks this as a running balance, not a one-off refund assumption). The report UI carries a persistent, un-dismissable disclaimer: *"This report reflects recorded transactions only. Verify rebate eligibility, Advance Trade VAT, and VAT deduction at source before filing."* Before Sprint 6E ships, the report's field layout is validated against the then-current official Mushak-9.1 form (NBR forms are periodically amended by SRO) — this validation step is now an explicit acceptance criterion, not assumed.
- **[REVISED — BIN fix corrected]** Revision 1's "add a `bin` synonym column, leave `gstin` deprecated-but-live" was underspecified. Corrected plan: add `bin` to `suppliers` (and, newly, to `customers`, replacing the ambiguous generic `tax_id` — Revision 1 only addressed the supplier side) as the new single source of truth; a one-time backfill copies existing `gstin`/`tax_id` values into `bin`; **every read path** (`vatReportService.ts`'s Mushak-6.1/6.3 queries, `taxPostingService.ts`'s `party_tax_id` population, `purchases.ts`/`purchaseInvoices.ts`) is explicitly listed as a required change to read from `bin` going forward, not left to infer; `gstin`/`tax_id` remain in the schema (harmless, unused) rather than being dropped, consistent with this project's "no destructive migrations" rule.
- **[NEW — VAT-inclusive pricing flagged as an open business question, not silently resolved]** `computeVatBreakdown` is confirmed VAT-exclusive end-to-end (`sales.ts` sums line-item prices, subtracts discount, then adds VAT/SD on top). Whether SaniTiles' actual dealers price showroom/retail tile sales as VAT-inclusive (a common Bangladesh retail convention, where the shelf/quoted price is the all-in customer-facing number) or VAT-exclusive (standard for B2B/contractor sales, where the buyer needs VAT itemized for their own rebate) is a real product question this architecture cannot unilaterally answer. **This is documented as an explicit open question for the business**, with a recommended default if support is needed later: an optional per-sale "price entry mode" toggle using the standard VAT-inclusive "tax fraction" back-calculation (`taxable_amount = inclusive_price / (1 + vat_rate/100)`) — not built in this phase, but not silently assumed away either.
- **[NEW]** VAT-domain reversal on sale return is added as an explicit requirement: reversing a sale must also post an offsetting `tax_posting_lines` row (or equivalent negative-amount entry), so the Mushak-6.3 register correctly nets out VAT on returned goods.

## 2.16 Financial Closing — corrected

- The month-end/year-end close workflow (lock periods, zero out Clearing, roll Income/Expense into Retained Earnings, snapshot statements) is unchanged in outline, but with two corrections:
  1. **[REVISED]** The year-end rollover query is now an **explicit, named requirement**: it must be parameterized by `dealer_id` and only ever touch that one dealer's `fiscal_years`/`accounting_periods`/`gl_accounts`/`gl_journal_lines` rows — stated explicitly because `gl_accounts.code` values are identical across every dealer (same seeded default chart), making an unscoped "zero every `4000`/`5xxx` account" implementation a real, catastrophic, cross-tenant risk if built carelessly. This requirement is now a stated acceptance-test item in Roadmap 6E ("verify closing dealer A does not affect dealer B's Retained Earnings"), not an assumption.
  2. **[REVISED]** The first fiscal-year-end close after Phase 6 activation for an **existing** dealer follows the corrected §2.3 procedure (activation-date cutover, not fiscal-year-boundary cutover) — explicitly called out so the rollover entry only zeroes the GL-tracked partial period, correctly not double-counting or omitting the pre-activation months already folded into the Opening Balance entry.

## 2.17 Audit Trail — corrected

- Extend coverage to Customers, Expenses, Bank accounts/transactions, GL/Journal entries (manual and system-generated), Fixed Assets, Budgets, Cost Centers, Fiscal Year/Period open-close actions, and Bank Reconciliation matches — same existing per-route pattern.
- **[NEW]** `GET /api/audit-logs` today already permits `super_admin` cross-tenant drill-down (confirmed: `requireRole('dealer_admin')` + the unconditional super_admin bypass + `resolveDealer`'s `dealerId`-param pattern). Phase 6's expanded financial audit surface is explicitly covered by the new restriction designed in §4 — a Phase-6-specific guard, not a change to the existing route's general behavior (which remains as-is for non-financial audit actions, out of this phase's scope to alter).

---

# STEP 3 — Integration Design

| Domain | Integration point | What changes |
|---|---|---|
| **Sales** | `sales.ts` | **[REVISED]** Already dual-writes (§1.0) — the work is fixing Bugs A/B/C (§2.5), not adding new integration. **[NEW, explicit non-goal]** A single sale supports exactly one `paid_account_id` (cash **or** bank, never split) today — Sales itself is frozen and out of scope for this phase, so the GL mapping is designed against this actual, single-account shape; a split cash/bank payment on one invoice is explicitly **not** a scenario this phase's GL mapping needs to (or can) handle, since the underlying Sales route cannot produce it. |
| **Purchase** | `purchaseOrders.ts`, `goodsReceipts.ts`, `purchaseInvoices.ts`, `purchaseReturns.ts`, `landedCostSheets.ts`, `stockCostAdjustments.ts`, `supplierLedgerEntries.ts` | Purchase Order/GRN/Invoice already dual-write via the same mechanism as Sales. **Purchase Return, Landed Cost, and Batch/Stock Cost Adjustment are wired into the posting engine for the first time** in this phase (§2.5), with Landed Cost requiring two new additive columns on `landed_cost_sheets` first. |
| **Inventory** | `receivingStockPosting.ts`, `returnStockPosting.ts` | Every stock-value-changing event emits a `stock`-domain line, mapped correctly per the Bug B fix. **[NEW]** A nightly GL-vs-live-`stock` reconciliation job (§2.13) is added, since the two are independently-rounded reductions of the same history and can drift. |
| **Customer** | `customers.ts`, `customerStatementService.ts` | `customer_ledger` type migrated to the enum **after** the `refund`/credit-note classification pass (§2.6); Statement/Aging brought to parity with the supplier side. |
| **Supplier** | `suppliers.ts`, existing 5A–5E infrastructure | Unmodified; gains `supplier_advance_applications` **contingent on** a new `receiveSupplierAdvance` function (§2.7). |
| **Payments** | `recordCustomerPayment`, `recordSupplierPaymentFifo`, `postCustomerReceipt`, `postSupplierOutflow` | Genuinely unwired today (confirmed, §1.0) — wired into the posting engine for the first time in Sprint 6A/6B. |
| **VAT** | `taxPostingService.ts`, `vatReports.ts` | Corrected SD formula (§2.15); `tax`-domain GL mapping now sources from `tax_posting_lines` directly rather than a dead, separately-populated `posting_lines` domain (§2.5); VAT reversal on sale return added; Mushak-9.1 built with rebate-eligibility/ATV/carry-forward fields and a mandatory review disclaimer, not as a filing-ready output. |

**Cross-cutting integration rule, unchanged:** any future financial event anywhere in the system must emit a posting line in the same transaction as its domain-specific ledger write, through the single `persistPostingBatch` choke point — this becomes the standing architectural rule.

---

# STEP 4 — Permissions Design — corrected

**[REVISED — the Super Admin claim in Revision 1 was checked against the live codebase and found false, and no enforcement mechanism was ever designed for it. Both are corrected here.]**

**Current reality, verified:** `backend/src/middleware/roles.ts`'s `requireRole()` unconditionally passes any request where the user has the `super_admin` role, regardless of the route's allow-list — confirmed by reading the function directly. Combined with the `resolveDealer` pattern's `super_admin must specify dealerId` behavior (used identically across `gl.ts`, `journal.ts`, `purchaseInvoices.ts`, `supplierAging.ts`, and every other dealer-scoped route), **`super_admin` can already drill into any single dealer's financial data today** — including `GET /api/gl/trial-balance?dealerId=<any dealer>` — with nothing more than a `dealerId` query parameter. This is not a hypothetical risk; it is the system's actual current behavior, and it is unrelated to Phase 6 (it predates this design).

**Corrected design:** Phase 6 does **not** change `requireRole` or any existing route's `super_admin` handling (that is a much larger, separate change with its own blast radius, out of scope here — every existing `super_admin` support/troubleshooting workflow across Sales, Purchase, Inventory continues to work exactly as today). Instead, Phase 6 introduces a **new, additional** guard — `restrictSuperAdminOnFinancials()` — applied **only** to the new routes this phase adds (Fiscal Year/Period, GL Trial Balance detail/drill-down, Journal's unified view, Fixed Assets, Budget, Bank Reconciliation, and the GL-derived Financial Statements once cut over): this guard runs **after** `requireRole` and explicitly rejects any request where `req.user.roles.includes('super_admin')` **and** a specific `dealerId` is targeted, forcing `super_admin` onto a separate, genuinely aggregate-only path modeled directly on the existing `backend/src/routes/adminStats.ts` (confirmed to exist and already implement exactly this "cross-tenant, `GROUP BY dealer_id`-rolled-up, never single-dealer-detail" shape) — the new financial aggregate view is built as an extension of that existing, correct pattern, not invented from scratch. `GET /api/audit-logs`'s existing `super_admin` exposure (§2.17) is explicitly brought under this same new guard for the financial-action audit entries this phase adds, without altering the route's behavior for pre-existing, non-financial audit actions.

Two new roles are introduced (they do not exist today — only `dealer_admin`, `manager`, `accountant`, `salesman`, `super_admin`, `sa_employee` currently exist): **Senior Accountant** and **Finance Manager**.

| Capability | Accountant | Senior Accountant | Finance Manager | Dealer Admin | Super Admin |
|---|---|---|---|---|---|
| Record sale/purchase/payment/expense (existing flows) | ✅ | ✅ | ✅ | ✅ | ⛔ (no tenant data writes) |
| Create manual Journal entry (draft) | ✅ | ✅ | ✅ | ✅ | ⛔ |
| **Post/approve** a manual Journal entry | ⛔ | ✅ | ✅ | ✅ | ⛔ |
| Edit non-system Chart of Accounts entries | ⛔ | ✅ | ✅ | ✅ | ⛔ |
| Seed/reset default Chart of Accounts | ⛔ | ⛔ | ✅ | ✅ | ⛔ |
| Perform Bank Reconciliation matching | ⛔ | ✅ | ✅ | ✅ | ⛔ |
| Generate VAT registers / Mushak-9.1 draft | ✅ (view/generate) | ✅ | ✅ | ✅ | ⛔ |
| Manage Fixed Assets / Depreciation schedule | ⛔ | ✅ | ✅ | ✅ | ⛔ |
| Manage Cost Centers / Projects (financial config) | ⛔ | ⛔ | ✅ | ✅ | ⛔ |
| Create/edit Budgets | ⛔ | ✅ (edit) | ✅ | ✅ | ⛔ |
| **Open/close a Fiscal Year or Period** | ⛔ | ⛔ | ✅ | ✅ | ⛔ |
| **Reopen a closed period** | ⛔ | ⛔ | ✅ (with reason, audit-logged, own-dealer only — enforced via the existing `resolveDealer`-style dealer-match check) | ✅ | ⛔ |
| Run Financial Closing (month/year-end) | ⛔ | ⛔ | ✅ (own-dealer-scoped rollover query only, §2.16) | ✅ | ⛔ |
| View Trial Balance / P&L / Balance Sheet / Cash Flow (own dealer) | ✅ | ✅ | ✅ | ✅ | ⛔ (see below) |
| View cross-tenant **aggregate** financial view (no single-dealer detail) | ⛔ | ⛔ | ⛔ | ⛔ | ✅ (via `restrictSuperAdminOnFinancials` + `adminStats.ts`-style query) |
| Assign Accountant/Senior Accountant/Finance Manager roles to staff | ⛔ | ⛔ | ⛔ | ✅ | ⛔ |

This formalizes the separation-of-duties principle already implicit in the existing system's `dealer_admin`-only gates on Journal creation and Payables payment into a proper three-tier finance hierarchy, while — for the first time — actually designing, rather than merely asserting, the boundary that keeps `super_admin` out of individual dealer financial detail for this phase's own new surface.

---

*Continued in `docs/ACCOUNTING_IMPLEMENTATION_ROADMAP.md` (Step 5 — phased Sprint 6A–6E roadmap, revised). Full finding-by-finding disposition of the adversarial review in `docs/ACCOUNTING_REVIEW_RESPONSE.md`.*
