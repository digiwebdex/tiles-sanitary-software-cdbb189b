# V2 Sprint 4A — Customer & Quotation Foundation (Change Record)

**Branch:** `v2/sprint-4a-customer-quotation-foundation` (based on `v2/sprint-3d-inventory-intelligence`, tip `33d94dc`) — isolated worktree branch, **NOT deployed, NOT pushed**.
**Principle:** Sprints 2 through 3D (Product Master → Inventory Intelligence) are frozen — no file any of those sprints created or modified was touched. This is the **first Sell Side sprint** (Phase 3 of the roadmap); Sales Order, Invoice, POS, Challan, Delivery, inventory deduction, payment/VAT posting, Returns, Exchange, Warranty, and Barcode/QR are all explicitly out of scope and untouched.

---

## 1. Inspection — what already existed (reused, not rebuilt)

This sprint had the **largest "already built" discovery yet** in this series: 4 of 5 requested areas were already fully built, backend and frontend, including complete pages that simply weren't examined until now.

| Sprint 4A requirement | What already existed | Verdict |
|---|---|---|
| **Customer Management** (list, profile, credit limit, price level, contact, address) | `customers` table, full CRUD route (`customers.ts`), `CustomerForm.tsx`, `CustomerList.tsx`, `price_tier_id` link (migration 054). | ✅ Fully built |
| **Walk-in Customer** | `quotations.customer_id` is already nullable with `customer_name_text`/`customer_phone_text`/`customer_address_text` fallback fields. | ✅ Fully built |
| **Dealer / Contractor / Builder / Corporate Customer, Customer Group, Customer Discount Policy** | Nothing — `customers.type` was a 3-value Postgres ENUM (`retailer`/`customer`/`project`) with no room for these; no group/discount-policy concept anywhere. | 🆕 Genuine gap |
| **Customer Ledger** (opening/due/credit balance, transaction history, statement, aging) | `customer_ledger` table, `customerStatements.ts` (full statement + credit-list), `CustomerStatementPage.tsx`, `CustomerStatementsBulkPage.tsx` — all live, already routed. | ✅ Fully built — reused unchanged |
| **Customer Ledger Summary** (on a profile view) | No distinct "Customer Profile" page existed — only the edit form and the full Statement page. The customer list's own "View Profile" menu item was already labeled but pointed at the edit form (a placeholder). | 🆕 Genuine gap |
| **Customer Collections** (entry, history, advance, partial, due) | `collections.ts` (`/outstanding`, `/payment` with FIFO allocation, `/recent`, `/followups`), `CollectionTracker.tsx` (full payment UI, aging tabs, WhatsApp/SMS reminders, receipts) — all live. | ✅ Fully built — reused unchanged |
| **Collection Adjustment** | No dedicated route — `customer_ledger.type='adjustment'` existed as a value the *read* side (`customerStatements.ts`) already summed correctly, but nothing ever *wrote* one outside of ad-hoc means. | 🆕 Genuine gap |
| **Quotation** (create/edit/approve/cancel/convert/status/validity/price level/discount) | `quotations`/`quotation_items` tables, full route (`quotations.ts`, 567 lines: CRUD, finalize, cancel, revise, conversion-prefill, link-to-sale), `QuotationForm.tsx`, `QuotationList.tsx`, `QuotationDetailDialog.tsx`, revision chain, auto-expiry RPC. | ✅ Fully built — reused unchanged |
| **Approve Quotation** | No separate approval workflow exists — "finalize" (draft → active) is the equivalent action, open to any authenticated tenant user. | ✅ Treated as the existing action — see §2 note |
| **Quotation Product Selection** | `QuotationForm.tsx` already has a product picker + price-tier auto-fill + batch shade/caliber/lot preference fields. | ✅ Fully built |
| **Show Available Quantity** | Product picker showed no stock/availability signal at all — Sprint 3C's `computeAvailability()` existed but was never called from Quotation. | 🆕 **The sprint's own named centerpiece** — see §2 |

---

## 2. What Sprint 4A ADDED

### Database (migration `089_customer_category_group_discount.ts` — purely additive)

