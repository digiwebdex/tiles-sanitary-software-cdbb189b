# Domain Service Map — Current vs Target

**Baseline:** `CURRENT_SYSTEM_AUDIT.md`  
Maps existing modules to target transaction-driven services.

Legend: 🟢 keep thin | 🟡 refactor | 🔴 replace / merge into engine

---

## 1. Platform layer (unchanged)

| Domain | Current | Target service | Action |
|--------|---------|----------------|--------|
| Auth | `authService`, `/api/auth` | `AuthService` | 🟢 |
| Tenancy | `tenantGuard`, `dealer_id` | `TenantContext` | 🟢 |
| RBAC | `requireRole`, `user_roles` | `AuthorizationService` | 🟢 |
| Audit | `audit_logs`, `auditLogs.ts` | `AuditService` (append-only) | 🟡 link to `posting_batch_id` |
| Approvals | `approvals.ts`, RPCs | `ApprovalService` | 🟡 enforce server-side on post |

---

## 2. Master data (unchanged structure)

| Domain | Routes | Target | Action |
|--------|--------|--------|--------|
| Products | `products.ts` | `ProductCatalogService` | 🟢 add `stock_base_unit`, tax category |
| Customers | `customers.ts` | `CustomerMasterService` | 🟡 add TIN, credit profile |
| Suppliers | `suppliers.ts` | `SupplierMasterService` | 🟡 add BIN, payment terms |
| Warehouses | `warehouses.ts` | `WarehouseMasterService` | 🟢 |
| Pricing tiers | `pricingTiers.ts` | `PricingService` | 🟢 |
| Branches | `branches.ts` | `BranchService` | 🟢 |

---

## 3. Inventory domain

| Domain | Current files | Target service | Issues today | Refactor |
|--------|---------------|----------------|--------------|----------|
| **Stock read** | `stock.ts` | `StockQueryService` | Read-only OK | 🟢 |
| **Stock write** | scattered in 8+ routes | **`StockPostingEngine`** | Multiple mutation paths | 🔴 **P0** |
| Batches | `batches.ts`, RPCs | `BatchAllocationService` | Used on sale/purchase | 🟡 wrap in engine |
| Adjustments | `adjustments.ts` | `StockAdjustmentDocument` | Bypasses unified audit | 🟡 post via engine |
| Reservations | `reservations.ts` | `ReservationService` | RPC-based | 🟡 |
| Display stock | `displayStock.ts` | merge or isolate | Uses `products.current_stock` | 🔴 P2 |
| Sample issues | `sampleIssues.ts` | merge or isolate | Same parallel stock | 🔴 P2 |
| Warehouse transfer | `warehouses.ts` | `WarehouseTransferDocument` | No qty movement | 🔴 P1 |

**Target stock tables:** `stock_movements`, `batch_movements`, aggregate `stock` (derived/cache).

---

## 4. Procurement domain

| Domain | Current | Target | Issues | Refactor |
|--------|---------|--------|--------|----------|
| Purchase | `purchases.ts` | `PurchaseDocumentService` | No edit/reverse; payment now on main | 🟡 P0 |
| Purchase return | `returns.ts` | `PurchaseReturnDocument` | No batch deduct | 🟡 P1 |
| Supplier payment | `supplierPayment.ts` | `SupplierPaymentService` | Per-bill only; no FIFO | 🟡 P1 |
| Auto-PO | `autoPo.ts` | `PurchaseDraftService` | Draft only | 🟢 |
| GRN (future) | — | `GrnDocument` | Missing | Phase 3 |

---

## 5. Sales domain

| Domain | Current | Target | Issues | Refactor |
|--------|---------|--------|--------|----------|
| Sale / POS | `sales.ts` | `SaleDocumentService` | PUT replaces ledger; COGS on header | 🟡 P0 |
| Quotation | `quotations.ts` | `QuotationDocument` | No stock | 🟢 |
| Challan | `challans.ts` | `ChallanDocument` | Negative payment sign on convert | 🟡 P1 |
| Delivery | `deliveries.ts` | `DeliveryDocument` | Status only | 🟡 P1 |
| Sales return | `returns.ts` | `SalesReturnDocument` | No batch restore, no COGS reversal | 🔴 P0 |
| Collection | `collections.ts` | `CustomerCollectionService` | Uses unified payment lib ✓ | 🟢 |
| Customer payment | `customerPayment.ts` | part of `LedgerPostingEngine` | Cash only | 🟡 P2 bank |
| Backorder | `purchases.ts`, `backorders.ts` | `BackorderAllocationService` | FIFO on purchase | 🟢 |

