# Production Data Path — Source of Truth

**Status:** VPS-primary as of Phase 3U cutover (2026)  
**Owner:** platform/architecture  
**Last updated:** 2026-06-23

## Decision

The production data path for **app.sanitileserp.com** is the **self-hosted VPS API**
(`backend/`) backed by **PostgreSQL** on the same server.

Supabase remains in use for:

- **Customer portal** auth (`portal.sanitileserp.com`)
- **Legacy edge functions** (signup, notifications, backups) until Phase 6
- **Historical SQL migrations** (`supabase/migrations/`) — not applied to VPS PG

## What this means in code

| Concern | Production path | Notes |
|---|---|---|
| Authentication (dealer app) | **VPS** (`/api/auth/*`) | JWT access + refresh; `AUTH_BACKEND=vps` on sanitileserp.com |
| Customers, Suppliers | **VPS** (`customerService`, `supplierService`) | Phase 3U-17 cutover; no Supabase fallback |
| Products | **VPS** via `dataClient` | `DATA_BACKENDS.PRODUCTS=vps` on sanitileserp.com |
| Sales, purchases, ledger, reports, HRM | **VPS** (`/api/*`) | Atomic transactions in Express routes |
| Challans, deliveries, returns | **VPS** | Stock/ledger side effects server-side |
| Customer portal | **Supabase auth** + mixed reads | Phase 6 will migrate to VPS |
| Backups | **VPS-local + Google Drive** | See `docs/BACKUP_RESTORE.md` |

## `dataClient` shadow mode

`src/lib/data/dataClient.ts` still supports per-resource `supabase` / `vps` / `shadow`
toggles via `VITE_DATA_*` env vars. On production hosts, core resources are set to
`vps` in `src/lib/env.ts` safety overrides.

Shadow mode is for **parity verification during migration**, not for production reads.

## Hard rules (enforced going forward)

1. **New dealer-app features** must read and write through VPS `/api/*` routes.
2. Do not add new Supabase write paths for dealer-app entities.
3. Portal-only features may continue using Supabase until Phase 6 ships.
4. Backend routes must enforce `tenantGuard` + `requireRole` on every mutation.
5. Financial mutations must route through `PostingOrchestrator` where applicable.

## Remaining migration (Phase 6)

1. Portal auth → VPS JWT (unified session model)
2. Portal reads → VPS API
3. Decommission unused Supabase edge functions
4. GL postings spine (`gl_postings` double-entry)

Until Phase 6 completes, this file is the source of truth: **VPS wins for the dealer app**.
