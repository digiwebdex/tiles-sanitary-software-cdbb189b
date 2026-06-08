# Posting Rules Matrix

**Convention (fresh data — enforce everywhere):**

| Ledger | Type | Stored amount | Balance effect (party owes / we owe) |
|--------|------|---------------|----------------------------------------|
| Customer | sale | + magnitude | customer owes us more |
| Customer | payment | + magnitude | customer owes us less |
| Customer | refund | + magnitude | customer owes us less |
| Supplier | purchase | − magnitude (or + with engine normalizer) | we owe supplier more |
| Supplier | payment | + magnitude | we owe supplier less |
| Supplier | refund/credit | + magnitude | we owe supplier less |
| Cash | receipt | + | cash in |
| Cash | payment/expense/refund-out | − | cash out |
| Bank | same as cash | signed by direction | bank balance |

**Engine rule:** store **signed amounts** in `posting_lines.amount` with `account_code` + `direction`; sub-ledger tables become projections or legacy compat views during migration.

---

## 1. Stock posting events

| Event | Product qty | Batch qty | WAC/cost | Warehouse dim | Source route today |
|-------|-------------|-----------|----------|---------------|-------------------|
| `purchase.posted` | +qty | +batch | recalc WAC | default WH | `purchases.ts` |
| `sale.posted` | −qty | −FIFO batch | COGS snap | default WH | `sales.ts` |
| `sale.challan_reserve` | 0 net; reserve++ | reserve batch | — | WH | `challans.ts` |
| `challan.convert` | −from reserved | deduct reserved | COGS | WH | `challans.ts` |
| `sales_return.posted` (good) | +qty | +target batch | — | WH | **NEW** `returns.ts` |
| `sales_return.posted` (broken) | 0 | 0 | write-off exp | — | `returns.ts` |
| `purchase_return.posted` | −qty | −batch FIFO | — | WH | `returns.ts` |
| `adjustment.add` | +qty | optional | — | WH | `adjustments.ts` |
| `adjustment.deduct` | −qty | optional | — | WH | `adjustments.ts` |
| `warehouse_transfer.received` | WH A −, WH B + | batch move | — | A→B | **NEW** |
| `reservation.create` | reserve | batch reserve | — | WH | RPC |
| `reservation.consume` | −qty (on sale) | — | — | WH | RPC |

**Tile unit rule:** canonical qty in **SFT** for `box_sft`; display box + SFT; COGS = `sft × avg_cost_per_sft`.

---

## 2. Ledger posting events

### Purchase posted

| Account | Type | Amount | Notes |
|---------|------|--------|-------|
| supplier_ledger | purchase | −net_payable | we owe |
| supplier_ledger | payment | +paid_on_create | if any |
| cash_ledger or bank_ledger | payment | −paid_on_create | outflow |

**net_payable** = items total − voucher_discount.

### Purchase payment (later)

| Account | Amount |
|---------|--------|
| supplier_ledger payment | +amount |
| cash/bank | −amount |

### Sale posted (invoice mode)

| Account | Amount |
|---------|--------|
| customer_ledger sale | +bill_amount |
| customer_ledger payment | +paid_at_sale |
| cash_ledger receipt | +paid_at_sale |
| (header) sales.cogs | COGS snap |

### Customer collection / invoice payment

| Account | Amount |
|---------|--------|
| customer_ledger payment | +applied |
| cash_ledger receipt | +applied |
| sales.paid_amount / due_amount | update per allocation |

**Engine:** single `postCustomerReceipt()` — already in `customerPayment.ts`; migrate into engine.

### Sales return posted

| Account | Amount | Gap today |
|---------|--------|-----------|
| customer_ledger refund | +refund | OK |
| cash_ledger refund | −refund | OK |
| COGS reversal | −cogs | **MISSING** |
| sales due/paid | adjust | **MISSING** |

### Purchase return posted

