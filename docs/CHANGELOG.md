# CHANGELOG — TilesERP

> All notable changes to the TilesERP project. Dates in YYYY-MM-DD format.

---

## [2026-06-25] — 7-day trial + master plan organogram

### Added
- **Day 5 trial reminder cron** — SMS + email when 2 days remain (`npm run cron:trial-day5`).
- **Day 7 trial reminder cron** — SMS + email when trial ends today (`npm run cron:trial-day7`, `npm run cron:trial-reminders`).
- In-app banners on Subscription page (2 days left + last day).

### Changed
- **Trial period extended from 3 → 7 days** — signup provisioning (`authService.register`), Free Trial plan (migration `069`), marketing pages, email/SMS copy.
- Added **`docs/MASTER_PLAN_ORGANOGRAM.md`** — signup → onboarding → renewal playbook with team roles, timeline, and WhatsApp scripts.

---

## [2026-06-11] — User Guide refresh (বাংলা A–Z)

### Changed
- `public/dealer-guide.html` — VAT/Mushak, payment modes (bKash/Nagad/SSLCommerz), Supplier Payables, Due Aging, Read-Only troubleshooting, grouped sidebar, Mushak-6.3 invoice, 4-step sales return wizard.
- `UserGuidePage.tsx` — section list aligned with updated guide.

---

## [2026-06-11] — Fix new-dealer Read-Only + challans migration

### Fixed
- **New dealer Read-Only bug** — `active` subscription with `end_date = null` no longer locks the UI in readonly mode (`AuthContext.computeAccessLevel`).
- **`POST /api/dealers`** — assigns default `end_date` from plan (trial days or 365 days for paid plans) when omitted.
- **Challans list 500** — migration `065` adds `project_id` / `site_id` on `challans` and `deliveries` (was missing on VPS).
- **Data backfill** — migration `065` sets `end_date` on active subscriptions that had `NULL`.

---

## [2026-06-09] — Phase 4 report cutover (Tier A balance SQL)

### Changed
- **Due Aging** (`GET /api/reports/page/due-aging`) — built via `buildDueAgingReportRows()`; per-customer totals from `mv_customer_outstanding`; invoice buckets exclude reversed sales.
- **Sale overdue check** — AR from read model + `oldest_unpaid_date` (no inline `customer_ledger` loop).
- **Project outstanding** — `buildProjectOutstandingRows()` in `reportQueryService`; excludes reversed sales.
- **Purchases report** — paid amounts via `getPurchasePaidAmountMap()` / `sumPurchaseLedgerPayments()`.
- **Collections aging** — `getOldestUnpaidSaleDateByCustomer()` excludes reversed sales.

### Added
- `src/test/dueAgingReport.test.ts` — aging bucket unit tests.
- Read-model parity fixture for due-aging invoice rollup vs `mv_customer_outstanding`.

---

## [2026-06-08] — Smooth operations restructure (fresh data)

### Fixed
- **Unified customer payment path** — Invoice page and Collections tracker both use atomic VPS payment APIs that update `sales.paid_amount` / `sales.due_amount`.
- **Ledger sign convention** — Sale create/edit and sales return now store positive payment/refund amounts (type-based balance math).
- **Collections FIFO allocation** — `POST /api/collections/payment` applies payments to oldest due invoices first.
- **Supplier reports** — Supplier Payable and Supplier Outstanding use the same type-based balance formula.
- **Sales return due sync** — Refunds now reduce invoice `due_amount` / `paid_amount`.

### Added
- `backend/src/lib/ledgerBalance.ts` — shared customer/supplier balance helpers.
- `backend/src/lib/customerPayment.ts` — atomic payment recording with invoice allocation.
- `docs/OPERATIONS_GUIDE.md` — fresh dealer go-live checklist.
- `docs/STAFF_TRAINING_SHEET.md` — bilingual (Bangla/English) 1-page showroom staff guide.
- `src/test/ledgerBalance.test.ts` — balance helper unit tests.

### Removed
- Supabase payment/update calls from `InvoicePage` (VPS-only).

