# SaniTiles ERP — Restructure Blueprint

**Baseline:** `docs/CURRENT_SYSTEM_AUDIT.md` (2026-06-08)  
**Target:** Transaction-driven architecture for Bangladesh tiles & sanitary dealers  
**Status:** Planning only — no implementation in this document

---

## 1. Executive verdict

### Is the Perplexity / audit direction good?

**Yes — the direction is correct.** The audit correctly identifies the root problem: **side effects are scattered across 76 route modules** instead of flowing through normalized posting rules. For a tiles dealer in Bangladesh, that causes:

- Stock and money disagreeing across screens
- Reports that use different formulas for the same concept
- No safe way to fix a posted purchase or return batches correctly
- No path to VAT/Mushak without rewriting everything again

### What we recommend beyond the audit (more advanced, still practical)

| Audit suggestion | Our enhancement |
|----------------|-----------------|
| Fix ledger signs route-by-route | **Single posting engine** + immutable posting lines |
| Add payment fields / screens | **Document-centric payments** tied to posting events |
| Materialized views for due/payable | **Read models** fed only from `posting_lines` + document headers |
| Warehouse columns on stock | **Warehouse as posting dimension** on stock movements, not metadata-only transfers |
| VAT columns on sales/purchases | **Tax profile layer** (Mushak-6.3 / 6.1) as document extensions, not ad-hoc columns only |

**Do not** continue patching individual routes indefinitely. **Do** introduce a thin posting spine while keeping existing tables during migration.

---

## 2. Target architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI / API (thin)                          │
│  Purchase, Sale, Return, Delivery, Collection, Payable, Expense │
└────────────────────────────┬────────────────────────────────────┘
                             │ submit / approve / post / reverse
┌────────────────────────────▼────────────────────────────────────┐
│                   DOCUMENT SERVICE LAYER                         │
│  Validates state transitions, RBAC, approvals, tenant scope      │
│  States: draft → pending_approval → posted → reversed (terminal) │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ STOCK POSTING   │ │ LEDGER POSTING  │ │ TAX POSTING     │
│ ENGINE          │ │ ENGINE          │ │ (Phase 4)       │
│ one mutation    │ │ one mutation    │ │ VAT/Mushak      │
│ path for qty    │ │ path for money  │ │ ready           │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
   stock_movements      posting_lines         tax_lines
   batch_movements      → sub-ledgers         mushak_register
   stock (aggregate)    → cash/bank           (future)
                        → optional gl_postings