| Account | Amount |
|---------|--------|
| supplier_ledger refund | +total |
| cash_ledger refund | +total (cash only today) |

### Expense posted

| Account | Amount |
|---------|--------|
| expense_ledger | −amount |
| cash_ledger | −amount |

### Warehouse transport

| Account | Amount |
|---------|--------|
| cash/bank | −transport_cost |

---

## 3. Known inconsistencies → engine fix

| Issue | Location | Engine rule |
|-------|----------|-------------|
| Challan convert payment negative | `challans.ts` | Always +magnitude payment type |
| Collections used wrong sign | fixed on main | Enforce in engine |
| customer-due report sign math | `reports.ts` | Reports read engine balance only |
| Financials AP raw SUM | `financials.ts` | `computeSupplierBalance()` |
| Dashboard AP | fixed on main | Same helper |
| Manual ledger POST | `ledger.ts` | Disable for payment types; admin journal only |

---

## 4. Posting batch structure (target table)

```sql
posting_batches (
  id, dealer_id, document_type, document_id,
  event_type, -- posted | reversed
  reverses_batch_id,
  posted_by, posted_at, notes
)

posting_lines (
  id, batch_id, dealer_id,
  line_type, -- stock | customer_ledger | supplier_ledger | cash | bank | expense | tax
  account_ref, -- party id or account id
  product_id, batch_id, warehouse_id, -- nullable
  qty_delta, qty_unit, -- for stock lines
  amount, currency,
  metadata jsonb
)
```

During migration: engine writes **both** legacy tables and `posting_lines` (dual-write), then reports switch.

---

## 5. COGS posting rules (tiles)

| Product type | effectiveQty | avgCost unit | COGS formula |
|--------------|--------------|--------------|--------------|
| box_sft | boxes × per_box_sft | ৳/SFT | effectiveSft × avgCostPerSft |
| piece | pieces | ৳/piece | pieces × avgCostPerPiece |

Store on `sales.cogs` at post time; `sales.cogs_method = post_fix | legacy_pre_fix`.

**Return reversal (Phase 2):** post `cogs_reversal` line = −original line COGS pro-rata.

---

## 6. VAT / Mushak posting (Phase 4 — design)

| Event | tax_line fields |
|-------|-----------------|
| sale.posted | vatable_amount, vat_rate, vat_amount, mushak_type=6.3 |
| purchase.posted | input_vat, mushak_type=6.1 |
| sales_return | output_vat adjustment |
| purchase_return | input_vat adjustment |

Export registers read `tax_posting_lines` grouped by fiscal period — not recomputed from headers.

---

## 7. Payment allocation rules

| Payer/Payee | Allocation strategy | API |
|-------------|---------------------|-----|
| Customer → invoices | FIFO by sale_date | `/collections/payment` |
| Customer → one invoice | Full/partial cap at due | `/sales/:id/payment` |
| Supplier → purchase bills | Per-bill cap at due | `/purchases/:id/payment` ✓ |
| Supplier → supplier account | FIFO by purchase_date | **Phase 2** `/payables/payment` |

---

## 8. Reversal rules

| Original event | Reversal behavior |
|----------------|-------------------|
| purchase.posted | Inverse stock IN; inverse supplier purchase; if paid, warn/refund |
| sale.posted | Restore stock/batches; inverse customer sale; inverse payments |
| payment posted | Inverse payment lines only |
| return posted | Inverse return (rare; prefer correcting return doc) |

Reversal always new batch with `reverses_batch_id` — never DELETE rows.

---

## 9. Implementation checklist for engine MVP

- [ ] `PostingOrchestrator.post(documentType, payload)`
- [ ] Idempotency key per document post
- [ ] Transaction wrapper (existing Knex pattern)
- [ ] Dual-write to legacy ledgers + `posting_lines`
- [ ] Unit tests per row in this matrix (minimum 20 cases)
- [ ] Sign convention doc enforced by linter/test on report SQL
