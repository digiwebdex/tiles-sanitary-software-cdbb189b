# TilesERP — Complete Task List & Status

> **Last updated:** 2026-06-23  
> **Production VPS:** `/var/www/tilessaas` · deploy after merge to `main`  
> **Domain:** https://app.sanitileserp.com  
> **Baseline docs:** `PHASED_IMPLEMENTATION_BACKLOG.md`, `RESTRUCTURE_BLUEPRINT.md`

**Legend:** ✅ Done · 🟡 Partial · ⬜ Not started · 🔮 Future / optional

---

## Summary

| Area | Status |
|------|--------|
| Phase 0 — Consolidation | ✅ Complete |
| Phase 1 — Report trust | ✅ Complete (P1-08 doc refresh) |
| Phase 2 — Posting engine MVP | ✅ Complete |
| Phase 3 — Returns & inventory truth | ✅ Complete (P3-04 batch deduct, P3-08 stock table) |
| Phase 4 — Read models & reports | ✅ Complete (Tier A balance cutover; Tier B period metrics OK) |
| Phase 5 — VAT / Mushak | ✅ Complete (P5-01–06) |
| Phase 6 — GL & portal | ⬜ Future |
| Phase 7 — UX (sidebar, wizards) | ✅ Complete on VPS |
| Whole program “definition of done” | ⬜ Not complete |

---

## Phase 0 — Consolidation

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P0-01 | Tile COGS unit fix (Phase 1A) | ✅ | `cogsLine.ts`, `sales.ts` |
| P0-02 | Unified customer payment | ✅ | `customerPayment.ts`, `collections.ts` |
| P0-03 | P&L returns use `refund_amount` | ✅ | `financials.ts` |
| P0-04 | Supplier payment + purchase pay UI | ✅ | `supplierPayment.ts`, `ViewPurchase.tsx` |
| P0-05 | `sale_items.created_at` migration | ✅ | Migration 052 |
| P0-06 | Rename Payments → Collections | ✅ | Sidebar / nav |
| P0-07 | Fix dashboard supplier payable | ✅ | `dashboard.ts` |

**Exit criteria:** Fresh dealer can purchase → sell → collect → pay supplier — ✅

---

## Phase 1 — Report trust & sign unification

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P1-01 | Fix financials AP formula | ✅ | Uses `sumSupplierPayable` / read model |
| P1-02 | Fix/deprecate `/reports/customer-due` | ✅ | Returns 410 → Collections |
| P1-03 | Extend payments report to supplier payments | ✅ | Customer + supplier payment & refund rows |
| P1-04 | Bank account on customer collection + invoice pay | ✅ | Collections, invoice pay, sale create/edit, POS |
| P1-05 | Supplier FIFO payment API | ✅ | Payables / supplier payment page |
| P1-06 | Extract `ReportQueryService` | ✅ | `reportQueryService.ts` |
| P1-07 | Report parity test suite | ✅ | `reportParity.test.ts`, `readModelParity.test.ts` |
| P1-08 | Update `FINANCIAL_REPORTING.md` | ✅ | Phase 4 read models, WAC, bank routing, cashbook |

**Exit criteria:** Dashboard due = Collections = Due aging — 🟡 (read models help; verify per dealer)

---

## Phase 2 — Posting engine MVP

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P2-01 | Migration `posting_batches`, `posting_lines` | ✅ | Migration 053 |
| P2-02 | `PostingOrchestrator` + dual-write | ✅ | `PostingOrchestrator.ts` |
| P2-03 | `StockPostingEngine` — purchase, sale | ✅ | |
| P2-04 | `LedgerPostingEngine` | ✅ | |
| P2-05 | Route `purchases.ts` POST through orchestrator | ✅ | |
| P2-06 | Route `sales.ts` POST through orchestrator | ✅ | |
| P2-07 | Document status columns + backfill | ✅ | Migration 058 |
| P2-08 | Sale reverse API (no PUT on posted) | ✅ | `saleReverse.ts` |
| P2-09 | Purchase reverse API | ✅ | `purchaseReverse.ts` |
| P2-10 | Server-side approval consume on post | ✅ | `SaleApprovalGate.ts` |

