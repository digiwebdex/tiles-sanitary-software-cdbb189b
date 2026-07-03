# Secrets Rotation & Git Hygiene Runbook

**Last updated:** 2026-06-23  
**Applies to:** `/var/www/tilessaas` production on Hostinger VPS

---

## Why

`.env` and `.env.production` were previously tracked in git. Even after `git rm --cached`,
secrets may remain in git history. Rotate all credentials and scrub history before the
next public push or collaborator onboarding.

---

## Step 1 — Stop tracking env files (done)

`.gitignore` now excludes:

- `.env`, `.env.*` (except `.env.example`)
- `backend/.env`, `backend/.env.*` (except `backend/.env.example`)

Verify:

```bash
git ls-files | grep -E '\.env'   # should only show *.example files
```

---

## Step 2 — Rotate secrets (production)

Generate new values on the VPS:

```bash
# JWT (min 32 chars each)
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 24   # RESTORE_TOKEN_SECRET (optional dedicated)

# Database — change PostgreSQL password for tileserp user
sudo -u postgres psql -c "ALTER USER tileserp PASSWORD 'NEW_STRONG_PASSWORD';"
```

Update on server (not in git):

| File | Keys to rotate |
|------|----------------|
| `backend/.env` | `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `RESTORE_TOKEN_SECRET` |
| `backend/.env` | `SMTP_PASS`, `BULKSMSBD_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| `.env.production` | `VITE_SUPABASE_*` (until portal Phase 6 cutover) |

After editing:

```bash
cd /var/www/tilessaas/backend && pm2 restart tilessaas-api
```

All users will need to log in again (JWT invalidation).

---

## Step 3 — Remove backup env files from disk

```bash
cd /var/www/tilessaas
rm -f .env.backup.* .env.production.bak.*
```

---

## Step 4 — Scrub git history (if repo was ever pushed with secrets)

**Warning:** Rewrites history. Coordinate with all developers.

```bash
# Option A: git-filter-repo (recommended)
pip install git-filter-repo
git filter-repo --path .env --path .env.production --invert-paths

# Option B: BFG Repo-Cleaner
bfg --delete-files .env
bfg --delete-files .env.production
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

Force-push only after team agreement:

```bash
git push origin main --force-with-lease
```

---

## Step 5 — Verify

```bash
# No secrets in tracked files
git grep -E 'JWT_SECRET=|password=|api[_-]?key' -- ':!*.example' ':!docs/*'

# API healthy after restart
curl -s http://127.0.0.1:3003/api/health | jq .
```

---

## Ongoing rules

1. Never commit `.env`, `.env.production`, or `*.bak` env files.
2. Use `backend/.env.example` and `.env.example` for documentation only (placeholder values).
3. Store production secrets in a password manager or Hostinger env vault.
4. Run `npm audit` quarterly on frontend and backend.
