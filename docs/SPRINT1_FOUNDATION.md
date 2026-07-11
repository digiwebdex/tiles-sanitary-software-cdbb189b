# V2 Sprint 1 — Foundation Refactoring (Change Record)

**Branch:** `claude/sweet-mccarthy-9a4489` (isolated worktree — NOT deployed).
**Principle:** strictly additive, backward-compatible, **dry-run by default**. No production behaviour changes until `FEATURE_ENFORCEMENT=enforce` is deliberately set.

## What already existed and is REUSED unchanged
- **Authentication** — JWT (15m) + refresh (7d, SHA-256 hashed, rotating), bcrypt, TOTP, lockout. `middleware/auth.ts`, `authService`. *Unchanged.*
- **RBAC** — `middleware/roles.ts` `requireRole(...)`, 6-role `AppRole`. *Unchanged.*
- **Tenant isolation** — `middleware/tenant.ts` `tenantGuard` / `assertDealerMatch` (row-level `dealer_id`). *Unchanged.*
- **Subscription enforcement** — `middleware/subscription.ts` (server-clock paywall, fail-open). *Unchanged.*
- **Entitlements data model** — `authService.PlanFeatures` (15 flags + 3 limits) resolved per-tenant with `subscriptions.custom_features` overrides, carried in the JWT. **Reused as the shape/source.**
- **Frontend auth** — `AuthContext` already exposes `roles`, `planFeatures`, `isSuperAdmin`, etc. **Reused.**

## What Sprint 1 ADDED (new, additive)
| Layer | File | Purpose |
|---|---|---|
| Backend service | `backend/src/services/entitlementsService.ts` | Authoritative `getEntitlements(dealerId)` (all roles) + 60s cache + `FEATURE_ROUTE_MAP` + helpers |
| Backend middleware | `backend/src/middleware/requireFeature.ts` | `enforcePlanFeatures` (central) + `requireFeature(key)` (per-route); modes off/log/enforce |
| Backend config | `backend/src/config/env.ts` | `FEATURE_ENFORCEMENT` enum, default **`log`** |
| Backend route | `backend/src/routes/subscriptionStatus.ts` | `GET /api/subscription/entitlements` (features + limits + usage) |
| Backend wiring | `backend/src/index.ts` | mounts `enforcePlanFeatures` after the subscription guard (log mode) |
| Backend test | `backend/src/middleware/requireFeature.test.ts` | 11 unit tests |
| Frontend hook | `src/hooks/useEntitlements.ts` | plan features + limits + usage, server-authoritative |
| Frontend hook | `src/hooks/usePermission.ts` | RBAC helper (`has(...roles)`, `canAdminister`, …) |
| Frontend component | `src/components/access/FeatureGate.tsx` | `<FeatureGate feature="…">` plan-gate |
| Frontend component | `src/components/access/Can.tsx` | `<Can roles={[…]}>` role-gate |
| Docs | `docs/SPRINT1_FOUNDATION.md` | this record |

## Database changes
**NONE.** The `plans` feature flags/limits and `subscriptions.custom_features` already exist; no migration was required. (This is why Sprint 1 is zero-risk to production data.)

## API changes
- **Added (backward-compatible):** `GET /api/subscription/entitlements`.
- **Changed:** none. No existing endpoint's contract or behaviour changed.
- **Behavioural gate:** `enforcePlanFeatures` is mounted but ships in **`log`** mode → logs would-be blocks, blocks nothing.

## Enforcement modes (env `FEATURE_ENFORCEMENT`)
- `off` — middleware no-op.
- `log` — **default**; resolves entitlements, logs would-be blocks, always allows. Use this to gather real data on who would be affected before enforcing.
- `enforce` — blocks state-changing (non-GET) requests to features not in the dealer's plan (403 `FEATURE_NOT_IN_PLAN`); reads always allowed; super_admin/sa_employee bypass; fails open.

## Rollback strategy
1. **Instant, no deploy:** set `FEATURE_ENFORCEMENT=off` in the API's PM2 env and `pm2 restart tilessaas-api` → middleware becomes a no-op. (Even `log` mode is already non-blocking.)
2. **Code rollback:** the entire sprint is on branch `claude/sweet-mccarthy-9a4489`; it is **not merged/deployed**. To abandon: don't merge. To revert after merge: `git revert <sprint1 commit>` — all changes are additive files + 3 small additive edits (`env.ts`, `index.ts`, `subscriptionStatus.ts`), so revert is clean with no data implications.
3. **No DB rollback needed** — no migrations were run.

## Testing
- Backend: `cd backend && npx vitest run` → **53/53 pass** (11 new + 42 existing). `npx tsc --noEmit` clean.
- Frontend: `npx tsc --noEmit -p tsconfig.app.json` → new files clean (pre-existing `portalService.ts` Supabase errors are unrelated legacy, slated for a later sprint).

## Not done (deliberately deferred to later sprints)
- Applying `requireFeature`/`FeatureGate` to actual routes/pages beyond the central map (enforcement stays dry-run).
- Flipping `enforce` on (requires observing `log` output first).
- Per-tenant Feature Manager UI + override table (Super-Admin).
- Tenant-guard consistency on the few routes that read `req.user.dealerId` directly (safe today; hardening tracked for a later sprint).
