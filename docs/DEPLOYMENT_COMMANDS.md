# Deployment Commands — TilesERP

> Working deployment commands for VPS (tserp.digiwebdex.com)  
> **Last Verified:** 2026-04-14

---

## 🚀 Full Deployment (recommended)

```bash
cd /var/www/tilessaas && git pull origin main && bash scripts/vps-deploy.sh
```

This builds frontend + backend, runs migrations, and starts PM2 if missing.

### One-liner (manual)

```bash
cd /var/www/tilessaas && git pull origin main && npm install && npm run build && cd backend && npm install && export NODE_ENV=production && set -a && source /var/www/tilessaas/.env && set +a && npx knex migrate:latest --knexfile src/db/knexfile.ts && npm run build && (pm2 describe tilessaas-api >/dev/null 2>&1 && pm2 restart tilessaas-api || pm2 start dist/index.js --name tilessaas-api) && pm2 save && sleep 2 && curl -s http://127.0.0.1:3003/api/health
```

**Expected Output:** `{"status":"healthy","services":{"database":"connected","api":"running"}}`

---

## 📋 Step-by-Step Breakdown

### Step 1: Pull Latest Code
```bash
cd /var/www/tilessaas
git pull origin main
```

### Step 2: Install Frontend Dependencies
```bash
npm install
```

### Step 3: Build Frontend (Static Assets)
```bash
npm run build
```
**Output:** `dist/` folder → served by Nginx  
**Expected:** ~11s build time, ~2.2 MB JS bundle

### Step 4: Install Backend Dependencies
```bash
cd backend
npm install
```

### Step 5: Load Environment Variables
```bash
# Use ROOT env (not backend/.env) for database config
set -a && source /var/www/tilessaas/.env && set +a
```
**Note:** Set `DB_PASSWORD`, `DB_USER=tileserp`, `DB_PORT=5440` in `/var/www/tilessaas/.env`.  
**Do NOT** use `DATABASE_URL=postgres://postgres:...` — see `docs/VPS_FRESH_DEPLOY.md`.

### Step 6: Run Database Migrations
```bash
npx knex migrate:latest --knexfile src/db/knexfile.ts
```
**Expected:** "Already up to date" or migration output

### Step 6b: Build Backend (required before PM2 restart)
```bash
npm run build
```
If this fails with TypeScript errors in `src/routes/assets.ts` etc., run `git pull origin main` — those files were fixed on main.

### Step 7: Restart Backend
```bash
if pm2 describe tilessaas-api >/dev/null 2>&1; then
  pm2 restart tilessaas-api --update-env
else
  pm2 start dist/index.js --name tilessaas-api --update-env
fi
pm2 save
```

### Step 8: Verify Health
```bash
sleep 2
curl -s http://127.0.0.1:3003/api/health
```
**Expected:** `{"status":"ok","database":"connected"}`

---

## ⚡ Quick Deploy Variants

### Frontend-Only (No Backend Changes)
```bash
cd /var/www/tilessaas && git pull && npm install && npm run build
```
No PM2 restart needed — Nginx serves static files from `dist/`.

### Backend-Only (No Frontend Changes)
```bash
cd /var/www/tilessaas && git pull && cd backend && npm install && set -a && . .env && set +a && npx knex migrate:latest --knexfile src/db/knexfile.ts && pm2 restart tilessaas-api && pm2 save && sleep 2 && curl -s http://127.0.0.1:3003/api/health
```

### Hot Restart (No Code Pull)
```bash
cd /var/www/tilessaas/backend && pm2 restart tilessaas-api && pm2 save
```

---

## 🔧 PM2 Commands

```bash
# List all processes
pm2 list

# View live logs
pm2 logs tilessaas-api

# View last N log lines
pm2 logs tilessaas-api --lines 200

# Real-time monitoring
pm2 monit

# Restart
pm2 restart tilessaas-api

# Stop
pm2 stop tilessaas-api

# Delete process
pm2 delete tilessaas-api

# Start fresh (from project root)
pm2 start backend/dist/index.js --name tilessaas-api

# Save current process list (persist on reboot)
pm2 save

# Generate startup script (run once after first setup)
pm2 startup
```

---

## 🌐 Nginx Commands

```bash
# Test configuration (always do this before reload!)
sudo nginx -t

# Reload without downtime
sudo systemctl reload nginx

# Full restart
sudo systemctl restart nginx

# Check status
systemctl status nginx

# View error logs
sudo tail -f /var/log/nginx/error.log

# View access logs
sudo tail -f /var/log/nginx/access.log

# View last 100 errors
sudo tail -100 /var/log/nginx/error.log
```

