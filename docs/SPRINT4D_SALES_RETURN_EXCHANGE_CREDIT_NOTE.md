# V2 Sprint 4D — Sales Return, Exchange, Credit Note & Refund (Completion Report)

**Branch:** `v2/sprint-4d-returns-exchange` (based on `v2/sprint-4c-invoice-challan-delivery-payments`, tip `649b503`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 2 through 4C (Product Master → Invoice/Challan/Delivery/Payments) are frozen — no file any of those sprints created or modified was touched in a way that changes its existing behavior. Sales, Inventory, and Customer were explicitly NOT redesigned; POS refactoring and the Supabase migration were explicitly excluded and untouched.

---

## 1. Inspection — what already existed vs. what's genuinely new

Git history on this branch already showed extensive prior Sales Return work ("Add sales returns module," "batch-aware returns, COGS reversal," "sales return wizard"), so this sprint began with a full inspection (two parallel research passes, backend + frontend) before any code was written.

| Sprint 4D requirement | What already existed | Verdict |
|---|---|---|
| **Sales Return** | `POST /api/returns/sales` (`backend/src/routes/returns.ts`) — fully atomic: row-locked state guard (rejects returns against a reversed/cancelled sale), cumulative qty/refund guards, LIFO batch-aware COGS reversal (`saleReturnStock.ts`), customer_ledger + cash_ledger posting, backorder cleanup, audit log. Frontend: a complete 4-step wizard (`SalesReturnWizard.tsx` — select sale → select item/qty → batch/shade → confirm). | ✅ Fully built |
| **Partial Return** | The wizard already supports returning less than the full sold quantity per line (box+piece split inputs for tiles), with cumulative-quantity guards preventing over-return across multiple return transactions. | ✅ Fully built |
| **Refund** | `refund_amount` and a `refund_mode` column existed, but `refund_mode` was **captured and never used** — every refund unconditionally posted to `cash_ledger`, and the field was never exposed in the UI at all. | 🆕 Genuine gap — wiring, not building from scratch |
| **Credit Note** | No concept existed anywhere (no table, no column, no UI). | 🆕 Genuinely new — modeled as `refund_mode='credit'` (see §2) |
| **Exchange** | No concept existed anywhere — no link from a return to a follow-up sale, no UI action. Return rows were clickable but only navigated to the *original* sale's invoice. | 🆕 Genuinely new — modeled as "linked Return + New Sale" exactly as instructed (see §2) |
| **Warranty** | `products.warranty` is a free-text field (e.g. "5 Years") set at product-creation time — no claims table, no expiry tracking, no claim states, no warranty-specific route anywhere in the codebase. | ⚠️ No workflow foundation exists — see §2 for what was (and wasn't) done |

**Critical finding that shaped the design:** the roadmap document's own risk callout for this module is "COGS/VAT reversal errors." COGS reversal was already correct (LIFO, batch-aware). **VAT reversal was not** — `insertTaxPostingLine()` (the Sprint 4C VAT-posting helper) silently no-ops on a non-positive `taxAmount`, so it cannot represent a reversal, and neither `returns.ts` nor the existing full Sale-reversal flow (`POST /api/sales/:id/reverse`) writes an offsetting entry to `tax_posting_lines`. This is a **pre-existing gap in already-frozen code**, not something introduced by this sprint, and fixing it would mean modifying a shared, frozen Sprint 4C utility outside this sprint's stated scope (which does not list VAT). It is deliberately **not fixed here** — documented as a known gap for a future dedicated Accounting/VAT sprint (the roadmap's own Phase 4 "Accounts + VAT-Mushak" is a later, separate phase from this one).

---

## 2. What Sprint 4D ADDED

### Database (migration `092_sales_return_exchange_credit_note.ts` — purely additive)

- **`sales_returns.refund_paid_account_id`** — lets a bank/cheque/card refund post to `bank_ledger` (with the correct account) instead of always `cash_ledger`, mirroring the existing `paid_account_id` pattern used for customer payments.
- **`sales_returns.exchange_sale_id`** — audit-only link from a return to the new replacement sale it was exchanged for. Carries no money-math weight itself.
- **New table `customer_credit_note_applications`** — mirrors Sprint 4C's own `customer_advance_applications` exactly (same shape, same purpose) but is a **separate** table, so this sprint never touches Sprint 4C's frozen `advancePaymentService.ts`.

### The core design decision: Credit Note and Exchange share one mechanism

A **Credit Note** is modeled as a Sales Return whose `refund_mode='credit'`: no cash/bank ledger entry is posted (returns.ts now branches on this), but the `customer_ledger` 'refund' row — which already inserts unconditionally, unchanged — **is** the credit. `customerStatements.ts`'s due-balance formula already treats any `'refund'` row as reducing due_balance regardless of mode, so the credit is correct the instant the return is recorded, **without touching that frozen file**. `creditNoteService.ts` (new) tracks how much of a customer's aggregate credit-note balance (sum of their credit-mode returns) has since been applied to an invoice.

An **Exchange** is modeled exactly as instructed — "linked Return + New Sale": the new sale is created via the **existing, unmodified** `POST /api/sales` (same prefill-into-the-form pattern Sprint 4C used for Sales-Order-to-Invoice), then `POST /api/returns/sales/:id/link-exchange` records the audit link and, in the same action, draws down the customer's available credit-note balance against the new sale — reusing the exact same `applyCreditNoteToSale()` function and table as the standalone Credit Note flow, so a return's value can never be spent twice (once via explicit "Apply Credit Note," once via "Exchange").

### Backend

| File | Change |
|---|---|
| `backend/src/services/creditNoteService.ts` | **New** — `getCreditNoteBalance`, `applyCreditNoteToSale`, and a pure `computeUnappliedCreditNoteBalance` helper (extracted for testability, mirrors Sprint 4C's `advancePaymentService.ts` pattern). |
| `backend/src/routes/returns.ts` | Extended `salesReturnSchema` with `refund_paid_account_id`; the refund-posting block now branches on `refund_mode` — `'credit'` skips cash/bank entirely, a bank-requiring mode posts to `bank_ledger`, everything else (cash or a mobile-wallet mode) posts to `cash_ledger` as before, now tagged with the actual mode. +3 new endpoints: `GET /credit-note-balance`, `POST /credit-note/apply`, `POST /sales/:id/link-exchange`. The `GET /sales/sale-items/:saleId` endpoint's existing product JSON now also includes `warranty` (one new key in an existing `json_build_object` — additive, no existing consumer affected). |

**Deliberately NOT touched:** the Sales Return creation transaction's own state guards, row locks, COGS reversal, backorder cleanup, and the unconditional `customer_ledger` insert — all untouched. `advancePaymentService.ts`, `sales.ts`'s creation/reversal logic, `availabilityService.ts`, `reservations.ts`, any Product Master/Inventory/Warehouse/Customer file, and `insertTaxPostingLine`/`tax_posting_lines` — none modified.

### Frontend

| File | Change |
|---|---|
| `src/modules/sales-returns/salesReturnSchema.ts`, `src/lib/validators.ts` | +`refund_mode`/`refund_paid_account_id` fields (additive, optional). |
| `src/services/salesReturnService.ts` | +`refund_paid_account_id` on `create()`; +3 new methods (`getCreditNoteBalance`, `applyCreditNote`, `linkExchange`). |
| `src/modules/sales-returns/SalesReturnWizard.tsx` | Step 4 ("Confirm") gained a Refund Settlement selector (reuses the existing `PAYMENT_MODES` list plus a "Credit Note" option) and a conditional bank-account picker, mirroring Sprint 4C's Advance Payment dialog pattern. Step 2 now shows the product's existing `warranty` text field as a read-only informational note when present. |
| `src/modules/sales-returns/SalesReturnList.tsx` | The row-actions dropdown's "View Details"/"Download PDF"/"Delete" items were (and remain) inert placeholders with no handlers; a new, fully-functional "Exchange for New Sale" item was added (with `stopPropagation` so it doesn't also trigger the row's own click-to-invoice navigation), swapping to "View Exchange Sale" once a return has already been linked. |
| `src/pages/sales/CreateSale.tsx` | Generalized the existing Quotation/Sales-Order prefill handling to also accept an Exchange-shaped prefill (`exchange_return_id` + `customer_name`); on success, calls `linkExchange()` and reports how much credit was applied. |
| `src/pages/sales/InvoicePage.tsx` | +"Apply Credit Note" quick action, shown only when the customer has an unapplied credit-note balance — same UI pattern as Sprint 4C's "Apply Advance" button, backed by the separate credit-note balance/table. |

---

## 3. Database Impact

**Purely additive.** 1 new table (`customer_credit_note_applications`), 2 new nullable columns on `sales_returns`. No existing table/column renamed, retyped, dropped, or given a new default. Every return, sale, or ledger entry created before this migration behaves identically.

## 4. API Impact

| Change | Compatibility |
|---|---|
| `POST /api/returns/sales` | Additive optional fields (`refund_mode` already existed as an accepted-but-unused field; `refund_paid_account_id` is new). Existing callers that omit both behave exactly as before — refunds still post to `cash_ledger` by default. |
| `GET /api/returns/credit-note-balance`, `POST /api/returns/credit-note/apply`, `POST /api/returns/sales/:id/link-exchange` | New; zero changes to any existing returns endpoint. |
| `GET /api/returns/sales/sale-items/:saleId` | +1 new key (`warranty`) in an existing JSON object — additive, does not change any existing key. |
| `POST /api/sales` (creation) | **Zero changes** — the Exchange flow calls this exact endpoint unmodified, exactly as Sprint 4C's Sales-Order-to-Invoice flow already does. |

## 5. Testing Results

- **Backend:** `npx tsc --noEmit` clean (only the same pre-existing Sprint 3B `warehouseTransferStock.test.ts` issue every prior sprint's report documents). `npx vitest run` — **230/230 pass** (13 new + 217 prior). New: `creditNoteService.test.ts` (4 — pure balance math), `returns.creditNoteExchange.test.ts` (9 — schema validation for the extended return payload, the new apply/link-exchange endpoints, and `.toSQL()` query-shape checks for the credit-note balance aggregates).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the same pre-existing `portalService.ts` issue). `npx vitest run` — **328/328 pass** (6 new + 322 prior). New: `salesReturnService.test.ts` (6 — this service had zero prior test coverage; covers refund-mode/bank-account pass-through and all three new Credit-Note/Exchange methods). `npm run build` succeeds cleanly (same pre-existing chunk-size warning as every prior sprint — not new).

## 6. Manual QA Checklist

- [ ] **Cash refund (unchanged behavior)** — create a return with refund_mode left as "Cash"; confirm it posts to `cash_ledger` exactly as before.
- [ ] **Bank refund** — create a return, choose "Bank Transfer," select a bank account; confirm the refund posts to `bank_ledger` against that account (not `cash_ledger`), and that submission is blocked if no account is chosen.
- [ ] **Credit Note** — create a return choosing "Credit Note (store credit, no cash out)"; confirm no `cash_ledger`/`bank_ledger` entry is created, but the customer's due balance still drops by the refund amount (via the existing, unconditional `customer_ledger` row).
- [ ] **Apply Credit Note** — on a different invoice for that same customer with a due balance, confirm an "Apply Credit Note" button appears capped at the smaller of the invoice's due amount and the available credit; apply it and confirm the invoice's due amount drops and the remaining credit-note balance decreases accordingly.
- [ ] **Exchange** — from the Sales Returns list, use "Exchange for New Sale" on a return; confirm the new Sale form opens prefilled with the customer, create a new-item sale; confirm the toast reports the credit applied, the new sale's due amount reflects it, and the return row now shows "View Exchange Sale" linking to it.
- [ ] **Partial return (regression)** — confirm returning less than the full sold quantity, and returning across two separate transactions up to the sold quantity, both still work exactly as before.
- [ ] **Broken return (regression)** — confirm a "Broken / damaged" return still skips stock restoration and COGS reversal exactly as before.
- [ ] **Warranty hint** — select a product with a warranty value set on its product record; confirm the informational note appears on the return wizard's item-selection step (and that it's read-only — no claim can be filed).
- [ ] Confirm existing Sales, Invoice, Challan, Delivery, and Collections workflows are unaffected.

## 7. Rollback Plan

1. **Not yet merged/deployed** — safe to discard the branch entirely if needed.
2. **After merge:** `git revert` the sprint commit — every change is additive; no existing route, component, or business rule (state guards, row locks, COGS reversal, backorder cleanup) was altered.
3. **DB rollback:** migration `092`'s `down()` cleanly drops `customer_credit_note_applications` and both new `sales_returns` columns, in FK-safe order — no data loss for any pre-existing return.
4. **Partial rollback:** the refund-mode selector, "Apply Credit Note" button, and "Exchange" action can each be hidden independently of the backend (which would simply go unused) without touching any other feature.

## 8. Explicitly out of scope (per Sprint 4D instructions — not done)

- Sales, Inventory, and Customer were not redesigned — only the pre-existing, narrowly-scoped Returns domain (`returns.ts`) was extended.
- POS refactoring and the Supabase migration — untouched.
- A full Warranty claims/expiry workflow — no foundation for one existed (only a free-text product field), so per the sprint's own conditional wording ("if existing foundation exists"), nothing beyond surfacing that existing field read-only was built.
- VAT reversal on a return — a real, pre-existing gap (flagged by the project roadmap itself as this module's top risk) that also affects the already-frozen full Sale-reversal flow; deliberately left for a dedicated future VAT/Accounting sprint rather than patched outside this sprint's stated scope.
