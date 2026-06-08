# VPS Fresh Deploy — SaniTiles ERP

**For deployment stage / empty database.** Follow this when migrations fail with `password authentication failed for user "postgres"`.

---

## Root cause

Your `backend/.env` likely has:

```
DATABASE_URL=postgres://postgres:WRONG_PASSWORD@localhost:5432/...
```

SaniTiles expects:

| Setting | Value |
|---------|-------|
| User | `tileserp` (NOT `postgres`) |
| Port | `5440` (locked — see RESOURCE_LOCK.md) |
| Database | `tileserp` |
| Config file | `/var/www/tilessaas/.env` (root, not backend) |

---

## Quick fix (5 minutes)

### Step 1 — Run DB doctor

```bash
cd /var/www/tilessaas
git pull origin main
bash scripts/vps-db-doctor.sh
```

This shows which env file and DB user you're using.

### Step 2 — Fix root `.env` (recommended)

Edit `/var/www/tilessaas/.env`:

```bash
nano /var/www/tilessaas/.env
```

Set these (use ONE strong password everywhere):

```env
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5440
DB_USER=tileserp
DB_NAME=tileserp
DB_PASSWORD=YOUR_STRONG_PASSWORD_HERE

PORT=3003
JWT_SECRET=<64 char hex>
JWT_REFRESH_SECRET=<64 char hex>
CORS_ORIGIN=https://sanitileserp.com,https://www.sanitileserp.com,https://app.sanitileserp.com,https://portal.sanitileserp.com
VITE_AUTH_BACKEND=vps
VITE_VPS_API_BASE=https://api.sanitileserp.com
```

Generate secrets:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -base64 24 | tr -d '/+=' | head -c 32   # DB_PASSWORD
```

### Step 3 — Remove bad DATABASE_URL from backend/.env

```bash
nano /var/www/tilessaas/backend/.env
```

**Delete any line** starting with `DATABASE_URL=postgres://postgres`

The app now builds `DATABASE_URL` automatically from `DB_PASSWORD`.

### Step 4 — Create tileserp database user (if not exists)

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE tileserp WITH LOGIN PASSWORD 'YOUR_STRONG_PASSWORD_HERE';
CREATE DATABASE tileserp OWNER tileserp;
GRANT ALL PRIVILEGES ON DATABASE tileserp TO tileserp;
SQL
```

Use the **same password** as `DB_PASSWORD` in `.env`.

### Step 5 — Test connection

```bash
cd /var/www/tilessaas/backend
export NODE_ENV=production
set -a && source /var/www/tilessaas/.env && set +a
npx tsx src/scripts/dbDoctor.ts
```

Expected: `✅ Database connection OK`

### Step 6 — Run migrations + restart

```bash
npx knex migrate:latest --knexfile src/db/knexfile.ts
npm run build
pm2 restart tilessaas-api && pm2 save
curl -s http://127.0.0.1:3003/api/health
```

Expected:

```json
{"status":"healthy","services":{"database":"connected","api":"running"}}
```

### Step 7 — Rebuild frontend + browser

```bash
cd /var/www/tilessaas
npm run build
```

In browser: **Logout → Login → Hard refresh (Ctrl+Shift+R)**

---

## One-command fresh setup (empty VPS)

If you want to reset everything automatically:

```bash
cd /var/www/tilessaas
git pull origin main
bash scripts/vps-fresh-setup.sh
```

This creates the DB user, writes `.env`, runs migrations, and restarts PM2.

---

## After DB is connected — test purchase

1. Products → verify tile has **Per box SFT**
2. Purchases → New Purchase → add supplier + product + qty
3. Submit → should show **"Purchase saved & stock updated"**

---

## Common errors

| Error | Fix |
|-------|-----|
| `password authentication failed for user "postgres"` | Remove `DATABASE_URL` with postgres user; use `DB_PASSWORD` + `tileserp` user |
| `password authentication failed for user "tileserp"` | Password mismatch — reset with `ALTER ROLE tileserp WITH PASSWORD '...'` |
| `connection refused port 5440` | Postgres not running — `systemctl start postgresql` or start Docker db |
| `Not authenticated` on submit | Logout/login after deploy; hard refresh browser |
| `relation "approval_requests" does not exist` | Run `npx knex migrate:latest` |

---

## Do NOT use

- `postgres` superuser in DATABASE_URL
- Placeholder passwords (`GENERATE_`, `CHANGE_ME`)
- Sourcing only `backend/.env` — always use root `/var/www/tilessaas/.env` for DB config
