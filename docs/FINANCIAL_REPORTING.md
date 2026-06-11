# Financial Reporting — Source of Truth

> **Last updated:** 2026-06-11 (P1-08 refresh — Phase 4 read models, WAC inventory, bank routing)  
> **Audience:** backend engineers, support staff, and anyone asked “where does this number come from?”

This document maps numeric fields from financial endpoints, dashboard widgets, and Tier A balance reports back to canonical sources in code. Use it when triaging dealer questions about P&L, Balance Sheet, Trial Balance, Cashbook, Collections, or Payables.

**Canonical code paths:**

| Layer | Location |
|-------|----------|
| Financial statements API | `backend/src/routes/financials.ts` |
| Balance read models | `backend/src/services/reportQueryService.ts` + migration `062_balance_read_views.ts` |
| Ledger sign math | `backend/src/lib/ledgerBalance.ts` |
| Customer payments | `backend/src/lib/customerPayment.ts` |
| Supplier payments | `backend/src/lib/supplierPayment.ts` |
| Cashbook (merged view) | `backend/src/routes/cashbook.ts` |

---

## Read models (Phase 4 — P4-01 / P4-02)

PostgreSQL **views** (always fresh; no refresh job):

| View | Definition | Used for |
|------|------------|----------|
| `mv_customer_outstanding` | `SUM(sales.due_amount)` per customer, excluding `document_status = 'reversed'` | AR totals, Due Aging, Collections outstanding, Credit report, Balance Sheet AR (current) |
| `mv_supplier_payable` | Per-supplier rollup from `supplier_ledger` via `computeSupplierOutstanding()` | AP totals, Supplier Outstanding, Payables summary, Balance Sheet AP (current) |

**Rule:** Tier A customer/supplier **balance totals** must come from these views (via `reportQueryService.ts`). Do not add new inline `SUM(supplier_ledger.amount)` or ad-hoc due SQL in route handlers.

### Key functions (`reportQueryService.ts`)

| Concept | Function | Consumers |
|---------|----------|-----------|
| Customer AR (total) | `sumCustomerOutstandingFromReadModel()` | Dashboard, Balance Sheet AR, Trial Balance AR |
| Customer AR (per party) | `getCustomerOutstandingMapFromReadModel()` | Collections `/outstanding`, Credit report |
| Customer AR (single) | `getCustomerOutstandingFromReadModel()` | `GET /api/ledger/customers/due-balance/:id` |
| Supplier AP (total) | `sumSupplierPayable(dealerId, asOf?)` | Dashboard, Balance Sheet AP, Trial Balance AP |
| Supplier AP (per party) | `getSupplierOutstandingMapFromReadModel()` | Supplier performance exposure |
| Supplier AP (single) | `getSupplierOutstandingFromReadModel()` | `GET /api/ledger/suppliers/due-balance/:id`, FIFO payment cap |
| Payables page totals | `listPayablesOutstanding()` | `GET /api/payables/outstanding` — read-model caps + bill rows for FIFO UI |
| Inventory (WAC) | `sumInventoryValuationWac()` | Balance Sheet, Trial Balance, Dashboard (P4-03) |

**Historical `asOf` snapshots:** When Balance Sheet / Trial Balance pass `asOf`, AR falls back to clamped `sales.total_amount − sales.paid_amount` as of that date; AP uses ledger rollup through `asOf` (not the live view).

**Parity tests:** `src/test/readModelParity.test.ts`, `src/test/reportParity.test.ts`

---

## Payment flows & cash/bank posting (P1-04)

All customer **receipts** and supplier **outflows** route to exactly one of:

| Destination | When |
|-------------|------|
| `cash_ledger` | `paid_account_id` is null / omitted (“Cash in Hand”) |
| `bank_ledger` | `paid_account_id` = `bank_accounts.id` |

### Customer receipts (`type = 'receipt'`, positive amount)

| UI / API | Endpoint | Ledger helper |
|----------|----------|-----------------|
| Collections (FIFO) | `POST /api/collections/payment` | `recordCustomerPayment()` → `postCustomerReceipt()` |
| Invoice pay | `POST /api/sales/:id/payment` | `recordCustomerPayment()` |
| Sale create (paid on create) | `POST /api/sales` | `postCustomerReceipt()` when `paid_amount > 0` |
| Sale edit (paid on create) | `PUT /api/sales/:id` | `postCustomerReceipt()` |
| POS checkout | `POST /api/sales` | same as sale create |

