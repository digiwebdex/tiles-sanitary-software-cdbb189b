# Accounting Engine (Phase 6) — Review Response

Disposition of every finding from the five-persona adversarial review of `docs/ACCOUNTING_V2_ARCHITECTURE.md` / `docs/ACCOUNTING_IMPLEMENTATION_ROADMAP.md` Revision 1, which returned **FAIL** with 10 CRITICAL, ~27 MAJOR, and ~7 MINOR findings.

**Verification method:** before writing this response, the three highest-stakes, most consequential claims were independently re-verified by reading the actual source directly (not re-trusting either the original design or the review): (1) whether `sales.ts`/`purchases.ts` already call `mirrorToPostingTables` — **confirmed true**; (2) whether any code ever constructs a `posting_lines` row with `line_domain: 'tax'` — **confirmed false, zero matches**; (3) whether a sale's COGS posting line is signed in a way that falls into the wrong `glLineMapper.ts` branch — **confirmed true**. All three of the review's most consequential claims were accurate. Given that level of accuracy on direct spot-check, and given every other finding cites specific file:line evidence in the same style, **every finding below is Accepted**, except three that are **Partially accepted** because the "fix" is a business decision or explicit, documented deferral rather than a design change — none are Rejected, because no evidence was found contradicting any of them.

Each entry references the section of the revised architecture (`ACCOUNTING_V2_ARCHITECTURE.md`, "Rev2") or roadmap (`ACCOUNTING_IMPLEMENTATION_ROADMAP.md`, "Roadmap") where the fix now lives.

---

## CRITICAL findings

**1. Tax domain never populated in the posting engine — GL Sales Revenue overstated by VAT, VAT Payable never credited.**
**Accepted (fixed).** Independently re-verified: `posting/types.ts` defines the `tax` line_domain but no builder ever constructs one; `sales.ts` posts the VAT-inclusive gross as the `customer`/`sale` line. Fix: Rev2 §1.0 (Bug A), §2.5 — retire the dead `tax` mapper case, source VAT GL lines from `tax_posting_lines` directly, split the `customer`/`sale` line into gross-AR/taxable-Sales. Roadmap Sprint 6A, item 1.

**2. Core planning premise was wrong: Sales/Purchase already dual-write into the posting engine and GL today.**
**Accepted (fixed).** Independently re-verified against `sales.ts:1155-1206`, `purchases.ts:1057-1107`, `postingLineWriter.ts:91-124`. Rev2 §1.0 replaces the false claim with the corrected finding, and identifies the positive consequence the review didn't draw out: a single existing choke point (`persistPostingBatch`) already exists for period-lock enforcement (resolves related finding #15/#27 below). Roadmap Sprint 6A retitled "Fix, Then Activate."

**3. Mushak-9.1 net-VAT model omits rebate-eligibility, goods/services distinction, Advance Trade VAT, VDS, carry-forward, while framed as filing-ready.**
**Accepted (fixed).** Rev2 §2.15 redesigns Mushak-9.1 as an internal draft with a mandatory review disclaimer, and adds rebate-eligibility/goods-services/ATV-placeholder/carry-forward fields to the v1 data model. Roadmap Sprint 6E.

**4. Supplementary Duty calculation order is wrong (VAT and SD computed independently off the same base rather than cascading).**
**Accepted (fixed).** Independently plausible given the reviewed formula description; the correct Bangladesh VAT-and-SD-Act cascading formula is now the documented target. Rev2 §1.1, §2.15. Roadmap Sprint 6E, ordered explicitly before SD activation.

**5. `customer_ledger.type` enum-migration premise was wrong — `refund` already overloaded for credit notes; `adjustment` already carries signed write-offs.**
**Accepted (fixed).** A nested verification pass (grep of every `customer_ledger.type` write site) confirmed only 5 clean literal values exist today, but separately confirmed `sales_returns.refund_mode='credit'` writes `type='refund'` for what is functionally a credit note, and `collections.ts`'s adjustment endpoint already accepts signed amounts for write-offs. Rev2 §1.1, §2.6 — migration now preceded by a `refund_mode`-driven reclassification pass. Roadmap Sprint 6A item 10, Sprint 6B.

**6. Year-end closing has no answer for the mid-fiscal-year GL-activation cutover every existing (multi-year) dealer will hit.**
**Accepted (fixed).** This is the correct default-case framing — Phase 6 activates onto years of existing trading history, not a greenfield deploy. Rev2 §2.3 designs the activation-date-as-cutover procedure explicitly. Roadmap Sprint 6E.