---

## 6. Finance domain

| Domain | Current | Target | Issues | Refactor |
|--------|---------|--------|--------|----------|
| Customer ledger | `ledger.ts`, inline inserts | **`LedgerPostingEngine`** | Raw POST unsafe | 🔴 P0 |
| Supplier ledger | same | same | Was ad-hoc; partial fix on main | 🟡 P0 |
| Cash / bank | `cashbook.ts`, inline | `CashBankPostingService` | Split paths | 🟡 P0 |
| Expense | `expenses.ts` | `ExpenseDocument` | Cash only | 🟡 P2 |
| Journal | `journal.ts` | `ManualJournalDocument` | Parallel to sub-ledgers | 🟡 P3 |
| Financials | `financials.ts` | `FinancialStatementService` | AP formula wrong | 🔴 P0 |
| EMI | `emi.ts` | `EmiScheduleService` | Isolated | 🟢 |
| Directors | `directors.ts` | `EquityService` | OK pattern | 🟢 |
| Payroll | `employees.ts` | `PayrollPostingService` | HRM scope | 🟢 Phase 5 |

---

## 7. CRM / projects (low restructure risk)

| Domain | Routes | Action |
|--------|--------|--------|
| Leads | `leads.ts` | 🟢 |
| Projects | `projects.ts` | 🟢 link sales as documents |
| Commissions | `commissions.ts` | 🟡 post via engine |
| Campaign gifts | `campaignGifts.ts` | 🟢 |

---

## 8. Reporting domain

| Current | Target | Action |
|---------|--------|--------|
| 43+ endpoints in `reports.ts` | **`ReportQueryService`** on read models | 🔴 P1 |
| Inline balance math | `mv_customer_outstanding`, `mv_supplier_payable` | P1 |
| `dashboard.ts` widgets | same read models | P1 |
| `financials.ts` | GL-ready from postings | P0 fix AP, then P2 GL |

---

## 9. Frontend service map

| UI area | Current service | Target |
|---------|-----------------|--------|
| Purchases | `purchaseService.ts` | `PurchaseDocumentClient` → post/reverse/pay |
| Sales | `salesService.ts` | `SaleDocumentClient` |
| Collections | `collectionsService.ts` | `CollectionClient` |
| Payables | `SupplierPayablesPage` (new) | `PayablesClient` |
| Ledger | `ledgerService.ts` | read-only + export |
| Reports | `reportService.ts` | thin fetch from read models |

**Remove:** direct `ledgerService.addEntry()` from any future UI.

---

## 10. Code areas to refactor first (ordered)

```
Week 1-2 foundation
├── backend/src/lib/ledgerBalance.ts          ← canonical (extend)
├── backend/src/lib/customerPayment.ts          ← merge into engine
├── backend/src/lib/supplierPayment.ts          ← merge into engine
├── backend/src/routes/financials.ts          ← fix AP; use computeSupplierBalance
└── backend/src/routes/reports.ts               ← customer-due, payments report

Week 3-4 posting engine MVP
├── NEW backend/src/services/posting/StockPostingEngine.ts
├── NEW backend/src/services/posting/LedgerPostingEngine.ts
├── NEW backend/src/services/posting/PostingOrchestrator.ts
├── backend/src/routes/purchases.ts             ← delegate post
├── backend/src/routes/sales.ts                 ← delegate post; deprecate PUT
└── backend/src/routes/returns.ts               ← batch-aware returns

Week 5-6 documents & approvals
├── Document state columns (migration)
├── backend/src/routes/approvals.ts             ← enforce on post
├── Purchase reverse API
└── Sales return batch restoration

Week 7+ warehouse, reports, VAT prep
├── warehouses.ts + stock engine
├── Report read models
└── tax document extensions
```

---

## 11. Preserve explicitly

- Multi-tenant `dealer_id` scoping on all queries
- Roles: `super_admin`, `dealer_admin`, `manager`, `accountant`, `salesman`
- Tile units: `box_sft`, `per_box_sft`, `rate_unit`
- Existing Knex migration chain (additive only)
- VPS API as system of record (portal migration separate)
