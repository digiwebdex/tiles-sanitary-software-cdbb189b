# Workflow State Diagrams

**Baseline:** `CURRENT_SYSTEM_AUDIT.md`  
Target document lifecycles for transaction-driven architecture.

---

## 1. Global document states

All financial/inventory documents share this base lifecycle:

```
                    ┌─────────┐
                    │  draft  │  editable, no stock/ledger effect
                    └────┬────┘
                         │ submit
                         ▼
              ┌──────────────────────┐
              │  pending_approval    │  optional; approval hash required
              └──────────┬───────────┘
                         │ approve / auto-approve
                         ▼
                    ┌─────────┐
         ┌─────────│ posted  │─────────┐
         │         └────┬────┘         │
         │ reverse      │              │ (terminal for ops)
         ▼              │ amend = reverse + new draft
    ┌─────────┐         │
    │ reversed│◄────────┘
    └─────────┘
```

**Rules:**
- `posted` → immutable header/lines
- `reversed` → creates inverse posting batch; links `reverses_document_id`
- Amend = new document referencing `amends_document_id`

---

## 2. Purchase workflow

### Current (main)

```mermaid
stateDiagram-v2
    [*] --> Draft: save draft
    Draft --> Posted: POST /purchases
    Posted --> PaidPartial: POST payment
    Posted --> PaidFull: paid_on_create or payments
    note right of Posted
        Stock IN
        Supplier ledger -payable
        Optional cash/bank OUT
    end note
```

**Gaps:** No GRN checkpoint, no reverse, edit menu was 404.

### Target

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pending_approval: submit (optional)
    pending_approval --> posted: approve + post
    draft --> posted: post (no approval)
    posted --> paid_partial: supplier payment
    paid_partial --> paid_full: supplier payment
    posted --> reversed: reverse document
    paid_partial --> reversed: reverse (refund if needed)
```

**Bangladesh flow option (Phase 3):**

```
PO draft → posted (order) → GRN posted (qty confirm) → Purchase invoice posted → Payment
```

For MVP: single `posted` purchase (current behavior) + payment states derived from ledger.

---

## 3. Sale / POS workflow

### Current

```mermaid
stateDiagram-v2
    [*] --> Posted: POST /sales
    Posted --> ChallanMode: challan_mode=true (no stock)
    Posted --> Invoiced: stock deducted
    Invoiced --> PartialPaid: payment
    Invoiced --> Paid: payment
    Invoiced --> Edited: PUT /sales (dangerous)
    Invoiced --> Cancelled: DELETE (guarded)
```

### Target

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> posted_invoice: post (stock out)
    draft --> posted_challan: post (reserve only)
    posted_challan --> delivered: delivery complete
    posted_challan --> converted_invoice: challan convert
    posted_invoice --> partial_paid
    partial_paid --> paid_full
    posted_invoice --> reversed: cancel via reversal doc
    posted_challan --> reversed: unreserve + reverse
```

**Payment states** (derived, not stored independently):
- `due_amount = net - allocated_payments` from posting lines

---

## 4. Sales return workflow

### Current

```
POST return → aggregate stock IN → customer refund ledger → optional cash OUT
(no batch restore, no COGS reversal)
```

### Target

```mermaid
flowchart TD
    A[Select posted sale] --> B[Select lines + qty]
    B --> C{is_broken?}
    C -->|No| D[Select batch/shade to restore]
    C -->|Yes| E[Write-off path / no restock]
    D --> F[Post return document]
    E --> F
    F --> G[StockPosting: batch IN]
    F --> H[LedgerPosting: customer credit]
    F --> I[LedgerPosting: cash refund optional]
    F --> J[COGS reversal posting Phase 2]
    F --> K[Update sale due/paid if linked]
```

---

## 5. Purchase return workflow

### Target

```mermaid
flowchart TD
    A[Select purchase] --> B[Lines + qty]
    B --> C[Post return]
    C --> D[Stock OUT batch-aware]
    C --> E[Supplier credit]
    C --> F[Cash IN or credit note]
```

---

## 6. Customer collection workflow

### Current (after Phase 1 fixes on main)

```mermaid
flowchart LR
    A[Collections UI] --> B[POST /collections/payment]
    C[Invoice UI] --> D[POST /sales/:id/payment]
    B --> E[recordCustomerPayment]
    D --> E
    E --> F[customer_ledger]
    E --> G[cash_ledger]
    E --> H[sales.paid/due update]
```

### Target

Same flow, routed through `LedgerPostingEngine.postCustomerReceipt()` with optional bank account and Mushak receipt note.

---

## 7. Supplier payment workflow

### Current (main after workflow restructure Phase 1)

```mermaid
flowchart LR
    A[Purchase Details] --> B[POST /purchases/:id/payment]
    C[Supplier Payables] --> B
    D[New Purchase Paid Now] --> E[POST /purchases]
    B --> F[recordSupplierPayment]
    E --> G[inline payment at create]
    F --> H[supplier_ledger + cash/bank]
```

### Target addition (Phase 2)

```mermaid
flowchart LR
    A[Pay supplier FIFO] --> B[POST /payables/payment]
    B --> C[Allocate oldest purchase dues]
    C --> D[LedgerPostingEngine]
```

---

## 8. Delivery & fulfillment

```mermaid
stateDiagram-v2
    [*] --> pending: sale item backorder
    pending --> partially_allocated: purchase stock in
    partially_allocated --> ready_for_delivery: fully allocated
    ready_for_delivery --> partially_delivered: delivery partial
    partially_delivered --> fulfilled: all qty delivered
    ready_for_delivery --> fulfilled: full delivery
```

**Note:** Delivery today updates `sale_items.fulfillment_status` only — stock already deducted on invoice post (non-challan). State diagram aligns ops visibility, not second stock hit.

---

## 9. Warehouse transfer

### Current

```
request → approved → received (metadata + transport cost to cash/bank)
NO stock movement between warehouses
```

### Target

```mermaid
stateDiagram-v2
    [*] --> requested
    requested --> approved
    requested --> rejected
    approved --> in_transit
    in_transit --> received
    received --> [*]
```

On `received`: `StockPostingEngine.transfer(from_wh, to_wh, batch, qty)`.

---

## 10. Expense workflow

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> posted
    posted --> reversed
```

Posted: `expense_ledger` + `cash_ledger` or `bank_ledger`.

---

## 11. Approval checkpoint map

| Document action | Approval type (existing) | Target enforcement |
|-----------------|-------------------------|-------------------|
| Sale with credit override | `credit_override` | Block post until consumed |
| Sale discount over limit | `discount_override` | Block post |
| Backorder sale | `backorder_sale` | Block post |
| Stock adjustment | `stock_adjustment` | Block post |
| Sale cancel | `sale_cancel` | Block reverse |
| Reservation release | `reservation_release` | Block release RPC |

**Target:** `ApprovalService.assertConsumed(type, hash, documentPayload)` inside `PostingOrchestrator` before post.

---

## 12. Audit trace (target)

Every `posted` transition creates:

| Field | Value |
|-------|-------|
| `posting_batch_id` | UUID linking all lines |
| `document_type` | purchase, sale, etc. |
| `document_id` | header id |
| `posted_by` | userId |
| `posted_at` | timestamp |
| `reverses_batch_id` | if reversal |

`audit_logs` references `posting_batch_id` for one-click trace UI.
