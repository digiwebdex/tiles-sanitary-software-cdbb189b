# TilesERP — Developer Documentation (A to Z)

> **Version:** 2.0 | **Last Updated:** 2026-06-23 | **Domain:** app.sanitileserp.com

> **Architecture note (2026):** Production dealer app uses the **VPS Express API + PostgreSQL**.
> Supabase is retained for the customer portal and legacy edge functions until Phase 6.
> See `docs/DATA_PATH.md` for the authoritative data-path decision.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Directory Structure](#directory-structure)
5. [Environment Setup](#environment-setup)
6. [Frontend](#frontend)
7. [Backend](#backend)
8. [Database](#database)
9. [Authentication & Authorization](#authentication--authorization)
10. [Subscription System](#subscription-system)
11. [Notifications (SMS & Email)](#notifications-sms--email)
12. [Edge Functions](#edge-functions)
13. [Multi-Tenancy](#multi-tenancy)
14. [Modules Reference](#modules-reference)
15. [API Endpoints](#api-endpoints)
16. [Testing](#testing)
17. [Deployment](#deployment)
18. [Security](#security)
19. [Troubleshooting](#troubleshooting)

---

## Project Overview

TilesERP is a multi-tenant SaaS ERP system built for **Tiles & Sanitary** dealers in Bangladesh. Each dealer gets isolated data, subscription-based access control, and role-based permissions.

**Key Features:**
- Multi-dealer tenancy with strict data isolation
- Product management (Tiles: box/sft, Sanitary: piece)
- Purchase & Sales with invoice/challan generation
- Customer & Supplier ledger tracking
- Stock management with barcode support
- Credit limit enforcement with override audit trail
- Subscription lifecycle (Trial → Active → Grace → Expired → Suspended)
- Super Admin panel for platform management
- SMS (BulkSMSBD) & Email (SMTP) notifications
- POS mode for quick sales
- Delivery tracking with challan integration
- Campaign gift management
- Collections & follow-up tracking

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Nginx (SSL)                        │
│         app.sanitileserp.com:443                    │
├──────────────┬──────────────────────────────────────┤
│  Static SPA  │        /api/* proxy                  │
│  dist/       │        → localhost:3003              │
├──────────────┴──────────────────────────────────────┤
│              Express API (Node 20)                   │
│              Knex + PostgreSQL (tileserp)            │
└─────────────────────────────────────────────────────┘

Portal (portal.sanitileserp.com) → Supabase Auth + mixed reads (Phase 6 migration)
```

**Production stack:**
- **VPS Express API:** Primary auth, all dealer-app reads/writes, reports, posting engine
- **PostgreSQL (local):** Authoritative database for dealer data (Knex migrations)
- **Supabase Cloud:** Customer portal auth, legacy edge functions (Phase 6 decommission planned)

See `docs/DATA_PATH.md` for the full data-path matrix.

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| React | 18.3 | UI framework |
| TypeScript | 5.8 | Type safety |
| Vite | 5.4 | Build tool |
| Tailwind CSS | 3.4 | Styling |
| shadcn/ui | Latest | Component library |
| TanStack Query | 5.x | Server state management |
| React Router | 6.30 | Client-side routing |
| React Hook Form | 7.x | Form management |
| Zod | 3.x | Schema validation |
| Recharts | 2.x | Charts/Analytics |
| date-fns | 3.x | Date utilities |
| JsBarcode | 3.x | Barcode generation |
| xlsx | 0.18 | Excel export |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Runtime |
| Express | 4.21 | HTTP framework |
| TypeScript | 5.6 | Type safety |
| Knex | 3.1 | SQL query builder & migrations |
| PostgreSQL | 16 | Database (local, port 5440) |
| JWT | 9.x | Token authentication |
| bcryptjs | 2.4 | Password hashing |
| Helmet | 8.x | Security headers |

### Infrastructure
| Service | Purpose |
|---|---|
| Supabase (Lovable Cloud) | Auth, DB, Edge Functions, RLS |
| Hostinger VPS | Hosting (187.77.144.38) |
| Nginx | Reverse proxy + SSL |
| PM2 | Process manager |
| Let's Encrypt | SSL certificates |
| BulkSMSBD | SMS gateway |
| Gmail SMTP | Email notifications |

---

## Directory Structure

```
/var/www/tilessaas/
├── docs/                      # Documentation
├── public/                    # Static assets
├── scripts/                   # Deployment & backup scripts
│   ├── deploy.sh
│   ├── backup.sh
│   └── restore.sh
├── src/                       # Frontend source
│   ├── App.tsx                # Root component & routing
│   ├── main.tsx               # Entry point
│   ├── index.css              # Global styles & design tokens
│   ├── components/            # Shared components
│   │   ├── ui/                # shadcn/ui components
│   │   ├── AppLayout.tsx      # Main app layout with sidebar
│   │   ├── ProtectedRoute.tsx # Auth guard
│   │   └── ...
│   ├── contexts/
│   │   └── AuthContext.tsx     # Auth state, roles, subscription
│   ├── hooks/                 # Custom hooks
│   │   ├── useDealerId.ts     # Tenant isolation hook
│   │   ├── useDealerInfo.ts   # Dealer details
│   │   ├── useSubscriptionGuard.ts
│   │   ├── usePermissions.ts
│   │   └── ...
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts      # Auto-generated (DO NOT EDIT)
│   │       └── types.ts       # Auto-generated (DO NOT EDIT)
│   ├── lib/                   # Utility libraries
│   │   ├── utils.ts
│   │   ├── validators.ts
│   │   ├── exportUtils.ts
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   ├── rateLimit.ts
│   │   └── tenancy.ts
│   ├── modules/               # Feature modules
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── products/
│   │   ├── purchases/
│   │   ├── purchase-returns/
│   │   ├── sales/
│   │   ├── sales-returns/
│   │   ├── ledger/
│   │   ├── dashboard/
│   │   ├── reports/
│   │   ├── deliveries/
│   │   ├── collections/
│   │   ├── campaigns/
│   │   ├── import/
│   │   └── challan/
│   ├── pages/                 # Route pages
│   │   ├── auth/
│   │   ├── public/
│   │   ├── super-admin/
│   │   ├── admin/
│   │   ├── products/
│   │   ├── purchases/
│   │   ├── sales/
│   │   └── ...
│   └── services/              # API service layer
│       ├── salesService.ts
│       ├── productService.ts
│       ├── customerService.ts
│       └── ...
├── backend/                   # Express backend
│   ├── src/
│   │   ├── index.ts           # Express entry
│   │   ├── config/env.ts      # Environment config
│   │   ├── db/
│   │   │   ├── connection.ts
│   │   │   ├── knexfile.ts
│   │   │   ├── migrations/
│   │   │   └── seeds/
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── roles.ts
│   │   │   └── tenant.ts
│   │   ├── routes/
│   │   └── services/
│   └── package.json
├── supabase/
│   ├── config.toml
│   ├── migrations/            # Cloud migrations (DO NOT EDIT)
│   └── functions/             # Edge functions
│       ├── self-signup/
│       ├── send-notification/
│       ├── check-subscription-status/
│       ├── create-dealer-user/
│       ├── daily-summary/
│       ├── reset-dealer-password/
│       ├── submit-contact/
│       └── test-smtp/
├── nginx/nginx.conf
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
├── RESOURCE_LOCK.md           # Resource lock policy
└── package.json
```

---

## Environment Setup

### Frontend (.env — auto-managed by Lovable Cloud)
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
```

### Backend (.env)
```env
DATABASE_URL=postgres://tileserp:PASSWORD@localhost:5440/tileserp
JWT_SECRET=<64+ char random string>
JWT_REFRESH_SECRET=<64+ char different random string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
PORT=3003
NODE_ENV=production
CORS_ORIGIN=https://tserp.digiwebdex.com

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=<gmail-app-password>
SMTP_FROM=your-email@gmail.com

# SMS
BULKSMSBD_API_KEY=<api-key>
BULKSMSBD_API_URL=http://bulksmsbd.net/api/smsapi
BULKSMSBD_SENDER_ID=<sender-id>
```

### Supabase Edge Function Secrets
| Secret | Purpose |
|---|---|
| `SMTP_HOST` | Email server host |
| `SMTP_PORT` | Email server port |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email password |
| `SMTP_FROM` | Sender email |
| `BULKSMSBD_API_KEY` | SMS gateway API key |
| `BULKSMSBD_API_URL` | SMS gateway endpoint |
| `BULKSMSBD_SENDER_ID` | SMS sender ID |
| `ADMIN_PHONE` | Super admin phone for notifications |
| `ADMIN_EMAIL` | Super admin email for notifications |

---

## Frontend

### Routing (src/App.tsx)

**Public Routes:**
- `/` — Landing page
- `/pricing` — Pricing page
- `/privacy` — Privacy policy
- `/terms` — Terms of service
- `/contact` — Contact form
- `/login` — Authentication
- `/get-started` — Self-signup registration
- `/subscription-blocked` — Blocked access page

**Super Admin Routes (`/super-admin/*`):**
- `/super-admin` — Dashboard
- `/super-admin/dealers` — Dealer management
- `/super-admin/plans` — Plan CRUD
- `/super-admin/subscriptions` — Subscription management
- `/super-admin/subscription-status` — Status overview
- `/super-admin/revenue` — Revenue reports
- `/super-admin/cms` — Website content management
- `/super-admin/system` — System settings

**Protected Dealer Routes:**
- `/dashboard` — Owner dashboard (readonly allowed)
- `/products`, `/products/new`, `/products/:id/edit`
- `/suppliers`, `/suppliers/new`, `/suppliers/:id/edit`
- `/purchases`, `/purchases/new`, `/purchases/:id`
- `/customers`, `/customers/new`, `/customers/:id/edit`
- `/sales`, `/sales/new`, `/sales/:id/invoice`, `/sales/:id/edit`
- `/sales/pos` — POS sale mode
- `/challans`, `/challans/:id`
- `/deliveries`
- `/sales-returns`, `/sales-returns/new`
- `/purchase-returns`, `/purchase-returns/new`
- `/ledger`
- `/reports`, `/reports/credit`
- `/campaigns`
- `/collections`

### State Management
- **Auth State:** `AuthContext` (user, session, profile, roles, subscription, accessLevel)
- **Server State:** TanStack Query with 30s stale time
- **Form State:** React Hook Form + Zod validation

### Design System
- Tailwind CSS with HSL-based semantic tokens
- shadcn/ui components with custom variants
- Dark/Light mode support via next-themes

---

## Backend

### Express Server (Port 3003)
```
backend/src/index.ts
├── Helmet (security headers)
├── CORS (configurable origins)
├── Rate limiting (200 req/15min general, 20 req/15min auth)
├── Routes
│   ├── /api/health — Health check
│   └── /api/auth — Authentication (rate-limited)
└── Error handling (production-safe messages)
```

### Database (PostgreSQL on port 5440)
- Managed via Knex migrations
- Connection via `DATABASE_URL`
- Schema defined in `backend/src/db/migrations/001_initial_schema.ts`

---

## Database

### Core Tables

| Table | Purpose | Tenant-Scoped |
|---|---|---|
| `dealers` | Dealer/business entities | No (root) |
| `profiles` | User profiles linked to dealers | Yes |
| `user_roles` | Role assignments (super_admin, dealer_admin, salesman) | No |
| `subscriptions` | Dealer subscription records | Yes |
| `subscription_plans` | Plan definitions with features | No |
| `subscription_payments` | Payment records | Yes |
| `products` | Product catalog | Yes |
| `stock` | Inventory levels | Yes |
| `customers` | Customer records | Yes |
| `suppliers` | Supplier records | Yes |
| `sales` | Sale transactions | Yes |
| `sale_items` | Sale line items | Yes |
| `purchases` | Purchase transactions | Yes |
| `purchase_items` | Purchase line items | Yes |
| `challans` | Delivery challans | Yes |
| `deliveries` | Delivery records | Yes |
| `delivery_items` | Delivery line items | Yes |
| `customer_ledger` | Customer account entries | Yes |
| `supplier_ledger` | Supplier account entries | Yes |
| `cash_ledger` | Cash flow entries | Yes |
| `expense_ledger` | Expense entries | Yes |
| `expenses` | Expense records | Yes |
| `sales_returns` | Sales return records | Yes |
| `purchase_returns` | Purchase return records | Yes |
| `purchase_return_items` | Purchase return items | Yes |
| `credit_overrides` | Credit limit override audit | Yes |
| `customer_followups` | Follow-up reminders | Yes |
| `campaign_gifts` | Campaign gift tracking | Yes |
| `invoice_sequences` | Auto-increment invoice/challan numbers | Yes |
| `notification_settings` | Dealer notification preferences | Yes |
| `notifications` | Notification log | Yes |
| `audit_logs` | Action audit trail | Yes |
| `login_attempts` | Login security tracking | No |
| `contact_submissions` | Public contact form entries | No |
| `website_content` | CMS content | No |
| `plans` | Legacy plan table | No |

### Enums
- `app_role`: super_admin, dealer_admin, salesman
- `customer_type`: retailer, customer, project
- `product_category`: tiles, sanitary
- `unit_type`: box_sft, piece
- `user_status`: active, inactive, suspended
- `subscription_status`: active, expired, suspended
- `ledger_entry_type`: sale, purchase, payment, refund, expense, receipt, adjustment
- `payment_method_type`: cash, bank, mobile_banking
- `payment_status_type`: paid, partial, pending

### RLS Policy Pattern
Every tenant-scoped table follows:
1. **Super admin full access** — `is_super_admin()`
2. **Dealer admin manage** — `dealer_id = get_user_dealer_id(auth.uid()) AND has_role(auth.uid(), 'dealer_admin')`
3. **Dealer users view** — `dealer_id = get_user_dealer_id(auth.uid())`
4. **Salesman create** — `dealer_id = get_user_dealer_id(auth.uid()) AND has_role(auth.uid(), 'salesman')`
5. **Subscription guard** — `has_active_subscription()` for write operations

---

## Authentication & Authorization

### Auth Flow
1. **Self-signup** (`/get-started`): Calls `self-signup` edge function → Creates dealer + user + profile + role + subscription + invoice_sequences
2. **Login** (`/login`): Supabase Auth → AuthContext loads profile, roles, subscription
3. **Session**: Supabase manages JWT sessions with auto-refresh

### Roles
| Role | Permissions |
|---|---|
| `super_admin` | Full platform access, all dealers |
| `dealer_admin` | Full access to own dealer data, user management |
| `salesman` | Create sales, challans, deliveries. Cannot edit/delete sales, update products, or access reports |

### Access Levels
| Level | Condition | Behavior |
|---|---|---|
| `full` | Active subscription | All operations allowed |
| `grace` | Expired within 3 days | Write operations allowed with warning |
| `readonly` | Expired beyond grace | View only, no write operations |
| `blocked` | Suspended or no subscription | Redirected to blocked page |

---

## Subscription System

### Plans (subscription_plans table)
| Plan | Monthly (BDT) | Yearly (BDT) | Users | Features |
|---|---|---|---|---|
| Starter | 999 | 10,000 | 1 | Barcodes, Email |
| Pro | 2,000 | 20,000 | 2 | + SMS, Credit limits, Analytics |
| Business | 3,000 | 30,000 | 5 | + Multi-branch, Audit logs, Delivery |

### Lifecycle
```
Registration → Trial (7 days) → Active → Expiring Soon (≤7 days) → Grace (3 days) → Expired → Suspended
```

### Payment Recording
- Super admin records payments in `subscription_payments`
- Full payment auto-extends subscription end_date
- Duplicate payment prevention for same period
- Yearly discount eligibility check (2 months free, first year only)

---

## Notifications (SMS & Email)

### SMS (BulkSMSBD)
- Gateway: `http://bulksmsbd.net/api/smsapi`
- Used for: Sale notifications, daily summaries, registration alerts
- Configured via edge function secrets

### Email (SMTP/Gmail)
- Server: `smtp.gmail.com:587`
- Used for: Welcome emails, sale receipts, daily summaries, admin alerts
- Requires Gmail App Password (not regular password)

### Notification Triggers
1. **New Sale**: SMS + Email to dealer owner
2. **Daily Summary**: Scheduled via cron (02:00 AM)
3. **New Dealer Registration**: SMS + Email to dealer AND super admin
4. **Subscription Events**: Status change notifications

---

## Edge Functions

| Function | Purpose | Auth Required |
|---|---|---|
| `self-signup` | Register new dealer account | No |
| `send-notification` | Send SMS/Email | Yes |
| `check-subscription-status` | Validate subscription | Yes |
| `create-dealer-user` | Add user to dealer | Yes |
| `daily-summary` | Generate daily reports | Cron |
| `reset-dealer-password` | Password reset | Yes |
| `submit-contact` | Public contact form | No |
| `test-smtp` | Test email configuration | Yes |

---

## Multi-Tenancy

### Implementation
- Every data table has `dealer_id` column
- `useDealerId()` hook extracts dealer_id from auth context
- RLS policies enforce `dealer_id = get_user_dealer_id(auth.uid())`
- `get_user_dealer_id()` is a `SECURITY DEFINER` function to prevent recursion

### Data Isolation Rules
1. Frontend: `useDealerId()` hook required for all data operations
2. Database: RLS policies on every tenant-scoped table
3. Backend: Tenant middleware validates dealer_id
4. Edge Functions: Extract dealer_id from auth token

---

## Modules Reference

### Products Module
- CRUD with barcode support
- Categories: Tiles (box_sft), Sanitary (piece)
- Stock tracking with reserved quantities
- Reorder level alerts
- Purchase & sales history dialogs
- Bulk import via Excel

### Sales Module
- Direct invoice & POS modes
- Auto invoice numbering per dealer
- Profit calculation (COGS, gross, net)
- Credit limit enforcement with override
- Challan generation from sales
- Payment mode tracking

### Purchase Module
- Supplier-linked purchases
- Landed cost calculation (rate + transport + labor + other)
- Last purchase rate display
- Average cost tracking

### Ledger Module
- Customer ledger (sales, payments, refunds)
- Supplier ledger (purchases, payments)
- Cash ledger
- Expense ledger
- Balance summaries

### Reports Module
- Sales reports (daily, monthly, by product, by customer)
- Purchase reports
- Stock reports (summary, movement, reorder)
- Profit reports
- Credit reports
- Collection reports
- Super admin revenue reports

---

## API Endpoints

### Backend (Express — Port 3003)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login (rate-limited) |
| POST | `/api/auth/refresh` | Refresh token |

### Supabase (via client SDK)
All data operations go through the Supabase JS client with RLS enforcement.

---

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

Test files in `src/test/`:
- `example.test.ts` — Basic setup verification
- `challanService.test.ts` — Challan service tests
- `saleAndChallanFlow.test.ts` — Integration flow tests
- `subscription.test.ts` — Subscription logic tests

---

## Deployment

See `docs/DEPLOYMENT_COMMANDS.md` for detailed commands.

### Quick Deploy (One-liner)
```bash
cd /var/www/tilessaas && git pull && npm install && npm run build && \
cd backend && npm install && set -a && . .env && set +a && \
npx knex migrate:latest --knexfile src/db/knexfile.ts && \
pm2 restart tilessaas-api && pm2 save && sleep 2 && \
curl -s http://127.0.0.1:3003/api/health
```

### Server Details
- **VPS IP:** 187.77.144.38
- **Domain:** tserp.digiwebdex.com
- **Project Dir:** /var/www/tilessaas
- **Backend Port:** 3003
- **DB Port:** 5440
- **PM2 Process:** tilessaas-api

---

## Security

### Implemented
- RLS on all data tables
- Role-based access control (RBAC)
- Subscription-based write guards
- JWT with refresh token rotation
- Rate limiting (general + auth)
- Security headers (Helmet)
- CORS configuration
- Login attempt tracking & lockout
- Audit logging for sensitive operations
- Input validation (Zod schemas)
- SQL injection prevention (parameterized queries)

### Critical Rules
- Never store roles on profiles table (use `user_roles` table)
- Never check admin status client-side
- Never expose private keys in frontend code
- Always use `SECURITY DEFINER` functions for cross-table checks
- Always enforce `dealer_id` isolation in queries

---

## Troubleshooting

### Common Issues

**1. "No dealer_id found" Error**
- User's profile is not linked to a dealer
- Check `profiles` table for `dealer_id`

**2. RLS Policy Denied**
- User doesn't have correct role
- Subscription is expired
- dealer_id mismatch

**3. Edge Function Fails**
- Check secrets are configured in Lovable Cloud
- Check edge function logs

**4. SMS Not Sending**
- Verify `BULKSMSBD_API_KEY` in edge function secrets
- Check API balance on BulkSMSBD dashboard

**5. Email Not Sending**
- Verify Gmail App Password (not regular password)
- Enable "Less secure apps" or use App Password
- Check SMTP secrets in edge functions

**6. Build Fails on VPS**
- Run `npx update-browserslist-db@latest`
- Check Node.js version (requires 20+)

**7. PM2 Restart Loop**
- Check backend logs: `pm2 logs tilessaas-api`
- Verify `.env` file has all required variables
- Verify database connection: `curl http://127.0.0.1:3003/api/health`
