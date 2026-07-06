# Purchase Domain — Completion Report

**As of:** V2 Sprint 5E (Purchase Return, Supplier Debit Note, Landed Cost, Batch Cost Update, Import LC), commit range Sprint 5A (`2db48b3`) through Sprint 5E (this commit). This report confirms the Purchase domain is functionally complete and states what is frozen, what remains deferred, and readiness for a future Accounting (General Ledger) sprint.

---

## 1. Purchase Modules Completed

| Sprint | Module | Status |
|---|---|---|
| 5A | Supplier & Purchase Foundation — Supplier Category/Group/Credit Limit, Ledger Summary, Purchase Request (draft→approval workflow), RFQ (invite→quote→compare→approve) | ✅ Complete |
| 5B | Purchase Order — 8-status lifecycle, approval history, RFQ→PO conversion, Print/PDF/Email/WhatsApp | ✅ Complete |
| 5C | Goods Receipt (GRN) — quantity-only receiving into Warehouse/Godown/Rack/Batch, automatic PO status progression, stock/stock_ledger posting | ✅ Complete |
| 5D | Purchase Invoice — draft/finalize/cancel (reuses `purchases`/`purchase_items`), Supplier Payment (Record/Advance/Partial/Due), Supplier Ledger (Credit/Debit Note), Accounts Payable Aging | ✅ Complete |
| 5E | Purchase Return (List/Details/Create/Partial/Full/Return Note/Status), Supplier Debit Note (return-driven), Landed Cost allocation, Batch/Stock Cost Update, Import LC tracker | ✅ Complete |

End-to-end flow now supported: **Purchase Request → RFQ → Purchase Order → Goods Receipt → Purchase Invoice → Supplier Payment**, with **Purchase Return** and **Landed Cost** layered on top, and an **Import LC** paperwork tracker alongside for import-sourced purchases.

## 2. Purchase APIs — Frozen

The following route files are considered complete and frozen as of this report. Future sprints outside the Purchase domain must not modify them; any Purchase-domain enhancement must add new, additive endpoints in new files, following the precedent established across Sprints 5A–5E:

- `backend/src/routes/suppliers.ts`, `purchaseRequests.ts`, `rfq.ts` (Sprint 5A)
- `backend/src/routes/purchaseOrders.ts` (Sprint 5B)
- `backend/src/routes/goodsReceipts.ts` (Sprint 5C)
- `backend/src/routes/purchaseInvoices.ts`, `supplierLedgerEntries.ts`, `supplierAging.ts` (Sprint 5D)
- `backend/src/routes/purchaseReturns.ts`, `landedCostSheets.ts`, `stockCostAdjustments.ts`, `importLc.ts` (Sprint 5E)
- Pre-V2 legacy, kept working unmodified throughout: `backend/src/routes/purchases.ts` (quick-entry flow), `backend/src/routes/returns.ts` (legacy Purchase Return — its Sales Return portion is separately frozen under Sprint 4D), `backend/src/routes/payables.ts`, `backend/src/routes/ledger.ts`

Shared library functions confirmed stable and reused (not modified) across all five sprints: `backend/src/lib/ledgerBalance.ts`, `backend/src/lib/supplierPayment.ts`, `backend/src/lib/purchasePaymentSummary.ts`, `backend/src/lib/vatMath.ts`, `backend/src/services/taxPostingService.ts`, `backend/src/services/reportQueryService.ts`, `backend/src/services/receivingStockPosting.ts`, `backend/src/services/purchaseReturnStock.ts`.

## 3. Purchase Database Schema — Frozen

Migrations `093` through `097` constitute the complete V2 Purchase schema. All are additive; none altered a pre-existing column's meaning for existing rows:

- `093` — Supplier fields (category/group/credit_limit), Purchase Request, RFQ tables.
- `094` — `purchase_orders`/`purchase_order_items`/`purchase_order_approvals`.
- `095` — `goods_receipts`/`goods_receipt_items`.
- `096` — `purchases.document_status` widened (+`cancelled`), `ledger_entry_type` (+`credit_note`/`debit_note`), `purchase_items.source_goods_receipt_item_id`.
- `097` — `purchase_return_items` (+ source/location linkage), `ledger_entry_type` (+`purchase_return`), `supplier_ledger.purchase_return_id`, `landed_cost_sheets`/`landed_cost_sheet_items`, `stock_cost_adjustments`, `import_proforma_invoices`/`import_letters_of_credit`/`import_shipments`/`import_shipment_containers`.

Pre-V2 tables reused as-is throughout, no schema change beyond the additive widenings above: `purchases`, `purchase_items`, `suppliers`, `purchase_returns`, `purchase_return_items`, `supplier_ledger`.

