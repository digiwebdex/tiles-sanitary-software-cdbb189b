# ERP Workflow Restructure Plan — Smooth Operations

**Date:** 2026-06-08  
**Status:** Phase 1 (P0) implemented in `cursor/workflow-restructure-3124`

---

## Problem summary

Users expected **Payments** menu to pay suppliers after a purchase. That menu only handles **customer collections** (money in). Supplier bills live under **Purchases**, but payment UI was missing or broken.

---

## Money flow map (correct mental model)

```
                    ┌─────────────────────────────────────┐
                    │           YOUR BUSINESS             │
                    └─────────────────────────────────────┘
         MONEY OUT (payables)              MONEY IN (receivables)
    ┌──────────────────────────┐    ┌──────────────────────────┐
    │ Supplier → Purchase      │    │ Customer → Sale / POS    │
    │   ↓ stock ↑              │    │   ↓ stock ↓              │
    │ Supplier ledger (owe)    │    │ Customer ledger (due)    │
    │ Pay supplier:            │    │ Collect payment:         │
    │  • Paid Now on purchase  │    │  • Invoice → Payment     │
    │  • Purchase → Pay        │    │  • Collections menu      │
    │  • Supplier Payables     │    │                          │
    └──────────────────────────┘    └──────────────────────────┘
```

---

## Standard daily workflow (after restructure)

| Step | Action | Menu | Result |
|:--:|--------|------|--------|
| 1 | Add products (SFT/box for tiles) | Products | Ready to buy/sell |
| 2 | Add suppliers & customers | Suppliers, Customers | Master data |
| 3 | **Record purchase** | Purchases → Add Purchase | Stock ↑, supplier due ↑ |
| 3b | **Pay at purchase** (optional) | Same form → Paid Now | Supplier due ↓, cash/bank ↓ |
| 4 | **Sell** | Sales / POS | Stock ↓, customer due ↑ |
| 5 | **Collect from customer** | Collections **or** Invoice → Payment | Customer due ↓, cash ↑ |
| 6 | **Pay supplier** (if not paid at step 3) | Supplier Payables **or** Purchase Details → Record Payment | Supplier due ↓, cash/bank ↓ |
| 7 | Reconcile | Cashbook, Ledger, Reports | Audit trail |

---

## Bugs found (audit)

### P0 — Blocked smooth operations (fixed in Phase 1)

| Bug | Symptom | Root cause |
|-----|---------|------------|
| Paid Now ignored | Purchase saved fully unpaid | `CreatePurchase.tsx` did not send `paid_on_create` |
| Paid always 0 in list | Purchases list shows Pending | `PurchaseList.tsx` hardcoded `paid = 0` |
| No pay button works | Add Payment → empty details page | `ViewPurchase.tsx` had no payment UI; no API |
| Wrong menu expectation | Payments menu has no supplier bills | Sidebar label "Payments" → `/collections` (customers only) |

### P1 — UX confusion (partially fixed)

| Bug | Fix |
|-----|-----|
| Sidebar "Payments" misleading | Renamed to **Collections** |
| No supplier payables hub | Added **Supplier Payables** (`/payables`) |
| Dashboard supplier payable wrong | Fixed to use `computeSupplierBalance()` |
| Edit Purchase → 404 | Removed broken menu item |
| Ledger `?supplier=` links ignored | Deferred to Phase 2 |

### P2 — Parity gaps (planned)

| Gap | Plan |
|-----|------|
| Customer pay always posts to cash | Add bank account on Collections + Invoice |
| No FIFO pay across supplier bills | Add `POST /api/supplier-payments` (supplier-level) |
| Payments report customer-only | Include supplier_ledger payments |
| customer-due report API wrong math | Fix or remove unused endpoint |

---

## Phase 1 implementation (done)

### Backend
- `backend/src/lib/purchasePaymentSummary.ts` — paid/due/status from supplier_ledger
- `backend/src/lib/supplierPayment.ts` — `recordSupplierPayment()` (ledger + cash/bank)
- `POST /api/purchases/:id/payment` — pay a specific purchase bill
- Purchase list + detail enriched with `paid_amount`, `due_amount`, `payment_status`
- Dashboard supplier payable formula fixed

### Frontend
- `CreatePurchase.tsx` — sends voucher discount + paid now + bank account
- `PurchaseList.tsx` — real paid/balance/status; Record Payment action
- `ViewPurchase.tsx` — payment summary, history, Record Payment dialog
- `SupplierPayablesPage.tsx` — unpaid bills hub at `/payables`
- Sidebar: **Collections** + **Supplier Payables**

---

## Phase 2 plan (next)

1. **Supplier-level payment** (like Collections FIFO for customers)
   - `POST /api/payables/payment` — pay MIR CERAMICS without picking invoice; allocate oldest purchase due first
2. **Ledger deep links** — honor `?tab=supplier&supplier=` and `?customer=`
3. **Header quick actions** — "Payment" dropdown: Collect from Customer | Pay Supplier
4. **Staff training sheet** — add supplier payment section (Bangla + English)

---

## Phase 3 plan (polish)

1. Bank account on customer Collections + Invoice payment
2. Unified **Payments report** (customer receipts + supplier payments)
3. WhatsApp receipt for supplier payment (optional)
4. Purchase PDF with paid/due footer

---

## Menu structure (target)

| Label | Route | Purpose |
|-------|-------|---------|
| Purchases | `/purchases` | All purchase bills |
| Supplier Payables | `/payables` | Unpaid bills only — pay here |
| Collections | `/collections` | Customer dues — collect here |
| Ledger | `/ledger` | Full audit (customer, supplier, cash, expense) |
| Cashbook | `/cashbook` | All cash + bank movements |

---

## How to pay MIR CERAMICS (৳ 28,800) today

**Option A — From purchase bill**
1. Purchases → click **PUR-20260608-0001**
2. Click **Record Payment**
3. Enter amount (full or partial) → Cash or Bank → Confirm

**Option B — From payables hub**
1. Sidebar → **Supplier Payables**
2. Find MIR CERAMICS row → **Pay**

**Option C — At next purchase**
1. Purchases → Add Purchase
2. Fill items → **Paid Now** = amount → **Payment From** = Cash/Bank
3. Submit (paid on create)

---

## VPS deploy after merge

```bash
cd /var/www/tilessaas
git pull origin main
bash scripts/vps-deploy.sh
```

Then hard refresh browser (`Ctrl+Shift+R`).

---

## Test checklist

- [ ] New purchase with Paid Now ৳10,000 → list shows Partial, due reduced
- [ ] Purchase Details → Record Payment → balance 0 → status Paid
- [ ] Supplier Payables list updates after payment
- [ ] Cashbook shows supplier payment outflow
- [ ] Ledger → Supplier shows purchase + payment rows
- [ ] Collections still works for customer payment (unchanged)
