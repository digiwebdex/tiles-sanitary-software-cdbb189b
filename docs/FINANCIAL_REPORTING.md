# Financial Reporting — Source of Truth

> Maintained as part of Track 1 Phase 1 (2026-06).
> Audience: backend engineers, support staff, and anyone asked
> "where does this number on the P&L come from?".

This document maps every numeric field returned by
`backend/src/routes/financials.ts` back to the canonical column it is
derived from. Use it when triaging dealer questions about a P&L or
Trial Balance figure.

---

## Endpoint: `GET /api/financials/p-and-l`

| Response field | Source SQL (canonical) | Notes |
|---|---|---|
| `revenue` | `SUM(sales.total_amount)` over `sale_date ∈ [from, to]` | Gross sales total. Includes paid + unpaid. |
| `sales_returns` | `SUM(sales_returns.refund_amount)` over `return_date ∈ [from, to]` | Replaces the previous `qty × <nonexistent unit price>` query. Broken-stock returns with `refund_amount = 0` correctly contribute zero. |
| `net_revenue` | `revenue − sales_returns` | Derived. |
| `cogs` | `SUM(sales.cogs)` over `sale_date ∈ [from, to]` | The `sales.cogs` column is populated atomically by `routes/sales.ts` on create and update, using `stock.average_cost_per_unit` at sale time. **NULL rows are excluded by SUM and reported in `warnings[]`.** |
| `expenses_by_category` | `SELECT category, SUM(amount) FROM expenses GROUP BY category` | Free-text categories today; master is a Phase 2 item. |
| `total_expenses` | `Σ expenses_by_category` | Derived. |
| `gross_profit` | `revenue − sales_returns − cogs` | Derived. |
| `net_profit` | `gross_profit − total_expenses` | Derived. |
| `data_source` | constant: `"sales.cogs + sales_returns.refund_amount"` | Helps support identify which version of the endpoint produced a screenshot. |
| `warnings[]` | dynamic | One entry per data-quality issue encountered (e.g., legacy NULL-cogs rows). |

### Phase 1 known limitation

Sales returns reduce the `sales_returns` line but do **not** reverse the
COGS line in Phase 1. The COGS is taken from `sales.cogs` as it stood at
sale time. A returned non-broken item that puts stock back on the shelf
will be reflected correctly in inventory valuation (on the Balance
Sheet) but the historical COGS attributed to the original sale remains
unchanged for the period. Track 1 Phase 2 adds line-level reversed-COGS
tracking on `sales_returns`.

---

## Endpoint: `GET /api/financials/balance-sheet`

| Response field | Source |
|---|---|
| `assets.cash` | `SUM(cash_ledger.amount)` up to `as_of`. |
| `assets.bank_total` and `assets.bank_accounts[*].balance` | `SUM(bank_ledger.amount) GROUP BY bank_account_id` up to `as_of`. |
| `assets.inventory` | `Σ stock_row × cost_price`, branched by `unit_type`. Uses the product master `cost_price` (not weighted-average) for now — refinement is a Phase 2 item. |
| `assets.accounts_receivable` | `SUM(GREATEST(0, sales.total_amount − sales.paid_amount))` clamped per-sale up to `as_of`. |
| `liabilities.accounts_payable` | `sumSupplierPayable()` from `backend/src/services/reportQueryService.ts` — Σ per-supplier `computeSupplierOutstanding()` (matches Dashboard and Supplier Payables). **Do not use raw `SUM(supplier_ledger.amount)`.** |
| `equity.director_capital` | `Σ deposits − Σ withdrawals − Σ dividends` from `director_transactions`. |
| `equity.retained_earnings` | `(assets − liabilities) − director_capital`. |
| `warnings[]` | dynamic; populated by `safeSum/safeQuery` on any computation failure. |

---

## Endpoint: `GET /api/financials/trial-balance`

The trial balance composes the same source columns as P&L + Balance
Sheet, plus manual journal lines from `journal_entry_lines`. Account
labels are currently English strings (no `account_definitions` master
yet — that ships in Phase 2).

Important per-account sources:

| Account label | Source |
|---|---|
| `Cash on Hand` | `cash_ledger.amount` sum |
| `Bank — <name> (<acct no>)` | `bank_ledger.amount` sum per account |
| `Inventory` | `stock × cost_price` per `unit_type` |
| `Accounts Receivable` | clamped unpaid-sale sum |
| `Accounts Payable` | `sumSupplierPayable()` — per-supplier outstanding (Phase 1 fix) |
| `Director Capital` | director transactions net |
| `Sales Revenue` | `SUM(sales.total_amount)` |
| `Sales Returns` | `SUM(sales_returns.refund_amount)` — fixed in Phase 1 |
| `Cost of Goods Sold` | `SUM(sales.cogs)` — fixed in Phase 1 |
| `Expense — <category>` | `SUM(expenses.amount) GROUP BY category` |
| `Journal — <account>` | `SUM(jel.debit) − SUM(jel.credit)` per `jel.account` |

---

## Canonical balance sources (Phase 1 — ReportQueryService)

All customer/supplier **due** and **payable** figures must flow through
`backend/src/services/reportQueryService.ts` and
`backend/src/lib/ledgerBalance.ts`. Do not add new inline balance SQL in
route handlers.

| Concept | Canonical function | Used by |
|---------|-------------------|---------|
| Customer due (per customer) | `computeCustomerBalance()` / `aggregateCustomerLedger()` | Collections, Customer Due report, dashboard widgets |
| Customer due (grand total, invoices) | `sumCustomerOutstandingFromSales()` | Dashboard total, Due Aging |
| Customer due (grand total, ledger) | `sumCustomerOutstandingFromLedger()` | Parity checks vs Collections |
| Supplier payable (per supplier) | `computeSupplierOutstanding()` | Supplier Payable / Outstanding reports |
| Supplier payable (grand total) | `sumSupplierPayable()` | Dashboard, Balance Sheet AP, Trial Balance AP |

**Parity expectation (fresh data):** After every payment through
`recordCustomerPayment()` or `recordSales` payment paths, ledger balance
and `sales.due_amount` headers stay in sync within ৳0.01. Automated
fixtures live in `src/test/reportParity.test.ts`.

---

## Why we read from header columns, not line items

Both `sales.cogs` and `sales_returns.refund_amount` are computed and
stored atomically by the write path inside a single Knex transaction,
alongside the `sale_items` / ledger / batch updates. They are the
canonical, authoritative numbers for reporting. The previous attempt to
recompute COGS by joining `sale_items` to `products` was both wrong
(referenced a nonexistent column) and slower at scale. Reading the
header column is correct and cheap.

When (in Phase 2) we add a real general-ledger spine
(`gl_postings` table), the financial endpoints will switch to query the
GL instead. Until then, header columns are the source of truth.

---

## How errors are surfaced

Every aggregation inside `financials.ts` flows through
`safeSum(...)` or `safeQuery(...)` from `backend/src/lib/safeSum.ts`.
On failure, the helpers:

1. Return `0` (or the supplied fallback) so the endpoint never crashes.
2. Write a single-line JSON record to **stderr** with the route name
   and error message via `logRouteError`.
3. Append a human-readable string to the response's `warnings[]` array.

Operators can grep stderr for `"level":"error","route":"financials."`.
End users see the warnings rendered as a "Data quality notes" alert
on the Financial Statements page. There is no silent failure path
anywhere in this file — that is enforced by the lint-style tests in
`src/test/financialsNoSilentCatch.test.ts`.

---

## Pre-deploy verification (per release)

Before flipping the endpoint live for a dealer:

1. Restore a recent backup of the dealer's database to a staging
   Postgres.
2. Hit the new endpoint and an instance of the old endpoint with the
   same `dealerId`, `from`, `to` parameters.
3. The delta on `gross_profit` should equal exactly:

       (old.gross_profit) − (new.gross_profit)
       = SUM(sales.cogs) WHERE dealer_id = ? AND sale_date ∈ [from, to]
         + SUM(sales_returns.refund_amount) WHERE dealer_id = ? AND return_date ∈ [from, to]

   Any other delta is a bug — investigate before rollout.
4. On Trial Balance: `Math.abs(difference)` should approach 0 on
   healthy data once the COGS debit line appears.

---

## Rollback

If the new endpoint regresses for any reason, the rollback is a single
git revert of the PR (`Track 1 Phase 1`). No database changes, no
schema changes, no migrations to roll back. The previous (buggy)
behaviour is restored on the next deploy.

Per-dealer feature-flag-based rollback was scoped but not implemented
in Phase 1 because the change has no schema impact and reverts cleanly
at the deploy level. If a future hotfix carries schema impact, the
plan is to add a `feature_flags.pnl_v2` flag at that time.