---

## [2026-06-08] — VPS database setup fix (postgres auth error)

### Fixed
- **`loadBackendEnv`** — production now prefers `DB_PASSWORD` + component vars over stale `DATABASE_URL=postgres://...` copy-paste configs.
- Added `databaseUrl.ts` helper with canonical defaults (`tileserp@127.0.0.1:5440`).

### Added
- `scripts/vps-db-doctor.sh` — diagnose DB connection on VPS.
- `scripts/vps-fresh-setup.sh` — one-command fresh DB + migrations + PM2 restart.
- `backend/src/scripts/dbDoctor.ts` — `npm run db:doctor` connectivity test.
- `docs/VPS_FRESH_DEPLOY.md` — step-by-step fix for `password authentication failed for user "postgres"`.

---

### Fixed
- **Purchase create auth** — `getAuthenticatedDealerId()` now re-fetches `/api/auth/me` when access token exists but `vps.user` is missing from localStorage.
- **`vpsAuthApi.me()`** — persists user snapshot to localStorage so service-layer auth checks match AuthContext.
- **JWT fallback** — decode access token client-side when user cache and `/me` are unavailable (fixes purchase submit on stale sessions).
- **Approvals 500** — `/api/approvals/pending` returns empty list when `approval_requests` table not migrated yet.
- **Console noise** — pending approvals fetch failures no longer spam unhandled rejections.

---

## [2026-06-04] — Track 1 Phase 1: P&L correctness hotfix

### Fixed
- **Cost of Goods Sold (COGS)** on `/api/financials/p-and-l` and
  `/api/financials/trial-balance` was always reported as zero because the
  underlying query referenced a column on `sale_items` that does not
  exist in the schema. COGS is now sourced from the `sales.cogs` header
  column, which is already populated atomically by `routes/sales.ts` at
  sale create/update time.
- **Sales Returns** on the same two endpoints were always reported as
  zero for the same root cause (non-existent unit-price column on
  `sales_returns`). Now sourced from `sales_returns.refund_amount`, the
  canonical column populated by `routes/returns.ts`.
- Removed every silent `.catch(() => null)` and `catch { /* ignore */ }`
  block in `backend/src/routes/financials.ts`. All aggregations now flow
  through a new `safeSum` / `safeQuery` helper that returns 0 on failure
  **and** emits a structured stderr log line **and** appends a
  human-readable warning to a per-request `warnings[]` array returned in
  the response.

### Added
- `backend/src/lib/safeSum.ts` — small dependency-free helpers used by
  every financial aggregation.
- `backend/src/lib/logger.ts` — backend structured-logger with
  `logRouteError` / `logRouteWarn`.
- Lint-style Vitest tests under `src/test/financialsNoSilentCatch.test.ts`
  that prevent the silent-catch pattern from being reintroduced.
- Pure unit tests under `src/test/financialsSafeSum.test.ts`.
- Integration contract under `src/test/financialsPnlContract.test.ts`
  (skipped pending a Postgres test DB in CI; documents the end-to-end
  behaviour the hotfix preserves).
- `data_source` and `warnings[]` optional fields on the P&L, Balance
  Sheet, and Trial Balance responses. The Financial Statements page now
  surfaces these via a small "Data quality notes" alert and a footer
  line indicating the source columns.
- `docs/FINANCIAL_REPORTING.md` — column-by-column source map for every
  number that appears on the financial endpoints.

### Compatibility
- Existing frontend builds reading the old response shape continue to
  work unchanged — all new fields are optional and additive.
- No schema changes. No infrastructure changes. No new endpoints.
- The visible behavioural change: gross / net profit will drop
  materially on the P&L page for any dealer who previously relied on the
  buggy output. The numbers shown after this release reflect the COGS
  and refund amounts that were always present in the underlying tables.

---

## [2026-04-14] — Subscription Duration & Registration Notifications

