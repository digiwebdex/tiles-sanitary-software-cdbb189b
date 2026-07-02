# Security Documentation — TilesERP

---

## Authentication

### VPS JWT (Production — dealer app)
- Email/password via `POST /api/auth/login`
- 15-minute access tokens, 7-day refresh tokens with rotation
- bcryptjs password hashing (12 rounds)
- Tokens stored in localStorage on the SPA (see hardening backlog)
- Login lockout: 3 failures / 30 minutes (`login_attempts` table)

### Supabase Auth (Customer portal — until Phase 6)
- `portal.sanitileserp.com` still uses Supabase Auth
- VPS portal foundation: migration 066 + `/api/portal/context` (see `docs/PHASE6_PORTAL_MIGRATION.md`)

### Legacy note
The dealer app no longer uses Supabase as primary auth. See `docs/DATA_PATH.md`.

### Login Protection
- Rate limiting: 20 attempts per 15 minutes
- Account lockout after repeated failures
- Failed attempts tracked in `login_attempts` table
- IP address logging

---

## Authorization

### Role-Based Access Control (RBAC)
| Role | Data Access | Write Access | Admin Functions |
|---|---|---|---|
| super_admin | All dealers | All | Yes |
| dealer_admin | Own dealer | Full | User management |
| salesman | Own dealer (read) | Create only | None |

### Row-Level Security (RLS)
Every tenant-scoped table enforces:
1. `is_super_admin()` — Full access for platform admins
2. `get_user_dealer_id(auth.uid())` — Data isolation per dealer
3. `has_role(auth.uid(), role)` — Role-based write restrictions
4. `has_active_subscription()` — Subscription-based write guards

### Critical Security Functions
```sql
-- SECURITY DEFINER prevents RLS recursion
CREATE FUNCTION is_super_admin() RETURNS boolean
  SECURITY DEFINER SET search_path = public;

CREATE FUNCTION has_role(_user_id uuid, _role app_role) RETURNS boolean
  SECURITY DEFINER SET search_path = public;

CREATE FUNCTION get_user_dealer_id(_user_id uuid) RETURNS uuid
  SECURITY DEFINER SET search_path = public;
```

---

## Data Protection

### Tenant Isolation
- All data queries include `dealer_id` filter
- `useDealerId()` hook enforces client-side
- RLS policies enforce server-side
- No cross-tenant data access possible

### Sensitive Data
- Passwords: bcryptjs hashed (never stored plain)
- JWT secrets: Minimum 32 characters, stored in `.env`
- API keys: Stored as edge function secrets
- No secrets in frontend code

### Audit Trail
- All sensitive operations logged in `audit_logs`
- Subscription bypass attempts tracked
- Credit override reasons recorded
- Login failures tracked with IP

---

## Infrastructure Security

### Nginx
- SSL/TLS via Let's Encrypt (auto-renewal)
- Security headers: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy
- Request size limit: 20MB

### Express (Helmet)
- Content Security Policy
- DNS Prefetch Control
- Frameguard
- Hide Powered-By
- HSTS
- IE No Open
- XSS Filter

### Rate Limiting
| Endpoint | Limit | Window |
|---|---|---|
| General API | 200 requests | 15 minutes |
| Auth endpoints | 20 requests | 15 minutes |

### CORS
- Configured per environment
- Only allowed origins can make requests
- Credentials supported

---

## Security Checklist

- [x] RLS enabled on all data tables
- [x] Roles stored in separate `user_roles` table (not profiles)
- [x] SECURITY DEFINER functions for cross-table checks
- [x] Subscription guard on write operations
- [x] Rate limiting on all API endpoints
- [x] Security headers (Helmet + Nginx)
- [x] Input validation (Zod schemas)
- [x] SQL injection prevention (parameterized queries)
- [x] Password hashing (bcryptjs)
- [x] JWT with refresh rotation
- [x] SSL/TLS encryption
- [x] Audit logging
- [x] Login attempt tracking & lockout
- [x] No secrets in frontend code
- [x] Environment variables for all credentials