**7. The Super Admin "no single-dealer drill-down" claim is false against the live codebase, with no described enforcement mechanism.**
**Accepted (fixed).** Independently re-verified: `middleware/roles.ts`'s `requireRole()` unconditionally passes `super_admin`. Rev2 §4 first states the corrected current-state fact, then designs `restrictSuperAdminOnFinancials()` as a new guard scoped only to Phase 6's own new routes, modeled on the confirmed-existing `adminStats.ts` pattern. Roadmap Sprint 6E.

**8. Year-end closing rollover not explicitly required to be dealer-scoped; identical `gl_accounts.code` values across dealers make an unscoped implementation plausible and catastrophic.**
**Accepted (fixed).** Rev2 §2.16 makes the dealer-scoping requirement an explicit, named acceptance-test item ("closing dealer A must not affect dealer B"), not an assumption. Roadmap Sprint 6E.

**9. The Sales integration story assumes a split cash/bank payment on one invoice, which the current system cannot record.**
**Accepted (fixed).** `LedgerPostingEngine.ts`'s `cashOrBankDomain()` is a binary branch, confirming a sale has exactly one funding account. Rev2 Step 3 (Sales row) now states this as an explicit non-goal rather than an implied capability. Roadmap unchanged in scope (Sales is frozen; no fix needed to Sales itself, only to how the architecture describes it).

**10. Landed Cost's GL mapping presupposes a prepaid/billed distinction and a charge-vendor field that don't exist in the Sprint 5E schema.**
**Accepted (fixed).** Confirmed directly: `landed_cost_sheets`' `formSchema` has no such fields, and `apply()` never writes to `cash_ledger`/`bank_ledger`/`supplier_ledger`. Rev2 §2.5 specifies the two required additive columns (`payment_status`, `charge_vendor_id`) via a new migration, following the same "widen a frozen table additively from a later sprint" pattern already used elsewhere in this codebase. Roadmap Sprint 6A item 8.

---

## MAJOR findings

**11. `stock`-domain GL mapper mis-signs a sale's COGS as a purchase-in.**
**Accepted (fixed).** Independently re-verified: `StockPostingEngine.ts` posts `sale_out` with a positive `cogsAmount`, which falls into the mapper's `amt > 0` (purchase-receipt) branch. Rev2 §1.0 (Bug B), §2.5 — mapper now branches on `line_type`, not sign alone. Roadmap Sprint 6A item 2.

**12. Proposed new GL mappings (Purchase Return, Landed Cost, Cost Adjustment) are prose-only; Purchase Return mapping is wrong for partially-sold batches.**
**Accepted (fixed).** Rev2 §2.5 adds the explicit split rule (portion still in stock credits Inventory; portion already expensed credits COGS instead) using data `purchaseReturns.ts` already tracks.

**13. `glLineMapper.ts`'s `customer`/`'return'` branch is dead code — reversed sales post nothing to the GL.**
**Accepted (fixed).** Independently plausible given `invertPostingLines.ts`'s confirmed behavior (preserves `line_type`, negates `amount`) and the mapper's confirmed branch structure. Rev2 §1.0 (Bug C), §2.5 — extend the existing `sale`/`purchase` branches to handle their own negative-amount form. Roadmap Sprint 6A item 3.

**14. No visible VAT-domain reversal on sale return — Mushak-6.3 register would overstate output VAT after a return.**
**Accepted (fixed).** Rev2 §1.1, §2.15 add this as an explicit requirement. Roadmap Sprint 6E.

**15. Fiscal-period-close enforcement needs a guard in 20+ write paths, several "frozen," with no sequencing plan.**
**Accepted (fixed).** Resolved by the correction to Finding #2: since every dual-writing route already funnels through one shared function (`persistPostingBatch`) plus `journal.ts` for manual entries, the lock check lives in exactly those two places, not 20+ routes. Rev2 §2.2, §2.5.

**16. No contra-asset representation in `gl_accounts` — Accumulated Depreciation would double-count on a naive Balance Sheet.**
**Accepted (fixed).** Rev2 §2.1 adds a `normal_balance` column with per-account override. Roadmap Sprint 6A item 4.

**17. `journal_entries.source` is added to the wrong table — automated postings live in a disconnected `gl_journal_entries` table.**
**Accepted (fixed).** Independently verified: `journal.ts` only ever queries `journal_entries`; `gl_journal_entries` is a separate schema entirely. Rev2 §2.4 replaces the column addition with a read-side union of both tables.