### Added
- **Duration presets** in Edit Subscription dialog: 1 Month, 1 Year, Custom (N months)
- **Auto end-date calculation** from selected duration
- **Dealer registration notifications**: SMS + Email to both new dealer and super admin
- `self-signup` edge function enhanced with BulkSMSBD + SMTP notification triggers
- `ADMIN_PHONE` and `ADMIN_EMAIL` edge function secrets

### Changed
- Subscription Management migrated from legacy `plans` table to `subscription_plans`
- Removed "Change Plan" shortcut from Dealer Management — centralized in Subscriptions page
- SA Dashboard, Revenue, Subscription Status pages updated for `subscription_plans` FK

### Database Migrations
- `20260414035832`: Dropped FK `subscriptions_plan_id_fkey` → `plans`, added FK → `subscription_plans`

---

## [2026-04-13] — Subscription Plans CRUD & Revenue System

### Added
- **Plan Management** page (`/super-admin/plans`) — full CRUD for `subscription_plans`
- **Subscription Payment Recording** with auto-extension on full payment
- **Revenue Reports** page (`/super-admin/revenue`)
- **Subscription Status Overview** (`/super-admin/subscription-status`)
- **Yearly Discount Eligibility** check (2 months free, first year only)
- **Plan feature toggles**: SMS enabled, Email enabled, Daily Summary enabled
- Billing cycle selector (monthly/yearly) in payment dialog
- Extend months input for payment recording

### Plans Created
| Plan | Monthly (BDT) | Yearly (BDT) | Users | SMS | Email | Daily Summary |
|---|---|---|---|---|---|---|
| Starter | 999 | 10,000 | 1 | ❌ | ✅ | ❌ |
| Pro | 2,000 | 20,000 | 2 | ✅ | ✅ | ✅ |
| Business | 3,000 | 30,000 | 5 | ✅ | ✅ | ✅ |

---

## [2026-04-12] — SMS & Email Notification System

### Added
- **BulkSMSBD Integration** for SMS notifications
- **Gmail SMTP Integration** for email notifications
- **Notification Settings** per dealer (enable/disable per channel)
- `send-notification` edge function (SMS + Email dispatcher)
- `daily-summary` edge function (cron at 02:00 AM)
- `test-smtp` edge function (admin email testing)
- `notification_settings` table (PK: dealer_id)
- `notifications` table (delivery tracking with retry)

### Notification Events
- Sale notification → dealer owner
- Daily summary → all dealers with enabled setting
- Registration alert → new dealer + admin

---

## [2026-04-11] — Super Admin Reports & CMS

### Added
- **Super Admin Reports**: Platform-wide sales, revenue, dealer comparison
- **CMS Page** (`/super-admin/cms`) — edit website content sections
- `website_content` table for dynamic landing page content
- **Contact Submissions** viewer in admin panel
- `submit-contact` edge function (public, no auth)
- `contact_submissions` table with status tracking

---

## [2026-04-10] — Super Admin Panel

### Added
- **Super Admin Layout** with dedicated sidebar navigation
- **SA Dashboard** — platform KPIs (dealers, subscriptions, revenue)
- **Dealer Management** — view all dealers, create users, reset passwords
- `create-dealer-user` edge function
- `reset-dealer-password` edge function
- `check-subscription-status` edge function
- Automatic super admin redirect on login (bypass account setup check)

### Super Admin Routes
- `/super-admin` → Dashboard
- `/super-admin/dealers` → Dealer Management
- `/super-admin/plans` → Plan Management
- `/super-admin/subscriptions` → Subscription Management
- `/super-admin/subscription-status` → Status Overview
- `/super-admin/revenue` → Revenue Reports
- `/super-admin/cms` → CMS
- `/super-admin/system` → System Settings

---

## [2026-04-09] — Subscription Lifecycle & Access Control

### Added
- **Subscription lifecycle**: Trial (7d) → Active → Expiring Soon (≤7d) → Grace (3d) → Expired → Blocked
- **Access levels**: full, grace, readonly, blocked
- **Subscription guard hook** (`useSubscriptionGuard`) — blocks writes when expired
- **Subscription blocked page** (`/subscription-blocked`)
- **RLS write guards**: `has_active_subscription()` on all write-heavy tables
- **Bypass attempt logging** in `audit_logs`