```

### Non-negotiable rules

1. **One source of truth for inventory mutations** — all qty changes go through `StockPostingEngine`.
2. **One source of truth for accounting mutations** — all money effects go through `LedgerPostingEngine`.
3. **No direct edit of posted documents** — only `reverse` + optional `repost` as new document version.
4. **All reports read postings** — not inline SUM hacks in 43 report endpoints.
5. **Tenant isolation + RBAC preserved** — `dealer_id` on every posting line; existing roles unchanged.

---

## 3. Current → target module map (refactor first)

| Priority | Current hot spots | Why first |
|:--:|-------------------|-----------|
| **P0** | `purchases.ts`, `sales.ts`, `returns.ts` | Core money + stock; most user pain |
| **P0** | `customerPayment.ts`, `supplierPayment.ts`, `collections.ts` | Split payment paths; unify under ledger engine |
| **P0** | `ledgerBalance.ts`, `financials.ts`, `reports.ts` (due/payable) | Formula conflicts break trust |
| **P1** | `challans.ts`, `deliveries.ts`, `reservations.ts` | Fulfillment state vs stock timing |
| **P1** | `warehouses.ts`, `adjustments.ts` | Warehouse gap; manual stock bypass |
| **P1** | `approvals.ts` + sale/adjustment routes | Frontend-only approval gate |
| **P2** | `displayStock.ts`, `sampleIssues.ts` | Parallel stock on `products.current_stock` |
| **P2** | `journal.ts`, `expenses.ts`, `employees.ts` | Extend posting engine |
| **P3** | Portal Supabase reads | Dual-stack drift |

See `DOMAIN_SERVICE_MAP.md` for full mapping.

---

## 4. Document types & posting ownership

| Document | Creates stock effect? | Creates ledger effect? | Reversible? | Approval hooks |
|----------|----------------------|----------------------|-------------|------------------|
| Purchase | Yes (in) | Supplier payable + cash/bank | Yes (Phase 2) | Optional GRN checkpoint |
| Sale / POS | Yes (out) or reserve | Customer due + cash/bank | Yes (cancel/reverse) | Credit, discount, backorder |
| Sales return | Yes (in, batch target) | Customer credit + cash refund | Yes | Broken stock flag |
| Purchase return | Yes (out) | Supplier credit + cash/bank | Yes | — |
| Delivery | Fulfillment status | No qty (today) | Status only | — |
| Challan | Reserve / unreserve | On convert only | Cancel unreserves | — |
| Collection payment | No | Customer + cash/bank | Yes (payment reversal) | — |
| Supplier payment | No | Supplier + cash/bank | Yes | — |
| Expense | No | Expense + cash/bank | Yes | Optional |
| Warehouse transfer | **Should** (Phase 3) | Transport cost only today | Yes | Approve/receive |
| Stock adjustment | Yes | Optional expense link | Yes | Required if configured |

---

## 5. Bangladesh business fit

### Tiles & sanitary specifics

- **Dual unit display:** box + SFT on every tile line (posting stores canonical qty in SFT for `box_sft` products).
- **Batch/shade/caliber/lot:** batch movements are first-class in stock engine, not optional on returns.
- **Challan culture:** document state machine must support sell-now-deliver-later without corrupting due/stock.
- **Project sales:** project/site as dimensions on sale document, not separate stock path.

### VAT / Mushak readiness (Phase 4 — design now, build later)

- Dealer **BIN**, customer **TIN** on party master
- Document types: **Tax Invoice (Mushak-6.3)**, **Purchase VAT (6.1)**, **Debit/Credit Note**
- Fields: `vat_rate`, `vat_amount`, `sd_amount`, `mushak_serial`, `fiscal_year`
- `tax_posting_lines` linked to `posting_lines` for Mushak register export
- Bangla print templates separate from operational challan

### Payment modes (Bangladesh)

Extend payment posting with: `cash | bank | bkash | nagad | rocket | cheque` + `transaction_ref`.

---

## 6. What NOT to do

| Anti-pattern | Why |
|--------------|-----|
| Keep fixing each report's SQL individually | 70+ endpoints will drift again |
| Allow `PUT` on posted purchase | Breaks audit trail; use reverse |
| Store due on both ledger and header without sync rule | Already caused collections drift |
| Add VAT columns without posting engine | Mushak totals won't reconcile |
| Build warehouse UI before warehouse stock postings | Empty transfers forever |

---

## 7. Success criteria

| Metric | Target |
|--------|--------|
| Purchase → Pay → Ledger | Single workflow; payable = ledger balance |
| Sale → Collect → Invoice due | Always zero when fully paid |
| Return | Restores correct batch when not broken |
| P&L COGS | Matches stock WAC × SFT sold |
| Supplier payable | Same number on dashboard, payables, balance sheet |
| Posted document edit | Impossible from UI/API |
| Mushak export | Phase 4: totals tie to tax posting lines |

---

## 8. Related deliverables

| Document | Purpose |
|----------|---------|
| `DOMAIN_SERVICE_MAP.md` | Module → target service mapping |
| `WORKFLOW_STATE_DIAGRAMS.md` | State machines per document |
| `POSTING_RULES_MATRIX.md` | Event → stock/ledger/tax effects |
| `DB_REFACTOR_PLAN.md` | Schema evolution |
| `REPORT_REBUILD_PLAN.md` | Report layer on postings |
| `PHASED_IMPLEMENTATION_BACKLOG.md` | Ordered work packages |

---

## 9. Review vs Perplexity-style plan

**If Perplexity proposed:** "normalize workflows, fix ledger signs, single payment path, warehouse wiring, VAT prep" — **agree 100%.**

**Our additions for smoother ERP:**

1. **Posting engine first** — fixes signs, payments, and reports together.
2. **Explicit document lifecycle** — draft/posted/reversed replaces silent PUT on sales and dead-end purchases.
3. **Batch-aware returns** — mandatory for tile dealers; aggregate-only restore is unacceptable.
4. **Server-side approval consume** — security + audit, not just React gates.
5. **Read model layer** — stop each report inventing balance math.
6. **Phase 0 on main** — several audit items already fixed (tile COGS, unified customer payment, supplier payment Phase 1); blueprint builds on current `main`, not stale audit snapshots.

**Verdict:** Proceed with restructure. Start Phase 0 consolidation, then posting engine — not another round of route-level patches.