**18. `gstin`/`bin` fix leaves both fields populated inconsistently with no backfill/read-path plan; customer-side `tax_id` unaddressed.**
**Accepted (fixed).** Rev2 §2.15 adds an explicit backfill, lists every read path that must switch to `bin`, and extends the fix to `customers.tax_id` (Revision 1 only addressed suppliers). Roadmap Sprint 6E.

**19. No requirement to validate Mushak-9.1's layout against the actual NBR form, or to disclaim its known limitations.**
**Accepted (fixed).** Merged into the Finding #3 fix — Rev2 §2.15 adds both as explicit requirements/acceptance criteria.

**20. VAT-exclusive-only design never examined against Bangladesh tile-retail inclusive-pricing practice.**
**Partially accepted.** This is a real, correctly-raised product question, but it is not one this architecture document can unilaterally resolve — it requires an actual decision from the business about how SaniTiles' dealers price showroom sales, which is outside an architecture review's authority to decide on the business's behalf. Rev2 §2.15 documents it explicitly as an open question (rather than silently assuming VAT-exclusive is sufficient, which is what Revision 1 did) and proposes a recommended default (an optional inclusive-pricing entry mode using the standard tax-fraction back-calculation) if and when the business confirms it's needed — but does not commit to building it in this roadmap, since it isn't yet confirmed to be required.

**21. Nightly AR consistency check will misfire against normal advance/credit-note partial-application behavior.**
**Accepted (fixed).** Independently plausible given `advancePaymentService.ts`/`creditNoteService.ts`'s confirmed direct-`sales.due_amount`-update behavior with no corresponding ledger row. Rev2 §2.6 corrects the check to net out outstanding advance/credit-note balances first. Roadmap Sprint 6B.

**22. `supplier_advance_applications` "mirrors `customer_advance_applications`" glosses over a missing prerequisite function.**
**Accepted (fixed).** Rev2 §2.7 makes building `receiveSupplierAdvance` an explicit prerequisite task, ordered before the new table. Roadmap Sprint 6B.

**23. Bank Reconciliation's date+amount auto-matching has no tie-breaking rule for same-day/same-amount duplicates.**
**Accepted (fixed).** Rev2 §2.14 adds the tie-break rule (propose in insertion order, but any tie group requires mandatory manual confirmation, never silent auto-match) plus an explicit dealer-scoping statement on the match query. Roadmap Sprint 6C.

**24–25. New tables (`cost_centers`, `fixed_assets`, `fixed_asset_depreciation_schedule`, `bank_statement_imports`, `bank_statement_lines`) lack an explicit direct `dealer_id` requirement; no blanket rule stated.**
**Accepted (fixed).** Rev2 restates, for every one of these tables in §2.9–§2.14, that `dealer_id` is carried directly, not only transitively, matching the codebase's own established convention (`posting_lines`, `gl_accounts`). Roadmap Sprint 6D, 6C.

**26. Pre-existing `gl_journal_lines` has no direct `dealer_id` column, unaddressed even though it becomes the sole statement source of truth.**
**Accepted (fixed).** Rev2 §1.1, §2.5 add a direct, backfilled `dealer_id` column as an explicit Sprint 6A prerequisite, before this table is trusted as the statement source. Roadmap Sprint 6A item 5.

**27. Period-lock lookup not explicitly required to filter by `dealer_id` in addition to `entry_date`.**
**Accepted (fixed).** Resolved as part of Finding #15's fix — the lock check lives inside the same `persistPostingBatch`/`journal.ts` functions that already require `dealerId` as a parameter, so it is inherently dealer-scoped by construction. Rev2 §2.2.

**28. `GET /api/audit-logs` already permits super_admin cross-tenant drill-down; undocumented for the expanded financial audit surface.**
**Accepted (fixed).** Rev2 §2.17 explicitly brings the new financial-action audit coverage under the same `restrictSuperAdminOnFinancials` guard designed for Finding #7. Roadmap Sprint 6E.

**29. "Reopen a closed period" has no explicit role-AND-dealer_id check requirement.**
**Accepted (fixed).** Rev2 §2.2, §4 state explicitly that this action must check the requesting user's `dealer_id` against the period's `dealer_id`, following the existing `resolveDealer` pattern. Roadmap Sprint 6E.