### Changed
- `ProtectedRoute` enhanced with `allowReadonly` prop for dashboard/reports
- Auth context now computes `accessLevel` from subscription status + end_date

---

## [2026-04-08] — Deliveries & Collections Module

### Added
- **Delivery Management** — create, track, complete deliveries
- **Delivery Items** — linked to sale items for partial delivery
- **Collections Module** — track outstanding payments
- **Customer Follow-ups** — schedule reminders with notes
- **Campaign Gifts** — gift tracking per campaign per customer
- `deliveries`, `delivery_items`, `customer_followups`, `campaign_gifts` tables
- Follow-up panel with status workflow (pending → completed → cancelled)

---

## [2026-04-07] — Bulk Import & Barcode System

### Added
- **Bulk Import Dialog** — Excel upload for products, customers, suppliers
- **Import Configs** — per-entity column mapping definitions
- **Barcode System** — JsBarcode generation + print dialog
- **Barcode Label** component (product label with barcode)
- **Change Barcode Dialog** — manual barcode reassignment
- **Barcode Print Dialog** — configurable label printing

---

## [2026-04-06] — Credit System & POS Mode

### Added
- **Credit Limit Enforcement** — block sales exceeding customer credit
- **Credit Override** — owner approval with reason (audit logged)
- **Credit Approval Dialog** — real-time balance check + approval workflow
- **Credit Report Page** (`/reports/credit`)
- **POS Sale Mode** (`/sales/pos`) — quick counter sale without navigation
- `credit_overrides` table with audit fields

### Credit Check Flow
```
Sale → Check customer outstanding + credit_limit
  → If exceeded → Show Credit Approval Dialog
    → Owner enters reason → credit_overrides record created
    → Sale proceeds with override audit trail
```

---

## [2026-04-05] — Reports Module (14 Views)

### Added
- **Reports Page** with dual navigation (desktop accordion + mobile tabs)
- **20 report views** across 5 categories:
  - Sales & Revenue (6): Daily Sales, Monthly Sales, Monthly Summary, Sales Report, Sales by Salesman, Profit Analysis
  - Inventory (6): Products Report, Brands Report, Inventory Report, Low Stock, Stock Movement, Product History
  - Customers & Payments (4): Customers Report, Payments Report, Due Aging, Supplier Outstanding
  - Deliveries (2): Pending Deliveries, Delivery Status
  - Purchases & Expenses (2): Purchases Report, Expenses Report
- **Role-based access**: Profit Analysis, Accounting, Supplier Outstanding, Purchases restricted to dealer_admin
- **Excel export** via `exportToExcel()` utility
- **Pagination** (25 items per page) on large reports

---

## [2026-04-04] — Challan & Invoice System

### Added
- **Challan Generation** from completed sales
- **Modern Challan Document** — print-ready with dealer info
- **Sale Invoice Document** — with barcode + payment details
- **Auto Invoice Numbering** per dealer (INV-001, INV-002...)
- **Auto Challan Numbering** per dealer (CH-001, CH-002...)
- **Edit Challan Dialog** — update driver, transport, vehicle, notes
- **Show Price Toggle** — option to hide prices on challans
- `challans` table, `invoice_sequences` table
- `generate_next_invoice_no()` and `generate_next_challan_no()` DB functions

---

## [2026-04-03] — Expense & Ledger System

### Added
- **Expense Management** — record expenses with categories
- **Customer Ledger** — track sales, payments, refunds per customer
- **Supplier Ledger** — track purchases, payments per supplier
- **Cash Ledger** — all cash movements with references
- **Expense Ledger** — expense entries with categories
- **Ledger Page** (`/ledger`) — multi-tab view (Customer, Supplier, Cash, Expense)
- `expenses`, `customer_ledger`, `supplier_ledger`, `cash_ledger`, `expense_ledger` tables

---

## [2026-04-02] — Returns System