**Exit criteria:** New posts create `posting_batch`; legacy tables in sync — ✅

---

## Phase 3 — Returns, warehouse, inventory truth

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P3-01 | Sales return batch restoration UI + API | ✅ | Sales return wizard (Phase 7) |
| P3-02 | COGS reversal on sales return | ✅ | Migration 059 |
| P3-03 | Sync sale due/paid on return | ✅ | `returns.ts` updates `due_amount` / `paid_amount` |
| P3-04 | Purchase return batch deduct | ✅ | `purchaseReturnStock.ts` + unit tests |
| P3-05 | `stock_movements` + engine writes | ✅ | Migration 060 |
| P3-06 | Warehouse transfer stock posting | ✅ | `warehouseTransferStock.ts` |
| P3-07 | `warehouse_stock` + backfill | ✅ | Migration 061 |
| P3-08 | Migrate off `products.current_stock` display | ✅ | `sellableStockAdjust.ts` for display/sample |
| P3-09 | GRN document (optional) | ⬜ | Optional |

**Exit criteria:** Returns restore batch; warehouse moves qty — ✅

---

## Phase 4 — Read models & report cutover

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P4-01 | `mv_customer_outstanding`, `mv_supplier_payable` | ✅ | Migration 062; wired in API |
| P4-02 | Switch Tier A reports to read models | ✅ | Payables, supplier-outstanding, supplier-performance exposure, ledger supplier due-balance |
| P4-03 | Inventory valuation uses WAC not `cost_price` | ✅ | Financials + dashboard |
| P4-04 | Report hub UX grouping + search | ✅ | Collapsible groups + hub search box (desktop + mobile) |
| P4-05 | Drill-down posting trace UI | ✅ | `/api/postings/trace`; Due Aging + Supplier Outstanding drill-down |

**Exit criteria:** No report endpoint uses ad-hoc balance SQL — ✅ Tier A (Due Aging, overdue check, project outstanding, purchases paid map via `reportQueryService`; reversed sales excluded)

---

## Phase 5 — VAT / Mushak readiness (Bangladesh)

| ID | Task | Status |
|----|------|--------|
| P5-01 | BIN/TIN on dealers/customers/suppliers | ✅ | Dealer `tax_id` (super-admin); customer `tax_id`; supplier `gstin` as BIN/TIN |
| P5-02 | Tax columns on sales/purchases | ✅ | Migration 063; `computeVatBreakdown` on create/edit |
| P5-03 | `tax_posting_lines` + engine hooks | ✅ | `taxPostingService`; lines on sale/purchase post |
| P5-04 | Mushak 6.3 / 6.1 register reports | ✅ | `/api/reports/vat/*`; Reports hub + Excel export |
| P5-05 | Tax invoice print template (Bangla) | ✅ | `VatTaxInvoiceDocument` Mushak-6.3 bilingual layout, amount in words, signatures |
| P5-06 | bKash/Nagad/SSLCommerz on postings | ✅ | `paymentModes.ts`; ledger `payment_mode`; `receipt_bkash` / `receipt_nagad` / `receipt_sslcommerz` posting lines; UI selectors |

**Exit criteria:** Monthly VAT register export — 🟡 (enable VAT in Settings, export from Reports)

---

## Phase 6 — GL & portal (future)

| ID | Task | Status |
|----|------|--------|
| P6-01 | `gl_postings` spine | 🟡 | Migration 068 + chart + journal mirror behind `USE_GL_SPINE` |
| P6-02 | Financials from GL | 🟡 | Trial balance auto-switches to GL; P&L/BS still legacy |
| P6-03 | Portal reads VPS API | ✅ | Migration 066 + full `/api/portal/*` + dual-path frontend |
| P6-04 | Portal payment requests | ✅ | Migration 067 + notify-payment workflow |

---

## Phase 7 — UX & workflows (not in original backlog)

