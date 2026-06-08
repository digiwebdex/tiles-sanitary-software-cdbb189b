# Database Refactor Plan

**Principles:** Additive migrations only; dual-write during transition; no destructive drops until Phase 5.

---

## Phase 0 — Already on main (baseline drift)

These exist or were fixed — do not re-build:

| Item | Status |
|------|--------|
| `purchases.paid_on_create`, `voucher_discount` | ✓ migration 050 |
| `sales.cogs`, `sales.cogs_method` | ✓ migration 051 |
| `sale_items.created_at` | ✓ migration 052 |
| Unified `recordCustomerPayment` | ✓ |
| `recordSupplierPayment` | ✓ Phase 1 workflow |

---

## Phase 1 — Document state & posting spine

### 1.1 Document state columns

```sql
-- Add to: purchases, sales, sales_returns, purchase_returns, expenses
ALTER TABLE ... ADD COLUMN IF NOT EXISTS
  document_status text NOT NULL DEFAULT 'posted',  -- draft|pending_approval|posted|reversed
  posting_batch_id uuid NULL,
  reverses_document_id uuid NULL,
  posted_at timestamptz NULL,
  posted_by uuid NULL;
```

Existing rows: backfill `document_status = 'posted'`, `posted_at = created_at`.

### 1.2 Posting tables (new)

```sql
CREATE TABLE posting_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('posted','reversed')),
  reverses_batch_id uuid REFERENCES posting_batches(id),
  idempotency_key text,
  posted_by uuid,
  posted_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE(dealer_id, idempotency_key)
);

CREATE TABLE posting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES posting_batches(id) ON DELETE CASCADE,
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  line_domain text NOT NULL, -- stock|customer|supplier|cash|bank|expense|tax
  line_type text NOT NULL,
  party_id uuid,
  product_id uuid,
  batch_id uuid,
  warehouse_id uuid,
  purchase_id uuid,
  sale_id uuid,
  qty_delta numeric(14,4),
  qty_unit text,
  amount numeric(14,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'BDT',
  entry_date date NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_posting_lines_dealer_domain ON posting_lines(dealer_id, line_domain, entry_date);
CREATE INDEX idx_posting_lines_party ON posting_lines(dealer_id, line_domain, party_id);
```

### 1.3 Stock movement normalization

```sql
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL,
  posting_line_id uuid REFERENCES posting_lines(id),
  product_id uuid NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  batch_id uuid REFERENCES product_batches(id),
  movement_type text NOT NULL,
  qty_delta numeric(14,4) NOT NULL,
  qty_unit text NOT NULL,
  unit_cost numeric(14,4),
  reference_type text,
  reference_id uuid,
  moved_at timestamptz NOT NULL DEFAULT now()
);
```

Keep `stock` as aggregate cache maintained by engine (same as today).

---

## Phase 2 — Balances & returns

### 2.1 Read models (materialized views)

```sql
CREATE MATERIALIZED VIEW mv_customer_outstanding AS
SELECT dealer_id, customer_id,
       compute_balance_from_posting_lines(...) AS outstanding,
       last_payment_date
FROM ...
-- Refresh: CONCURRENTLY after batch post or nightly

CREATE MATERIALIZED VIEW mv_supplier_payable AS ...
CREATE MATERIALIZED VIEW mv_purchase_payment_status AS ...
```

Alternative: regular views on `posting_lines` if volume low (fresh dealers OK).

### 2.2 Sales return batch restoration

```sql
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS
  restock_batch_id uuid REFERENCES product_batches(id),
  qty_sqft numeric(14,4),
  cogs_reversal numeric(14,2) DEFAULT 0;

CREATE TABLE sales_return_batches (
  id uuid PRIMARY KEY,
  sales_return_id uuid REFERENCES sales_returns(id),
  batch_id uuid NOT NULL,
  qty numeric(14,4) NOT NULL
);
```

### 2.3 Purchase header payment cache (optional sync)

```sql
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  due_amount numeric(14,2) NOT NULL DEFAULT 0;
-- Maintained by engine on each payment post (like sales)
```

---

## Phase 3 — Warehouse & multi-location stock

```sql
ALTER TABLE stock ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
-- Composite unique (dealer_id, warehouse_id, product_id) after backfill

ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS warehouse_id uuid;

CREATE TABLE warehouse_stock (
  dealer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  box_qty numeric(14,4) DEFAULT 0,
  piece_qty numeric(14,4) DEFAULT 0,
  total_pieces numeric(14,4) DEFAULT 0,
  PRIMARY KEY (dealer_id, warehouse_id, product_id)
);
```

Migrate default warehouse per dealer; backfill `warehouse_id` on existing stock.

---

## Phase 4 — VAT / Mushak (Bangladesh)

### 4.1 Party tax profile

```sql
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS bin text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tin text, tin_type text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bin text; -- rename/dual gstin
```

### 4.2 Document tax extension

```sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS
  is_tax_invoice boolean DEFAULT false,
  mushak_serial text,
  vatable_amount numeric(14,2) DEFAULT 0,
  vat_rate numeric(5,2) DEFAULT 0,
  vat_amount numeric(14,2) DEFAULT 0,
  sd_amount numeric(14,2) DEFAULT 0,
  fiscal_year text;

-- Mirror on purchases, sales_returns, purchase_returns
```

### 4.3 Tax register

```sql
CREATE TABLE tax_posting_lines (
  id uuid PRIMARY KEY,
  posting_line_id uuid REFERENCES posting_lines(id),
  dealer_id uuid NOT NULL,
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  mushak_form text, -- 6.1 | 6.3 | 6.4 | 6.6
  vatable_amount numeric(14,2),
  vat_amount numeric(14,2),
  sd_amount numeric(14,2),
  party_bin_tin text,
  invoice_serial text,
  tax_period date
);
```

---

## Phase 5 — GL spine (optional)

```sql
CREATE TABLE gl_accounts (...);
CREATE TABLE gl_postings (
  posting_line_id uuid PRIMARY KEY,
  account_code text,
  debit numeric(14,2),
  credit numeric(14,2)
);
```

Financial statements switch from sub-ledgers → `gl_postings` per `FINANCIAL_REPORTING.md` Phase 2 plan.

---

## Migration strategy

| Step | Action |
|------|--------|
| 1 | Add tables/columns (nullable, defaults) |
| 2 | Engine dual-writes legacy + posting_lines |
| 3 | Backfill posting_lines from historical ledgers (optional, fresh dealers skip) |
| 4 | Switch reports to read models |
| 5 | Deprecate raw ledger POST API for payments |
| 6 | Remove dual-write when parity tests pass |

---

## Index & performance

| Table | Index |
|-------|-------|
| posting_lines | (dealer_id, line_domain, entry_date) |
| posting_batches | (dealer_id, document_type, document_id) |
| stock_movements | (dealer_id, product_id, moved_at) |
| sales | (dealer_id, document_status, sale_date) |
| purchases | (dealer_id, document_status, purchase_date) |

Partition candidates (future): `audit_logs`, `stock_movements`, `posting_lines` by month.

---

## Rollback plan

Each migration has `down()` dropping new tables only — legacy tables untouched. Feature flag `USE_POSTING_ENGINE=false` reverts routes to legacy write path during pilot.

---

## Data integrity constraints

- `posting_batches.dealer_id` must match all child lines
- Sum of payment allocations ≤ document due at post time
- Stock movement qty sign matches posting line
- Reversal batch must reference valid original batch
- No UPDATE on posting_lines — append-only