- **Extended** the existing `customer_type` Postgres ENUM with `dealer`, `contractor`, `builder`, `corporate` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`) — the original 3 values and every existing row are unaffected; this single column now covers all the customer categories the sprint asked for, rather than introducing a parallel "category" table.
- **New nullable columns on `customers`**: `customer_group` (free-text label, mirrors how `products.series`/`collection_name` were added in Sprint 2 — no new lookup table), `default_discount_type` (`'flat'|'percent'`, CHECK-constrained), `default_discount_value` (decimal, default 0).
- No changes to `quotations`, `quotation_items`, `customer_ledger`, or any other existing table.

### Backend

| File | Change |
|---|---|
| `backend/src/routes/customers.ts` | `CUSTOMER_TYPES` extended with the 4 new values; `customer_group`/`default_discount_type`/`default_discount_value` added to `WRITABLE`, `FILTERABLE`, and the write schema. |
| `backend/src/routes/collections.ts` | `GET /outstanding` gained an **optional** `customerId` query param (existing dealer-wide callers never send it, so their behavior is byte-for-byte unchanged) — powers the new Customer Profile's ledger summary. New `POST /adjustment` (dealer_admin only): a manual signed `customer_ledger` entry (`type='adjustment'`) for corrections outside the FIFO payment flow — reuses the exact sign convention `customerStatements.ts` already implements (adjustment sums like a sale; a negative amount is a write-off). |
| `backend/src/db/migrations/089_*.ts` | See above. |

**Deliberately NOT touched:** `backend/src/routes/quotations.ts` — "Approve Quotation" is treated as the existing `/finalize` action. It currently has no role gate; this sprint did **not** add one, since doing so would be a behavior change that could lock out a single-admin dealer who currently self-approves their own quotations, and "Approve" isn't described as a *new* status/workflow in the scope — just as an existing lifecycle step. Documented here rather than silently assumed.

**Also deliberately NOT touched:** `backend/src/services/availabilityService.ts` and `backend/src/routes/availability.ts` (Sprint 3C, frozen). The Quotation Product Selection feature calls the existing single-product `GET /api/availability/:productId` endpoint once per line item — no bulk/multi-product endpoint was added, since that would mean modifying a frozen Sprint 3C file. A quotation typically has a handful of line items, so this stays cheap.

### Frontend

| File | Change |
|---|---|
| `src/services/customerService.ts` | `CustomerType` extended; `customer_group`/`default_discount_type`/`default_discount_value` added to `Customer`/`CustomerFormData` and `buildWritePayload()`. |
| `src/services/collectionsService.ts` | New `getCustomerOutstanding()` (single-customer variant of the existing `listOutstanding()`) and `recordAdjustment()`. |
| `src/modules/customers/CustomerForm.tsx` | 4 new type options in the dropdown; new "Customer Group" field; new "Discount Policy" section (type + value, optional). |
| `src/modules/customers/CustomerList.tsx` | New type labels/colors/filter options for the 4 new categories. The pre-existing "View Profile" menu item — previously mislabeled and pointing at the edit form — now correctly points at the new Profile page. |
| `src/pages/customers/CustomerProfilePage.tsx` | **New** — read-only Customer Profile: contact/address, ledger summary (due balance, aging, credit limit, price level, discount policy), links out to the existing full Statement page and Edit form rather than duplicating either. |
| `src/modules/collections/AdjustmentDialog.tsx` | **New** — small dialog for "Collection Adjustment", wired into `CollectionTracker.tsx` via one new button (dealer_admin only). |
| `src/modules/quotations/AvailabilityCell.tsx` | **New** — the sprint's centerpiece: a small per-line-item cell calling the existing `availabilityService.getAvailability()` (Sprint 3C, unmodified), shown read-only in `QuotationForm.tsx`'s items table. No stock is reserved — purely informational, exactly as specified. |
| `src/config/navConfig.ts` / `src/App.tsx` | +1 route (`/customers/:id` → the new Profile page). No new nav item was needed — Customers/Quotations/Collections already have nav entries from before this sprint. |

---

## 3. Database impact

**Purely additive.** 1 enum extended (4 new values, 0 existing values touched), 3 new nullable/defaulted columns on 1 existing table. No renamed/dropped/retyped columns, no changed defaults for existing rows — every customer created before this migration keeps its exact current `type` value and behavior.

## 4. API impact

| Change | Compatibility |
|---|---|
| `customers.ts` accepts 4 new `type` values + 3 new optional fields | Additive — omitting them behaves exactly as before. |
| `collections.ts` `GET /outstanding?customerId=` | Additive optional param — `CollectionTracker.tsx` (the only existing caller) never sends it, so its dealer-wide behavior is unchanged. |
| **New** `POST /api/collections/adjustment` | New endpoint; nothing pre-existing changed. |
| Quotation, Customer CRUD, Customer Statement, Auto-PO APIs | **Zero changes** — confirmed via `git diff` against `33d94dc`; `quotations.ts` does not appear in this sprint's diff at all. |

No existing API, service, or component was modified in a way that changes current (pre-4A) behavior for a dealer who takes no new action.

## 5. Testing report

- **Backend:** `npx tsc --noEmit` clean, except the same pre-existing Sprint 3B test-file issue already documented in Sprints 3C/3D's own reports (unrelated, not touched). `npx vitest run` — **164/164 pass** (11 new + 153 prior). New: `customers.query.test.ts` (5 — extended type enum + new field validation), `collections.query.test.ts` (6 — the `customerId` scope query shape + the new adjustment schema).
- **Frontend:** `npx tsc --noEmit -p tsconfig.app.json` clean (only the pre-existing `portalService.ts` issue, as every prior sprint reports). `npx vitest run` — **297/297 pass** (7 new + 290 prior). New: `customerService.sprint4a.test.ts` (3), `collectionsService.test.ts` (4 — this service had zero prior coverage). `npm run build` succeeds cleanly.

## 6. Manual QA checklist

- [ ] **Customer form** — create a customer with type "Contractor", a Customer Group ("VIP"), and a default 5% discount policy; confirm it saves and the list shows the new type badge/filter correctly.
- [ ] **Customer list** → row menu → "View Profile" — confirm it now opens the new Profile page (not the edit form), showing due balance, aging, credit limit, price level, and the discount policy just set.
- [ ] **Customer Profile** → "Full Statement" / "Edit" buttons — confirm both land on the correct existing pages.
- [ ] **Collections tracker** (as dealer_admin) — confirm a new "Adjust" button appears per customer row; record a write-off (negative amount) and a correction (positive amount); confirm the customer's due balance updates accordingly and the reason is required.
- [ ] **Collections tracker** (as a non-admin role) — confirm the "Adjust" button does NOT appear.
- [ ] **Quotation form** — add a product line; confirm the new "Available" column shows a live quantity (matching what Inventory's Availability tab shows for the same product) without blocking or altering the quantity field. Add a product with 0 stock; confirm it shows a warning icon but still allows quoting any quantity.
- [ ] **Quotation** — confirm Create/Edit/Finalize ("Approve")/Cancel/Revise/Convert-to-Sale all work exactly as before (unchanged).
- [ ] Confirm Products, Inventory, Warehouses, Reservations, and Inventory Intelligence pages (Sprints 2–3D) still work exactly as before.

## 7. Rollback strategy

1. **Not yet merged/deployed** — do not merge the branch. Nothing is live.
2. **After merge:** `git revert` the sprint commit — every change is additive; the 9 modified existing files only gained new optional fields/params or new UI elements.
3. **DB rollback:** migration `089`'s `down()` drops the 3 new `customers` columns and their CHECK constraint. The 4 enum values added to `customer_type` cannot be removed by PostgreSQL (`ALTER TYPE ... DROP VALUE` doesn't exist) — they are left in place, harmless, since no row will reference them once the columns/UI that exposed them are reverted.
4. **Partial rollback:** the Customer Profile page, Adjustment dialog, and Availability column can each be hidden/reverted independently of the backend (which would simply go unused).

## 8. Explicitly out of scope (per Sprint 4A instructions — not done)

- Sales Order, Invoice, POS, Challan, Delivery — untouched.
- Inventory deduction, payment posting to Accounts, VAT posting, stock movement — untouched (Quotation remains non-binding; no stock or money moves at the quotation stage).
- Sales Return, Exchange, Warranty, Barcode, QR — not implemented.
- Automatic shade-matching (still deferred, per Sprint 3C/3D) and a formal quotation approval *workflow* (distinct from the existing finalize action) — neither was built; both documented as deliberate non-decisions above.
- No changes to Product Master, the Warehouse/Godown/Rack/Bin hierarchy, Reservations, or Inventory Intelligence.