---

## 🔒 SSL Certificate (Let's Encrypt)

```bash
# Check certificate status
sudo certbot certificates

# Renew (auto if <30 days remaining)
sudo certbot renew

# Force renewal
sudo certbot renew --force-renewal

# Test renewal (dry run)
sudo certbot renew --dry-run
```

---

## 🗄️ Database Commands

```bash
# Connect to PostgreSQL CLI
psql -h localhost -p 5440 -U tileserp -d tileserp

# Run all pending migrations
cd /var/www/tilessaas/backend
set -a && . .env && set +a
npx knex migrate:latest --knexfile src/db/knexfile.ts

# Rollback last migration batch
npx knex migrate:rollback --knexfile src/db/knexfile.ts

# Check migration status
npx knex migrate:status --knexfile src/db/knexfile.ts

# Create new migration file
npx knex migrate:make migration_name --knexfile src/db/knexfile.ts

# Run seed data
npx knex seed:run --knexfile src/db/knexfile.ts

# Backup database
pg_dump -h localhost -p 5440 -U tileserp tileserp > /tmp/tileserp_backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
psql -h localhost -p 5440 -U tileserp tileserp < /path/to/backup.sql

# Quick table count check
psql -h localhost -p 5440 -U tileserp -d tileserp -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
```

---

## 🔍 Debugging Commands

### Service Health Checks
```bash
# API health
curl -s http://127.0.0.1:3003/api/health

# Check port 3003 (backend)
ss -tlnp | grep 3003

# Check port 5440 (database)
ss -tlnp | grep 5440

# Check nginx
systemctl status nginx

# Check all PM2 processes
pm2 list
```

### Resource Monitoring
```bash
# Disk usage
df -h
du -sh /var/www/tilessaas
du -sh /var/www/tilessaas/node_modules
du -sh /var/www/tilessaas/dist

# Memory
free -h

# CPU & processes
htop

# PM2 resource monitor
pm2 monit
```

### Log Inspection
```bash
# Backend app logs (live)
pm2 logs tilessaas-api

# Backend app logs (last 200 lines)
pm2 logs tilessaas-api --lines 200

# Nginx access log (live)
sudo tail -f /var/log/nginx/access.log

# Nginx error log (live)
sudo tail -f /var/log/nginx/error.log

# System journal for nginx
sudo journalctl -u nginx --since "1 hour ago"

# Search logs for errors
pm2 logs tilessaas-api --lines 500 | grep -i error
```

---

## 🔄 Rollback Procedures

### Rollback to Previous Commit
```bash
cd /var/www/tilessaas

# View recent commits
git log --oneline -10

# Checkout specific commit
git checkout <commit-hash>

# Rebuild
npm install && npm run build

# Rollback backend migration if needed
cd backend
set -a && . .env && set +a
npx knex migrate:rollback --knexfile src/db/knexfile.ts

# Restart
pm2 restart tilessaas-api && pm2 save

# Return to main branch later
git checkout main
```

### Emergency Database Restore
```bash
# Stop API to prevent writes
pm2 stop tilessaas-api

# Restore from backup
psql -h localhost -p 5440 -U tileserp tileserp < /path/to/backup.sql

# Restart
pm2 start tilessaas-api && pm2 save
```

---

## 📦 Git Commands

```bash
# Current branch
git branch

# Check remote status
git fetch origin && git status

# View recent commits
git log --oneline -10

# View recent changes (files only)
git log --name-only -5

# Discard local changes (CAUTION)
git checkout -- .

# Hard reset to remote (CAUTION — DESTRUCTIVE)
git reset --hard origin/main
```

---

## ⚠️ RESOURCE LOCK RULES

> See `RESOURCE_LOCK.md` for complete policy.

1. **NEVER** change backend port → **3003** (locked)
2. **NEVER** change database port → **5440** (locked)
3. **NEVER** change project directory → `/var/www/tilessaas` (locked)
4. **NEVER** change PM2 process name → `tilessaas-api` (locked)
5. **NEVER** change Nginx proxy_pass target
6. **ALWAYS** run `pm2 save` after restart
7. **ALWAYS** verify health check after deployment
8. **ALWAYS** backup database before destructive operations
9. Backend `.env` is NOT in git — maintain directly on VPS
10. Supabase Cloud migrations auto-apply — NOT on VPS