**30. Super Admin "cross-tenant aggregate only" claim has no described mechanism; doesn't reference the existing correct pattern (`adminStats.ts`).**
**Accepted (fixed).** Independently confirmed `adminStats.ts` exists. Rev2 §4 explicitly builds the new aggregate view as an extension of that confirmed pattern. Roadmap Sprint 6E. (Same underlying fix as Finding #7.)

**31. No Trial Balance → journal-entry drill-down anywhere in either document.**
**Accepted (fixed).** Rev2 §2.13 adds this. Roadmap Sprint 6C.

**32. No AR/AP bad-debt write-off workflow despite Sprint 6B being the dedicated AR/AP sprint.**
**Accepted (fixed).** Rev2 §2.6 adds a write-off workflow with a new `6100 Bad Debt Expense` account. Roadmap Sprint 6B.

**33. No reconciliation mechanism proposed for GL-derived Inventory vs. the live `stock` table, despite an analogous mechanism existing for AR/AP.**
**Accepted (fixed).** This was a genuine asymmetry in Revision 1's own risk-management philosophy (it designed a check for one dual-source-of-truth risk but not the structurally identical one on Inventory). Rev2 §2.13 adds the mirrored Inventory reconciliation job. Roadmap Sprint 6E.

**34. Purchase Return has no posting-engine/GL wiring at all today, contradicting `PURCHASE_COMPLETION_REPORT.md`'s "ready for GL" framing.**
**Accepted (fixed).** Independently confirmed: `purchaseReturns.ts` never imports `PostingOrchestrator`. Rev2 §1.2 explicitly reconciles this against the Purchase Completion Report's claim, and §2.5/Roadmap 6A treat Purchase Return as first-time wiring, not an extension.

---

## MINOR findings

**35. `PostingDocumentType` hardcoded to `'purchase' | 'sale'`, needs widening.**
**Accepted (fixed).** Rev2 §2.5 lists the additive widening explicitly. Roadmap Sprint 6A.

**36. `5900 Clearing/Suspense` typed as a plain `asset`, unreconciled with its "must net to zero" role.**
**Accepted (fixed).** Rev2 §2.1 excludes Clearing from Balance Sheet asset totals unless non-zero, rendering it on its own "Suspense" line when it isn't.

**37. Expense `paid_account_id` described as route-only; actually needs new columns on two tables.**
**Accepted (fixed).** Rev2 §2.8 lists both required columns explicitly. Roadmap Sprint 6B.

**38. `accounting_periods`/`budgets` dealer scoping only transitive via parent FK.**
**Accepted (fixed).** Folded into the same direct-`dealer_id` rule as Findings #24–26. Rev2 §2.2, §2.12.

**39. No recurring/standing journal entries.**
**Partially accepted.** This remains a deliberate exclusion, not a build item — Roadmap Sprint 6D now states explicitly that this is excluded from the entire roadmap (not silently absent), since it's a convenience feature rather than a correctness gap and there is no evidence any current dealer workflow needs it yet. If a future need is identified, it is additive work outside this roadmap's five sprints.

**40. No forward-looking note on inter-branch/inter-company transfer accounting, despite `branches` and a paid multi-branch tier already existing.**
**Partially accepted.** The reviewer's own assessment correctly noted this is a gap in Inventory/Sales (no `branch_id` on any transactional table yet), not something Phase 6's accounting design can be faulted for solving on its own. Rev2 does not add inter-branch GL mapping (there is nothing to map yet), but the point that this should be flagged as a forward-looking risk is fair — noted here and in Rev2 §1.1 as an acknowledged, deliberately out-of-scope item for a future Inventory/Sales sprint to raise again once branch-scoped transactions exist.

**41. Landed-cost proportional-allocation rounding leakage never named as a Clearing-account use case.**
**Accepted (fixed).** Rev2 §2.5 names this explicitly, with a standard apportionment rule (remainder to the largest line).

**42. The architecture doc never reconciles its own findings against `docs/PURCHASE_COMPLETION_REPORT.md`'s stale "no double-entry ledger exists" claim.**
**Accepted (fixed).** Rev2 §1.2 adds the explicit reconciling note.

---

## Summary

| Verdict | Count |
|---|---|
| Accepted (fixed) | 39 |
| Partially accepted | 3 (#20 VAT-inclusive pricing — business decision required; #39 recurring journals — deliberate exclusion; #40 inter-branch — out of scope until Inventory/Sales supports branch-scoped transactions) |
| Rejected | 0 |

No finding was rejected. Three independent, high-stakes spot-checks against the live codebase (the dual-write premise, the dead `tax` domain, and the stock-domain sign bug) confirmed the review's evidence-based claims were accurate, and no evidence was found contradicting any other finding during the revision process. Revision 2 of both documents addresses all 39 "fixed" items directly in the architecture and roadmap text (marked **[REVISED]**/**[NEW]** inline) and documents the 3 "partially accepted" items as explicit open questions or deliberate, stated exclusions rather than silent gaps.
