# TilesERP — Complete Task List & Status

> **Last updated:** 2026-06-11  
> **Production VPS:** `/var/www/tilessaas` · deploy after merge to `main`  
> **Domain:** https://app.sanitileserp.com  
> **Baseline docs:** `PHASED_IMPLEMENTATION_BACKLOG.md`, `RESTRUCTURE_BLUEPRINT.md`

**Legend:** ✅ Done · 🟡 Partial · ⬜ Not started · 🔮 Future / optional

---

## Summary

| Area | Status |
|------|--------|
| Phase 0 — Consolidation | ✅ Complete |
| Phase 1 — Report trust | 🟡 Mostly done (P1-03 supplier refunds in payments report) |
| Phase 2 — Posting engine MVP | ✅ Complete |
| Phase 3 — Returns & inventory truth | 🟡 Mostly done (P3-03 sale due/paid sync ✅) |
| Phase 4 — Read models & reports | 🟡 P4-01–05 partial; payables read model pending |
| Phase 5 — VAT / Mushak | ⬜ Not started |
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
| P1-04 | Bank account on customer collection + invoice pay | 🟡 | Partial in payment flows |
| P1-05 | Supplier FIFO payment API | ✅ | Payables / supplier payment page |
| P1-06 | Extract `ReportQueryService` | ✅ | `reportQueryService.ts` |
| P1-07 | Report parity test suite | ✅ | `reportParity.test.ts`, `readModelParity.test.ts` |
| P1-08 | Update `FINANCIAL_REPORTING.md` | 🟡 | Doc exists; may need Phase 4 refresh |

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
| P3-04 | Purchase return batch deduct | 🟡 | `purchaseReturnStock.ts` |
| P3-05 | `stock_movements` + engine writes | ✅ | Migration 060 |
| P3-06 | Warehouse transfer stock posting | ✅ | `warehouseTransferStock.ts` |
| P3-07 | `warehouse_stock` + backfill | ✅ | Migration 061 |
| P3-08 | Migrate off `products.current_stock` display | 🟡 | Products page uses `stock` table via stock-map |
| P3-09 | GRN document (optional) | ⬜ | Optional |

**Exit criteria:** Returns restore batch; warehouse moves qty — 🟡 Mostly met

---

## Phase 4 — Read models & report cutover

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P4-01 | `mv_customer_outstanding`, `mv_supplier_payable` | ✅ | Migration 062; wired in API |
| P4-02 | Switch Tier A reports to read models | 🟡 | + credit report, ledger due-balance; payables still purchase-header based |
| P4-03 | Inventory valuation uses WAC not `cost_price` | ✅ | Financials + dashboard |
| P4-04 | Report hub UX grouping + search | ✅ | Collapsible groups + hub search box (desktop + mobile) |
| P4-05 | Drill-down posting trace UI | ✅ | `/api/postings/trace`; Due Aging + Supplier Outstanding drill-down |

**Exit criteria:** No report endpoint uses ad-hoc balance SQL — ⬜ Not met

---

## Phase 5 — VAT / Mushak readiness (Bangladesh)

| ID | Task | Status |
|----|------|--------|
| P5-01 | BIN/TIN on dealers/customers/suppliers | ⬜ |
| P5-02 | Tax columns on sales/purchases | ⬜ |
| P5-03 | `tax_posting_lines` + engine hooks | ⬜ |
| P5-04 | Mushak 6.3 / 6.1 register reports | ⬜ |
| P5-05 | Tax invoice print template (Bangla) | ⬜ |
| P5-06 | bKash/Nagad payment mode on postings | ⬜ |

**Exit criteria:** Monthly VAT register export — ⬜

---

## Phase 6 — GL & portal (future)

| ID | Task | Status |
|----|------|--------|
| P6-01 | `gl_postings` spine | ⬜ |
| P6-02 | Financials from GL | ⬜ |
| P6-03 | Portal reads VPS API | ⬜ |
| P6-04 | Portal payment requests | ⬜ |

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
| Mushak registers exportable | ⬜ Phase 5 |
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
| Phase 4 P4-02 payables cutover | Medium |
| Phase 5 VAT/Mushak | High (when compliance needed) |
| `seedDemoAccounts.ts` (`plan` vs `plan_id`) | Low |
| 36 unit tests fail without VPS auth mocks | Low (CI/dev) |
| Historical COGS backfill (Phase 1B) | Decision pending |
| Portal still on Supabase for some flows | Medium |

---

## Recommended next work (priority order)

1. Finish **P4-02** cutover (payables outstanding route — purchase bills vs read model)  
3. **P1-04** — Bank account on all collection + invoice pay flows  
4. **P1-08** — Refresh `FINANCIAL_REPORTING.md`  
5. **Phase 5** — VAT/Mushak when accountant ready  
6. **Phase 6** — Portal on VPS API  

---

## Document maintenance

When a phase ships to `main` and VPS:

1. Update status column in this file.  
2. Update `PHASED_IMPLEMENTATION_BACKLOG.md` if task IDs change.  
3. Add entry to `CHANGELOG.md`.  
4. Run deploy on VPS and note commit hash above.
