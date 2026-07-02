# Phase 6 — Portal VPS Migration Plan

**Last updated:** 2026-06-23  
**Status:** Foundation largely complete — VPS cutover ready behind flags (P6-03 ~90%)

---

## Goal

Move `portal.sanitileserp.com` from Supabase Auth + PostgREST/RPC reads to the **VPS Express API + PostgreSQL**, using the same JWT auth model as the dealer app (with portal-scoped authorization).

---

## Completed (this sprint)

| Item | File |
|------|------|
| VPS schema: `portal_users`, `portal_requests` | `backend/src/db/migrations/066_portal_foundation.ts` |
| Portal API — dashboard reads | `GET /api/portal/outstanding`, `/payments/recent`, `/ledger` |
| Portal API — data lists | `/quotations`, `/sales`, `/deliveries`, `/projects`, `/sites` |
| Portal API — project summary | `GET /api/portal/projects/:id/summary` |
| Portal session | `POST /bind`, `POST /touch-login`, `GET /context` |
| Dealer admin | `GET/PATCH /users`, `GET /requests`, `POST /users/invite`, `PATCH /requests/:id` |
| Portal requests | `POST /requests`, `GET /sales/:id/items` |
| Portal auth (frontend) | `portalAuthBridge.ts`, dual-path `PortalAuthContext`, VPS login on `PortalLoginPage` |
| Password change | `POST /api/auth/change-password` + `PortalAccountPage` VPS path |
| Frontend dual-path | `portalService.ts` — invite, requests, sale items, update request |
| Tests | `portalInviteService.test.ts` (3 cases) |

---

## Remaining work

### P6-03 — Portal reads on VPS API

1. **Auth cutover** — code ready; enable with `VITE_PORTAL_BACKEND=vps` on portal build
   - Portal login via `/api/auth/login` ✅
   - Bind on first login ✅
   - `portalGuard` middleware ✅

2. **Data endpoints** — all portal reads ✅ including document bundles and WhatsApp status

3. **Production cutover**
   - Run migration 066 on VPS
   - Sync existing `portal_users` from Supabase (or re-invite):
     ```bash
     cd /var/www/tilessaas/backend
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
       npx tsx src/scripts/syncPortalUsersFromSupabase.ts --dry-run
     ```
   - Set `VITE_PORTAL_BACKEND=vps` on `portal.sanitileserp.com` build
   - SMTP for invite emails (temp password shown in API response today)

### P6-04 — Portal payment requests ✅

- `portal_payment_requests` table (migration 067)
- Portal: notify payment on Statement page (bKash/Nagad/bank reference)
- Dealer: Portal Inbox → Payment notifications tab

### P6-01 / P6-02 — GL spine 🟡

- Migration `068_gl_spine_foundation.ts`: `gl_accounts`, `gl_journal_entries`, `gl_journal_lines`
- Default chart (cash, bank, AR, inventory, AP, VAT, sales, COGS, expenses)
- `USE_GL_SPINE=true` mirrors `posting_batches` → balanced journal entries
- `GET /api/gl/trial-balance`, `GET /api/gl/accounts`, `POST /api/gl/accounts/seed`
- **Requires** `USE_POSTING_ENGINE=true` for new posts to flow into GL
- P6-02 remaining: P&L and Balance Sheet from GL; run backfill for historical batches:
  ```bash
  cd backend && npx tsx src/scripts/backfillGlFromPostingBatches.ts --dealer-id <uuid>
  ```

---

## Deploy migration 066

```bash
cd /var/www/tilessaas/backend
npm run migrate:latest
pm2 restart tilessaas-api
```

Verify:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3003/api/portal/context
```

---

## Rollback

```bash
npm run migrate:rollback   # rolls back 066 only if it is the latest batch
```

Portal continues on Supabase until `VITE_PORTAL_BACKEND=vps` is enabled.