Optional `payment_mode` (e.g. `cash`, `bKash`, `cheque`) is stored on **cash** receipts only.

### Supplier outflows (`type = 'payment'`, negative in bank / cash)

| UI / API | Endpoint | Ledger helper |
|----------|----------|-----------------|
| Pay Supplier (FIFO) | `POST /api/payables/payment` | `recordSupplierPaymentFifo()` |
| Purchase bill pay | `POST /api/purchases/:id/payment` | `recordSupplierPayment()` |
| Purchase create (paid on create) | `POST /api/purchases` | purchase create path in `purchases.ts` |

### Cashbook (`GET /api/cashbook`)

Merged, chronological list of `cash_ledger` + `bank_ledger` with running balance. This is what the **Cashbook** page (`/cashbook`) displays. Supplier payments with `paid_account_id` appear as **bank** rows; cash payments appear as **cash** rows — matching the screenshot pattern (e.g. bank tag for `PUR-…` payment, cash tag for customer collection).

---

## Endpoint: `GET /api/financials/p-and-l`

| Response field | Source | Notes |
|----------------|--------|-------|
| `revenue` | `SUM(sales.total_amount)` over `sale_date ∈ [from, to]` | Gross sales; includes paid + unpaid |
| `sales_returns` | `SUM(sales_returns.refund_amount)` over `return_date` range | Broken-stock returns with `refund_amount = 0` contribute zero |
| `net_revenue` | `revenue − sales_returns` | Derived |
| `cogs` | `SUM(sales.cogs)` over sale date range | Set atomically on sale create/update |
| `cogs_reversal` | `SUM(sales_returns.cogs_reversal)` over return date range | Reduces COGS when stock is returned (non-broken path) |
| `net_cogs` | `cogs − cogs_reversal` | Derived |
| `expenses_by_category` | `SUM(expenses.amount) GROUP BY category` | Free-text categories today |
| `total_expenses` | Σ `expenses_by_category` | Derived |
| `gross_profit` | `revenue − sales_returns − net_cogs` | Derived |
| `net_profit` | `gross_profit − total_expenses` | Derived |
| `data_source` | constant string | Identifies endpoint version in support screenshots |
| `warnings[]` | dynamic | Legacy COGS (`cogs_method = 'legacy_pre_fix'`), NULL checks, `detectCogsDataQualityWarnings()` |

---

## Endpoint: `GET /api/financials/balance-sheet`

| Response field | Source |
|----------------|--------|
| `assets.cash` | `SUM(cash_ledger.amount)` up to `asOf` |
| `assets.bank_total`, `assets.bank_accounts[*].balance` | `SUM(bank_ledger.amount) GROUP BY bank_account_id` up to `asOf` |
| `assets.inventory` | `sumInventoryValuationWac()` — `stock × average_cost_per_unit`, `cost_price` fallback (P4-03) |
| `assets.accounts_receivable` | **Current:** `sumCustomerOutstandingFromReadModel()` · **asOf:** clamped unpaid sales through date |
| `liabilities.accounts_payable` | `sumSupplierPayable(dealerId, asOf)` — read model when current; ledger rollup when `asOf` |
| `equity.director_capital` | `Σ deposits − Σ withdrawals − Σ dividends` from `director_transactions` |
| `equity.retained_earnings` | `(assets − liabilities) − director_capital` |
| `warnings[]` | From `safeSum` / `safeQuery` on any computation failure |

---

## Endpoint: `GET /api/financials/trial-balance`

Composes the same sources as P&L + Balance Sheet, plus manual journal lines from `journal_entry_lines`.