## 4. Supplier Module — Frozen

`suppliers` table and `backend/src/routes/suppliers.ts` are complete: Category, Group, Credit Limit, opening balance, Ledger Summary (`getLedgerSummary()`), Statement, Aging, Advance Payment, Credit Note, Debit Note, Purchase-Return-driven balance reduction. No further schema or endpoint additions are anticipated for the Supplier module itself — future Accounting work should read from `supplier_ledger`/`mv_supplier_payable`, not add new supplier-side write paths.

## 5. Purchase–Inventory Integration — Frozen

Documented in full in `docs/PURCHASE_INVENTORY_INTEGRATION.md` (Sprint 5C) and extended by Sprint 5E:

- Goods Receipt is the **only** path that adds stock/batch/warehouse-tier quantity for the new pipeline (`receivingStockPosting.ts`).
- Purchase Return (`returnStockPosting.ts`, Sprint 5E) is the **only** path that removes it for a completed return, reusing the exact same qty-base conventions.
- Weighted-average-cost formula is single-sourced across `purchases.ts` (legacy), `receivingStockPosting.ts` (GRN), and now `landedCostSheets.ts` (post-hoc landed cost adjustment) — all three apply the identical `(currentQtyBase × currentAvg + delta) / newQtyBase` arithmetic (or its cost-only variant for landed cost, where quantity doesn't change).
- `product_batches` has no cost column — Inventory Intelligence and Sales COGS both read `stock.average_cost_per_unit` exclusively. This is now the single, confirmed source of truth for unit cost across the entire Purchase and Inventory domains.
- Inventory Intelligence / Availability Engine require **zero additional wiring** for any Purchase-domain change — both read live, uncached, off `stock`/`product_batches`/`warehouse_stock`/`godown_stock`/`rack_stock`.

## 6. Purchase–VAT Integration — Frozen

VAT is computed exactly once per Purchase Invoice, at finalize time, via `computeVatBreakdown`/`loadDealerVatSettings`/`insertTaxPostingLine` (all reused unmodified from the pre-existing VAT engine across Sprints 5D and 5E). Landed Cost's "VAT" charge field (Sprint 5E) is a distinct concept — import-stage duty paid at customs, entered as a flat manual amount — and does **not** flow through `computeVatBreakdown`; the two are intentionally separate and must not be conflated by a future sprint.

## 7. Remaining Deferred Items

Explicitly out of scope across Sprints 5A–5E, confirmed still not built:

- **General Ledger, Journal Entries, Trial Balance, Balance Sheet, Profit & Loss, Bank Reconciliation** — no double-entry ledger exists anywhere in this codebase; `supplier_ledger`/`cash_ledger`/`bank_ledger` are single-entry, party-specific ledgers only.
- **Multi-currency** — every amount in the Purchase domain, including Import LC, is BDT-only. Import LC's `currency_note` fields are free-text context only, no FX conversion.
- **True per-batch cost tracking** — cost lives only at the dealer-wide `stock.average_cost_per_unit` level; "Batch Cost Update" (Sprint 5E) is a product-level adjustment, not a per-batch override.
- **Reversal of a posted/finalized Purchase Invoice or completed Goods Receipt** — only draft-stage cancel exists; a true reversal would need Purchase-Return-style unwinding, not yet built for Invoices/GRNs themselves (Purchase Return itself now covers the "goods went back" case).
- **Import LC ↔ Purchase pipeline automation** — a Shipment may reference a `purchases` row for cross-reference, but no stock/financial posting is triggered by that link.
- **Manufacturing** — not part of this ERP's scope as defined across any Purchase sprint.

## 8. Readiness for Accounting

The Purchase domain is ready to serve as an input to a future Accounting (General Ledger) sprint:

- Every financially-significant Purchase event (Invoice finalize, Payment, Advance Payment, Credit Note, Debit Note, Purchase Return completion, Landed Cost application) already writes to a single-entry ledger table (`supplier_ledger`, `cash_ledger`/`bank_ledger`, `stock_cost_adjustments`) with a stable `type`/`entry_date`/`amount` shape and a traceable reference back to its source document.
- `taxPostingService.ts`'s posting-line abstraction (`insertTaxPostingLine`) already exists as the seam where a future GL sprint would hook in a real double-entry line, without needing to touch any Purchase-domain route file.
- No Purchase-domain table or endpoint needs to change shape to support a GL layer — a future Accounting sprint should be additive (new `journal_entries`/`gl_lines` tables, a new posting service reading from the existing ledger tables), exactly matching the discipline already established across Sprints 5A–5E.
