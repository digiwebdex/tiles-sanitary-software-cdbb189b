# Smooth Operations Guide — Fresh Dealer Go-Live

This guide applies when starting with **no historical data** (empty ERP). All conventions below are enforced from the first transaction.

---

## Daily workflow (recommended order)

### 1. Setup (one time)
1. Add **products** with correct `per_box_sft` for every tile SKU.
2. Add **suppliers** and **customers**.
3. Set **pricing tiers** (optional) before first sale.

### 2. Purchase → Stock
```
Supplier → New Purchase → Stock increases + Supplier due recorded
```
- Purchase is **atomic** (all-or-nothing).
- Batch/shade/lot tracked automatically.
- Optional payment at purchase time reduces supplier due.

### 3. Sale → Invoice → Due
```
Customer → New Sale / POS → Stock decreases (FIFO) + Customer due recorded
```
- Tile COGS calculated correctly: `boxes × sft/box × ৳/sft`.
- Optional payment at sale time reduces invoice due.

### 4. Collect payment from customer (two equivalent paths)
Both paths use the **same backend logic**, support **Cash or Bank**, and update invoice `due_amount`:

| Where | When to use |
|-------|-------------|
| **Invoice page → Payment** | Customer paying against a specific invoice |
| **Collections → Record Payment** | Customer paying without specifying invoice; auto-applies to **oldest due invoices first** |

Choose **Received Into → Cash in Hand** or a **Bank account** in the payment dialog.

### 4b. Pay supplier (purchase bills)

| Where | When to use |
|-------|-------------|
| **New Purchase → Paid Now** | Pay (full or partial) when saving the purchase |
| **Purchase Details → Record Payment** | Pay a specific bill after it is saved |
| **Supplier Payables → Pay Supplier** | Pay a supplier in one click; applies to **oldest unpaid bills first** (FIFO) |

Choose **Pay From → Cash in Hand** or a **Bank account** in the payment dialog.

**Note:** Sidebar **Collections** = customer money in. **Supplier Payables** = money out to suppliers.

### 5. Sales return
```
Sales Return → Stock restored (aggregate) + Customer due reduced + Cash refund (if any)
```
- Invoice `due_amount` / `paid_amount` syncs with refund.

### 6. Reports
- **Customer due:** Collections, Due Aging, Customer Due report — use shared balance helpers (`ReportQueryService`).
- **Supplier payable:** Dashboard, Balance Sheet AP, Supplier Payable / Outstanding — **same formula** (`sumSupplierPayable`).
- **Payments report:** Customer receipts **and** supplier payments in one list (money in / money out).
- **P&L:** Uses `sales.cogs` (correct for new sales after Phase 1A).

---

## Ledger sign convention (fresh data)

| Ledger | Entry type | Amount stored | Balance effect |
|--------|-----------|---------------|----------------|
| Customer | sale | positive | increases due |
| Customer | payment | **positive** | decreases due |
| Customer | refund | **positive** | decreases due |
| Supplier | purchase | negative | increases payable |
| Supplier | payment | positive | decreases payable |
| Supplier | refund | positive | decreases payable |

---

## What still needs manual care

1. **Sales returns** restore aggregate stock only (not batch/shade) — verify batch reports after large returns.
2. **Purchase edit/delete** not available — void via purchase return + adjustment if entry was wrong.
3. **Expenses** post to cash only — use bank account entry separately if paid from bank.
4. **Challan mode** sales defer stock until delivery is completed.

---

## Pre go-live checklist

- [ ] Run migration `051_sales_cogs_method` on production DB
- [ ] Verify every tile product has `per_box_sft > 0`
- [ ] Test: Purchase 10 boxes → Sale 2 boxes → Collect payment (cash or bank) → Check due = 0 on invoice
- [ ] Test: Pay supplier via Supplier Payables → Pay Supplier (FIFO)
- [ ] Test: Reports → Payments shows customer receipt and supplier payment rows
- [ ] Test: Sales return with refund → invoice due decreases
- [ ] Open P&L — should show no legacy COGS warnings (fresh data)

---

## API endpoints (unified payment)

| Action | Endpoint |
|--------|----------|
| Pay specific invoice | `POST /api/sales/:id/payment` — body: `{ amount, note?, paid_account_id? }` |
| Pay customer (FIFO across invoices) | `POST /api/collections/payment` — body: `{ customer_id, amount, note?, paid_account_id? }` |
| Pay specific purchase bill | `POST /api/purchases/:id/payment` — body: `{ amount, note?, paid_account_id? }` |
| Pay supplier (FIFO across bills) | `POST /api/payables/payment` — body: `{ supplier_id, amount, note?, paid_account_id? }` |

All return `{ allocations[], totalApplied }` showing which invoices or purchase bills were updated.

`paid_account_id` = bank account UUID, or omit/null for **Cash in Hand**.