| Task | Status | Notes |
|------|--------|-------|
| Grouped sidebar (10 sections) | ✅ | `navConfig.ts`, `SidebarNav.tsx` |
| 4-step Sales Return Wizard | ✅ | `SalesReturnWizard.tsx` |
| Supplier payment page `/payables/pay` | ✅ | FIFO + bill targeting |
| P&L COGS reversal / net COGS display | ✅ | `pnlMath.ts` |
| Onboarding checklist expansion | ✅ | |
| `pnlMath` unit tests (14) | ✅ | |

---

## Whole program — definition of done

| Goal | Status |
|------|--------|
| One posting engine for stock and money | 🟡 Dual-write MVP done; not all paths use it |
| Posted documents immutable; reverse only | ✅ Sale/purchase reverse shipped |
| All balance reports match within ৳0.01 | 🟡 Parity tests; production verify per dealer |
| Batch-aware returns for tiles | ✅ |
| Warehouse transfers move stock | ✅ |
| Approvals enforced server-side | ✅ P2-10 |
| Mushak registers exportable | 🟡 Phase 5 (API + Reports hub) |
| `CURRENT_SYSTEM_AUDIT.md` gaps closed | 🟡 |

---

## Where to find key features in the app

| Feature | Menu path | URL |
|---------|-----------|-----|
| **Current product stock** | Inventory → **Products** (Quantity column) | `/products` |
| Stock summary (one product) | Products → row actions → Stock Summary | |
| Stock reports | Reports → Products Report / Low Stock | `/reports` |
| Warehouse stock | Reports → Operations / Warehouse Stock | `/reports/operations` |
| Sales | Sales → Sales / POS | `/sales` |
| Purchases | Purchase → Purchases | `/purchases` |
| Collections (customer due) | Sales → Collections | `/collections` |
| Supplier payables | Purchase → Supplier Payables | `/payables` |
| Pay supplier | Purchase → Pay Supplier | `/payables/pay` |
| Financial statements | Finance → Financial Statements | `/financials` |
| Dashboard KPIs | Overview → Dashboard | `/dashboard` |

### Stock column on Products page

- **Quantity** = current stock (boxes/pieces/SFT from `stock` table).
- **Out of stock** count in summary cards = products with zero qty.
- Stock increases after **Purchase** is posted; decreases after **Sale** / returns.

---

## Infrastructure & deploy

| Task | Status |
|------|--------|
| VPS folder `/var/www/tilessaas` | ✅ |
| PM2 `tilessaas-api` port 3003 | ✅ |
| PostgreSQL `tileserp` port 5440 | ✅ |
| Nginx `app.sanitileserp.com` | ✅ |
| Deploy script `scripts/vps-deploy.sh` | ✅ |
| Supabase → VPS migration (auth/data flags) | 🟡 Ongoing |

**Deploy command:**
```bash
cd /var/www/tilessaas && git pull origin main && bash scripts/vps-deploy.sh
```

---

## Known gaps / technical debt

| Item | Priority |
|------|----------|
| Tier B period metrics (accounting-summary monthly due) still on sales headers | Low |
| P5 exit: accountant sign-off on VAT register export | Medium |
| `seedDemoAccounts.ts` (`plan` vs `plan_id`) | Low |
| 36 unit tests fail without VPS auth mocks | Low (CI/dev) |
| Historical COGS backfill (Phase 1B) | Decision pending |
| Portal still on Supabase for some flows | Medium |

---

## Recommended next work (priority order)

1. **Phase 3** — Remaining returns/inventory (P3-04 purchase return batch deduct, P3-08 stock display)  
2. **Phase 6** — GL spine + portal on VPS API  
3. **Ops** — P1 exit parity verify per dealer; P5 VAT register accountant sign-off  

---

## Document maintenance

When a phase ships to `main` and VPS:

1. Update status column in this file.  
2. Update `PHASED_IMPLEMENTATION_BACKLOG.md` if task IDs change.  
3. Add entry to `CHANGELOG.md`.  
4. Run deploy on VPS and note commit hash above.
