# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

TilesERP (SaniTiles ERP) is a multi-tenant SaaS ERP for tiles/sanitary dealers. The repo contains:

- **Frontend** (React/Vite SPA) at repo root — dev server on **port 8080**
- **Backend** (Express + Knex) in `backend/` — API on **port 3003** (`/api/health`)
- **PostgreSQL 16** — local dev uses **port 5440**, user/db `tileserp` (see `backend/.env.example`)

Auth/data routing is controlled by `VITE_AUTH_BACKEND` and per-resource `VITE_DATA_*` flags (`src/lib/env.ts`). On `localhost`, auth defaults to **Supabase** unless `VITE_AUTH_BACKEND=vps` is set.

### Standard commands

See `package.json` and `backend/package.json`:

| Task | Command |
|------|---------|
| Frontend dev | `npm run dev` (root) |
| Backend dev | `cd backend && npm run dev` |
| Frontend tests | `npm test` |
| Frontend lint | `npm run lint` (many pre-existing issues in `supabase/functions/`) |
| Backend build | `cd backend && npm run build` |
| DB migrations | `cd backend && npm run migrate:latest` |

### Local full-stack (VPS mode) startup

PostgreSQL must be running on `127.0.0.1:5440` before the backend starts. On a fresh VM, start it with:

```bash
sudo pg_ctlcluster 16 main start
```

1. Copy env files: `.env` (frontend Supabase keys) and `backend/.env` from `backend/.env.example` (set `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `CORS_ORIGIN=http://localhost:8080`).
2. Run migrations: `cd backend && npm run migrate:latest`
3. Start backend: `cd backend && npm run dev`
4. Start frontend with VPS auth:

```bash
VITE_AUTH_BACKEND=vps VITE_VPS_API_BASE=http://localhost:3003 npm run dev
```

Demo login (after seeding or manual user creation): `dealer@tileserp.com` / `Demo@12345`.

**Note:** `backend/src/scripts/seedDemoAccounts.ts` may fail on fresh migrations because it inserts a `plan` column into `subscriptions`; the schema uses `plan_id` instead. Manual SQL seeding or fixing the script may be required.

### Gotchas

- **CORS:** Backend `CORS_ORIGIN` must include `http://localhost:8080` for local VPS auth.
- **Lint:** `npm run lint` reports ~1800+ pre-existing errors (mostly `no-explicit-any` in `supabase/functions/`).
- **Tests:** `npm test` passes most unit tests; ~36 integration tests fail without VPS auth mocks when services call the live API.
- **Docker:** Not required for local dev; `docker-compose.prod.yml` maps Postgres to **5435** (not 5440).
- **Supabase-only path:** With only `.env` Supabase keys and no `VITE_AUTH_BACKEND=vps`, frontend + Supabase Cloud is enough for landing/login UI; VPS backend is optional.

### Documentation

- `docs/DEVELOPER_DOCS.md` — architecture and modules
- `docs/ENVIRONMENT.md` — env var reference
- `RESOURCE_LOCK.md` — locked production ports/paths (API 3003, DB 5440, Vite 8080)