### Added
- **Sales Returns** — return items with refund + stock adjustment
- **Purchase Returns** — return to supplier with debit note
- **Broken Stock Flag** — `is_broken` on sales returns (does not restock)
- **Refund Mode Tracking** — cash, bank, mobile_banking
- **Customer Ledger Integration** — auto-entry on refund
- `sales_returns`, `purchase_returns`, `purchase_return_items` tables

---

## [2026-04-01] — Purchase Module

### Added
- **Purchase Management** — create, view, list purchases
- **Purchase Items** with landed cost calculation
- **Landed Cost Formula**: `purchase_rate + transport_cost + labor_cost + other_cost`
- **Stock Auto-Update** on purchase — updates box_qty, sft_qty, average_cost_per_unit
- **Supplier Ledger Auto-Entry** on purchase
- `purchases`, `purchase_items` tables

---

## [2026-03-30] — Sales Module

### Added
- **Sales Management** — create, edit, list sales
- **Sale Items** with quantity, rate, total, total_sft
- **Profit Calculation**: COGS (weighted avg cost × qty), gross_profit, net_profit
- **Payment Modes**: cash, credit, bank, mobile
- **Discount** with reference tracking (discount_reference)
- **Client & Fitter References** on sales
- **Customer Ledger Auto-Entry** on sale
- **Stock Auto-Deduction** on sale
- `sales`, `sale_items` tables

---

## [2026-03-28] — Product & Stock Module

### Added
- **Product Management** — CRUD with categories (Tiles, Sanitary)
- **Unit Types**: box_sft (with per_box_sft conversion) / piece
- **Stock Management** — box_qty, sft_qty, piece_qty, reserved quantities
- **Average Cost Tracking** — weighted average cost per unit
- **Reorder Level** — configurable per product
- **Stock Adjustment** — manual corrections with reason
- **Product Detail Dialog** — full product information view
- `products`, `stock` tables

---

## [2026-03-26] — Customer & Supplier Module

### Added
- **Customer Management** — 3 types: retailer, customer, project
- **Supplier Management** — with GSTIN, contact person
- **Opening Balance** — initial balance for both customers and suppliers
- **Credit Settings** — credit_limit + max_overdue_days per customer
- **Status Management** — active/inactive toggle
- `customers`, `suppliers` tables

---

## [2026-03-24] — Authentication & RBAC

### Added
- **Supabase Auth Integration** — email/password login
- **Auth Context** — session, profile, roles, subscription state management
- **Role-Based Access Control** — super_admin, dealer_admin, salesman
- **Protected Routes** — auth guard with subscription check
- **Login Page** with rate limiting + account lockout
- **Self-Signup Flow** (`/get-started`) — dealer registration
- `profiles`, `user_roles`, `login_attempts` tables
- `is_super_admin()`, `has_role()`, `get_user_dealer_id()` security definer functions

---

## [2026-03-22] — Multi-Tenant Foundation

### Added
- **Multi-Tenant Architecture** — dealer_id isolation on all data tables
- **RLS Policy Framework** — 5-layer security (super_admin, dealer_admin, salesman, subscription, view)
- **Dealer Management** — business entity setup
- **Landing Page** — public marketing page
- **Pricing Page** — plan comparison cards
- **Privacy Policy** & **Terms of Service** pages
- **Contact Page** — public inquiry form
- `dealers` table, `plans` table (legacy)

---

## [2026-03-20] — Project Foundation

### Added
- **React 18 + Vite 5** project scaffold
- **TypeScript 5** configuration
- **Tailwind CSS 3** with design tokens
- **shadcn/ui** component library
- **TanStack Query** for server state
- **React Router 6** with SPA routing
- **Express Backend** with health check API
- **PostgreSQL Database** with Knex migrations
- **Nginx Configuration** for VPS deployment
- **PM2 Process Management** setup
- **Docker Configuration** (docker-compose.yml)
- **Error Boundary** component
- **Keyboard Shortcuts** hook
- Initial database schema (`001_initial_schema.ts`)