| Account label | Source |
|---------------|--------|
| `Cash on Hand` | `cash_ledger` sum |
| `Bank — <name> (<acct>)` | `bank_ledger` sum per account |
| `Inventory` | `sumInventoryValuationWac()` |
| `Accounts Receivable` | Same as Balance Sheet AR |
| `Accounts Payable` | `sumSupplierPayable()` |
| `Director Capital` | director transactions net |
| `Sales Revenue` | `SUM(sales.total_amount)` |
| `Sales Returns` | `SUM(sales_returns.refund_amount)` |
| `Cost of Goods Sold` | `SUM(sales.cogs)` |
| `COGS Reversal (returns)` | `SUM(sales_returns.cogs_reversal)` when present |
| `Expense — <category>` | `SUM(expenses.amount) GROUP BY category` |
| `Journal — <account>` | `SUM(jel.debit) − SUM(jel.credit)` per account |

---

## Tier A operational reports (must match financials)

| Report / screen | AR / AP source | Notes |
|-----------------|----------------|-------|
| Dashboard widgets | Read models via `reportQueryService` | Customer due + supplier payable |
| Collections | `getCustomerOutstandingMapFromReadModel()` | Per-customer outstanding; FIFO payment |
| Due Aging | `mv_customer_outstanding` + aging buckets | `GET /api/reports/page/due-aging` |
| Supplier Outstanding | `buildSupplierOutstandingSummaryRows()` | Outstanding from read model |
| Supplier Payables | `listPayablesOutstanding()` | Totals from read model; bills for FIFO |
| Credit Control | Read model per customer | `GET /api/credit/report` |
| Payments report | `customer_ledger` + `supplier_ledger` payment rows | P1-03 — both sides |
| Posting trace drill-down | `GET /api/postings/trace` | P4-05 — batches or legacy ledger fallback |

**Deprecated:** `GET /api/reports/customer-due` → HTTP 410; use Collections or Due Aging.

---

## Parity expectations

After every payment through `recordCustomerPayment()` or sale create/edit with `paid_amount > 0`:

- `sales.due_amount` / `sales.paid_amount` stay in sync with customer ledger within ৳0.01 (fresh data).
- Collections outstanding per customer matches `mv_customer_outstanding`.
- Dashboard AR total = Due Aging grand total = Balance Sheet AR (when `asOf` is today).
- Dashboard AP = Supplier Payables header total = Balance Sheet AP (read model).
- Payables `summary.billLevelTotal` may differ from `summary.totalOutstanding` when ledger entries exist without purchase bill linkage — investigate data quality, not a reporting bug.

Automated fixtures: `src/test/reportParity.test.ts`, `src/test/readModelParity.test.ts`

---

## Why header columns for P&L (not line-item recompute)

`sales.cogs` and `sales_returns.refund_amount` / `cogs_reversal` are computed and stored atomically in the write transaction alongside `sale_items`, ledger, and batch updates. Reading header columns is correct and fast.

When the GL spine (`posting_lines` / `gl_postings`) is fully live (Phase 6), financial endpoints may switch to posting-based queries. Until then, header columns + read-model views are authoritative.

---

## Error surfacing

Aggregations in `financials.ts` use `safeSum()` / `safeQuery()` from `backend/src/lib/safeSum.ts`:

1. Return `0` (or fallback) so the endpoint never crashes.
2. Log structured errors to stderr via `logRouteError`.
3. Append human-readable strings to `warnings[]`.

The Financial Statements page renders `warnings[]` as “Data quality notes”. Tests: `src/test/financialsNoSilentCatch.test.ts`.

---

## Support checklist (per dealer question)

| Question | Check |
|----------|-------|
| “Why is Cashbook negative?” | Sum of `cash_ledger` + `bank_ledger`; large supplier payments out without matching receipts |
| “Collections due ≠ invoice list?” | Compare `mv_customer_outstanding` vs sum of open `sales.due_amount` |
| “Payables ≠ purchase bills?” | Compare `summary.totalOutstanding` vs `summary.billLevelTotal` on `/api/payables/outstanding` |
| “Bank payment missing from cash?” | Correct — bank payments post to `bank_ledger`, not `cash_ledger` |
| “P&L profit too high?” | Check `warnings[]` for `legacy_pre_fix` COGS rows |

---

## Related docs

- `docs/ERP_TASK_COMPLETE_LIST.md` — phase task status  
- `docs/REPORT_REBUILD_PLAN.md` — long-term migration map  
- `docs/OPERATIONS_GUIDE.md` — operator-facing payment how-tos  
- `docs/POSTING_RULES_MATRIX.md` — posting engine allocation rules (Phase 2+)
