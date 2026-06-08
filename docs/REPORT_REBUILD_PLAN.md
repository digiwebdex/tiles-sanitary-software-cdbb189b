# Report Rebuild Plan

**Problem:** 70+ report endpoints compute balances independently → conflicting numbers (audit §2.5, §2.6).

**Goal:** All financial and balance reports read from **normalized postings** or **materialized read models** — zero inline sign hacks.

---

## 1. Report tiers

| Tier | Examples | Data source (target) |
|------|----------|----------------------|
| **A — Balances** | Customer due, supplier payable, purchase paid/due | `mv_*` or `posting_lines` aggregation |
| **B — Financial statements** | P&L, balance sheet, trial balance | Header columns + postings; then GL |
| **C — Operational** | Stock, batch, movement, low stock | `stock_movements`, `stock`, batches |
| **D — CRM/analytics** | Leads, quotations, salesman | Document headers only |

Only **Tier A & B** require rebuild first.

---

## 2. Canonical balance queries (replace all variants)

### Customer outstanding

```sql
-- Target: one function used everywhere
SELECT customer_id, compute_customer_outstanding(dealer_id, customer_id) ...
-- Implementation wraps posting_lines or mv_customer_outstanding
```

**Retire:** sign-based logic in `/api/reports/customer-due`.

### Supplier payable

```sql
-- Use computeSupplierBalance(posting_lines or supplier_ledger)
-- Already correct in: supplier-payable, supplier-outstanding, dashboard (after fix)
```

**Fix:** `financials.ts` balance sheet AP — replace `MAX(0, SUM(amount))`.

### Purchase bill status

```sql
-- mv_purchase_payment_status or purchase header paid_amount/due_amount maintained by engine
```

**Retire:** hardcoded `paid=0` in frontend (fixed on main).

---

## 3. Endpoint migration map

| Endpoint | Current source | Target | Priority |
|----------|---------------|--------|----------|
| `GET /collections/outstanding` | type-based ledger | `mv_customer_outstanding` | P1 |
| `GET /reports/customer-due` | **broken** sign math | deprecate → redirect | P0 |
| `GET /reports/page/due-aging` | `sales.due_amount` | OK if engine syncs header | P1 |
| `GET /reports/supplier-payable` | computeSupplierBalance ✓ | posting_lines | P2 |
| `GET /reports/supplier-outstanding` | ✓ | same | P2 |
| `GET /reports/page/payments` | customer_ledger only | union customer + supplier payments | P1 |
| `GET /financials/balance-sheet` AP | raw SUM ✗ | computeSupplierBalance | P0 |
| `GET /financials/p-and-l` COGS | sales.cogs ✓ | + return COGS reversal Phase 2 | P1 |
| `GET /dashboard` widgets | mixed | read models | P1 |
| `GET /reports/accounting-summary` | inline rollups | posting_lines by period | P2 |

---

## 4. Financial statements rebuild

### P&L (target)

| Line | Source |
|------|--------|
| Revenue | `SUM(sales.total_amount)` posted in period |
| Sales returns | `SUM(sales_returns.refund_amount)` |
| COGS | `SUM(sales.cogs)` + `SUM(sales_returns.cogs_reversal)` |
| Expenses | `SUM(expense_ledger)` or posting_lines expense domain |
| Gross/net profit | derived |

### Balance sheet (target)

| Line | Source |
|------|--------|
| Cash | `SUM(cash_ledger)` |
| Bank | `SUM(bank_ledger)` per account |
| Inventory | `SUM(stock × average_cost_per_unit)` — **not** cost_price master |
| AR | `mv_customer_outstanding` total |
| AP | `mv_supplier_payable` total |
| Equity | directors + retained |

### Trial balance

Compose from same read models + journal lines until GL spine live.

---

## 5. Operational reports (minimal change)

| Report | Keep source | Enhancement |
|--------|-------------|-------------|
| Stock on hand | `stock` + products | add warehouse dim Phase 3 |
| Batch tracking | `product_batches` | OK |
| Stock movement | **NEW** `stock_movements` | replaces ad-hoc joins |
| Low stock | products.reorder_level + stock | OK |
| Sales by salesman | sales header | OK |

---

## 6. Mushak / VAT reports (Phase 4)

| Report | Source |
|--------|--------|
| Mushak 6.3 sales register | `tax_posting_lines` WHERE mushak_form='6.3' |
| Mushak 6.1 purchase register | tax_posting_lines 6.1 |
| VAT summary by period | GROUP BY tax_period |
| BIN/TIN missing audit | party master LEFT JOIN tax lines |

Export: CSV + print layout matching NBR field order (spec TBD with accountant).

---

## 7. Frontend report hub cleanup

| Change | Detail |
|--------|--------|
| Group tabs | Financial / Inventory / Sales / Purchase / HRM |
| Search | filter 60+ tabs |
| Badge | "Ledger-based" vs "Operational" |
| Drill-down | balance → posting_lines → source document |
| Warnings | surface `financials.warnings[]` prominently |

---

## 8. Testing strategy

| Test | Pass criteria |
|------|---------------|
| Golden path | Purchase 100k → Pay 40k → Payable 60k on **all** screens |
| Collection FIFO | 2 invoices → 1 payment → oldest cleared first |
| Return | Sale return reduces due and restores batch qty in batch report |
| P&L tie-out | COGS = Δ inventory (approx) + purchases − returns |
| Cross-report | Dashboard due = Collections total = Due aging sum |

Automate in `backend/src/test/reportParity.test.ts`.

---

## 9. Rollout

1. Fix P0 broken endpoints (financials AP, customer-due) — **no new tables**
2. Introduce read model views alongside legacy
3. Switch Tier A reports one by one; compare shadow outputs
4. Deprecate duplicate endpoints (301 redirect)
5. Document canonical report list in `FINANCIAL_REPORTING.md`

---

## 10. Reports to deprecate or merge

| Deprecate | Merge into |
|-----------|------------|
| `/reports/customer-due` | `/collections/outstanding` |
| Duplicate supplier reports | single `/reports/supplier-payable` with filters |
| Inline dashboard SQL duplicates | shared `ReportQueryService` methods |

Keep endpoint URLs as aliases for 2 releases with deprecation header.
