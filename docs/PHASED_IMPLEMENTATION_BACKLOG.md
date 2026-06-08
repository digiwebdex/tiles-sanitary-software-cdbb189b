# Phased Implementation Backlog

**Baseline:** `CURRENT_SYSTEM_AUDIT.md` + `RESTRUCTURE_BLUEPRINT.md`  
**Rule:** No big-bang rewrite — each phase shippable to production.

---

## Phase 0 — Consolidation (complete / in progress on main)

| ID | Task | Status | Files |
|----|------|--------|-------|
| P0-01 | Tile COGS unit fix (Phase 1A) | ✓ main | `cogsLine.ts`, `sales.ts` |
| P0-02 | Unified customer payment | ✓ main | `customerPayment.ts`, `collections.ts` |
| P0-03 | P&L returns use refund_amount | ✓ main | `financials.ts` |
| P0-04 | Supplier payment + purchase pay UI | ✓ main | `supplierPayment.ts`, `ViewPurchase.tsx` |
| P0-05 | sale_items.created_at migration | ✓ main | migration 052 |
| P0-06 | Rename Payments → Collections | ✓ main | `AppLayout.tsx` |
| P0-07 | Fix dashboard supplier payable | ✓ main | `dashboard.ts` |

**Exit criteria:** Fresh dealer can purchase → sell → collect → pay supplier without errors.

---

## Phase 1 — Report trust & sign unification (2–3 weeks)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| P1-01 | Fix financials AP formula | P0 | S |
| P1-02 | Fix/deprecate `/reports/customer-due` | P0 | S |
| P1-03 | Extend payments report to supplier payments | P1 | M |
| P1-04 | Bank account on customer collection + invoice pay | P1 | M |
| P1-05 | Supplier FIFO payment API | P1 | M |
| P1-06 | Extract `ReportQueryService` with shared balance helpers | P1 | M |
| P1-07 | Report parity test suite | P1 | M |
| P1-08 | Update `FINANCIAL_REPORTING.md` with canonical sources | P2 | S |

**Exit criteria:** Dashboard due = Collections = Due aging; AP consistent everywhere.

---

## Phase 2 — Posting engine MVP (4–6 weeks)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| P2-01 | Migration: `posting_batches`, `posting_lines` | P0 | M |
| P2-02 | `PostingOrchestrator` + dual-write | P0 | L |
| P2-03 | `StockPostingEngine` — purchase, sale | P0 | L |
| P2-04 | `LedgerPostingEngine` — merge payment libs | P0 | L |
| P2-05 | Route `purchases.ts` POST through orchestrator | P0 | M |
| P2-06 | Route `sales.ts` POST through orchestrator | P0 | L |
| P2-07 | Document status columns + backfill | P1 | M |
| P2-08 | Deprecate `PUT /sales/:id` → reverse + repost | P1 | L |
| P2-09 | Purchase reverse API | P1 | L |
| P2-10 | Server-side approval consume on post | P1 | M |

**Exit criteria:** New posts create posting_batch; legacy tables stay in sync; tests green.

---

## Phase 3 — Returns, warehouse, inventory truth (4–6 weeks)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| P3-01 | Sales return batch restoration UI + API | P0 | L |
| P3-02 | COGS reversal on sales return | P0 | M |
| P3-03 | Sync sale due/paid on return | P1 | M |
| P3-04 | Purchase return batch deduct | P1 | M |
| P3-05 | `stock_movements` table + engine writes | P1 | M |
| P3-06 | Warehouse transfer stock posting | P1 | L |
| P3-07 | `warehouse_stock` + default warehouse backfill | P2 | L |
| P3-08 | Migrate display/sample off `products.current_stock` | P2 | M |
| P3-09 | GRN document (optional) | P3 | L |

**Exit criteria:** Return restores shade/batch; warehouse transfer moves qty; stock movement report accurate.

---

## Phase 4 — Read models & report cutover (3–4 weeks)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| P4-01 | `mv_customer_outstanding`, `mv_supplier_payable` | P0 | M |
| P4-02 | Switch Tier A reports to read models | P0 | M |
| P4-03 | Inventory valuation uses WAC not cost_price | P1 | M |
| P4-04 | Report hub UX grouping + search | P2 | M |
| P4-05 | Drill-down posting trace UI | P2 | L |

**Exit criteria:** No report endpoint uses ad-hoc balance SQL.

---

## Phase 5 — VAT / Mushak readiness (4–6 weeks)

| ID | Task | Priority | Effort |
|----|------|----------|--------|
| P5-01 | BIN/TIN on dealers/customers/suppliers | P0 | S |
| P5-02 | Tax columns on sales/purchases | P0 | M |
| P5-03 | `tax_posting_lines` + engine hooks | P0 | L |
| P5-04 | Mushak 6.3 / 6.1 register reports | P1 | L |
| P5-05 | Tax invoice print template (Bangla) | P1 | M |
| P5-06 | bKash/Nagad payment mode on postings | P2 | M |

**Exit criteria:** Monthly VAT register exports from system; accountant sign-off.

---

## Phase 6 — GL & portal (future)

| ID | Task | Effort |
|----|------|--------|
| P6-01 | `gl_postings` spine | L |
| P6-02 | Financials from GL | L |
| P6-03 | Portal reads VPS API | XL |
| P6-04 | Portal payment requests | L |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Dual-write drift | Nightly parity job comparing ledger sums vs posting_lines |
| Breaking existing dealers | Feature flag; pilot on fresh dealers first |
| Scope creep (HRM in posting engine) | Keep payroll on separate posting domain until Phase 6 |
| Mushak spec changes | Tax layer isolated in `tax_posting_lines` |
| Performance | Materialized views + refresh on post |

---

## Team allocation suggestion

| Stream | Owner focus |
|--------|-------------|
| Engine | Backend senior — Phases 2–3 |
| Reports | Backend + frontend — Phases 1, 4 |
| UX/workflows | Frontend — document states, pay/collect flows |
| Compliance | Domain expert + backend — Phase 5 |
| QA | Golden path + parity tests each phase |

---

## Definition of done (whole program)

- [ ] One posting engine for stock and money
- [ ] Posted documents immutable; reverse only
- [ ] All balance reports match within ৳0.01
- [ ] Batch-aware returns for tiles
- [ ] Warehouse transfers move stock
- [ ] Approvals enforced server-side
- [ ] Mushak registers exportable
- [ ] `CURRENT_SYSTEM_AUDIT.md` gaps closed or marked wont-fix with reason

---

## Immediate next actions (this week)

1. Merge Phase 0 doc baseline (`CURRENT_SYSTEM_AUDIT.md` → `docs/`)
2. Fix `financials.ts` AP (Phase 1, 1 day)
3. Spec `PostingOrchestrator` interface (Phase 2 kickoff)
4. User acceptance: pay MIR CERAMICS bill via Purchase Details on deployed VPS
5. **Do not** start VAT columns before posting engine — order matters
