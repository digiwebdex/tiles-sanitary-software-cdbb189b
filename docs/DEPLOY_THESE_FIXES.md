# Deploy the audit fixes — step by step (your real setup)

Written for a non-developer. Your live ERP runs under **PM2** as `tilessaas-api`
from `/var/www/tilessaas/backend/dist/index.js`, database **`tileserp`** on
`127.0.0.1:5440`. Deploy = SSH + git + build + migrate + PM2 restart.

The fixes are on branch **`fixes-on-live`** (built on top of your real live code,
already on GitHub). It adds 2 database updates: **081** and **082**.

Do the steps **in order**. Don't skip the backup.

---

## ⚠️ Know before you start
- Your live code is safely backed up on GitHub as branch **`server-live-snapshot`**
  (this was done for you). `fixes-on-live` = that snapshot **plus** the 24 fixes.
- **Profit numbers change for VAT-registered dealers** — VAT/SD are now correctly
  treated as tax owed, not income. This is the *correct* number. VAT-off dealers:
  no change.
- The duplicate-invoice-number check was already run against your live DB — **it
  came back clean**, so update 082 will apply fine.

## Step 1 — Back up the database (your undo button)
```bash
cd /var/www/tilessaas
# direct, reliable dump of the live ERP DB:
export PGPASSWORD="$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2-)"
pg_dump -h 127.0.0.1 -p 5440 -U tileserp -d tileserp -Fc \
  -f "/root/tileserp_backup_$(date +%Y%m%d_%H%M%S).dump"
unset PGPASSWORD
ls -lh /root/tileserp_backup_*.dump   # confirm a file was created
```
Keep that `.dump` file. (Or use `bash scripts/backup.sh` if you prefer.)

## Step 2 — Get the fixes onto the server
```bash
cd /var/www/tilessaas
git fetch origin
git merge --ff-only origin/fixes-on-live
```
If `--ff-only` errors, run `git status` and send me the output before continuing.

## Step 3 — Build + apply the 2 database updates + restart the API
```bash
cd /var/www/tilessaas/backend
npm ci                 # install exact deps (safe)
npm run build          # compile TypeScript -> dist
npm run migrate:latest # applies updates 081 and 082 (uses backend/.env)
pm2 restart tilessaas-api
pm2 logs tilessaas-api --lines 40   # watch for a clean start (Ctrl+C to exit)
```
Expected: migrations report **081** and **082** as "Batch ... run", and the API
logs show it started with the database connected.
If update 082 complains about duplicates, it will list them — stop and send me
that message (we already checked and it was clean, so this is unlikely).

## Step 4 — Rebuild the website (frontend)
```bash
cd /var/www/tilessaas
npm ci
npm run build          # regenerates /var/www/tilessaas/dist
```
Your web server (nginx) serves the site from the `dist` folder, so this updates
the live site. If your nginx serves from a different folder, copy `dist/*` there.
(Not sure? Send me `grep -ri 'root ' /etc/nginx/ | grep -i tiles` and I'll tell you.)

## Step 5 — Verify
1. Open https://app.sanitileserp.com and log in — loads normally.
2. Create a test sale + a return — no errors.
3. Open a Profit & Loss report for a VAT dealer — profit reflects ex-VAT revenue,
   and VAT/SD show as separate liabilities.
4. (Optional) confirm rate limiting: many bad logins now return "Too many login
   attempts" after 20 tries.

## How to UNDO
- **Code:** `cd /var/www/tilessaas && git checkout server-live-snapshot`,
  then redo Step 3 build + `pm2 restart tilessaas-api` and Step 4 frontend build.
- **Database (updates 081/082):**
  ```bash
  cd /var/www/tilessaas/backend
  npm run migrate:rollback   # undoes 082
  npm run migrate:rollback   # undoes 081
  ```
- **Full DB restore** from Step 1 backup:
  ```bash
  export PGPASSWORD="$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2-)"
  pg_restore -h 127.0.0.1 -p 5440 -U tileserp -d tileserp --clean --if-exists \
    /root/tileserp_backup_YYYYMMDD_HHMMSS.dump
  unset PGPASSWORD
  ```

---

## If anything looks wrong
Send me the **step number** and the **exact terminal output**. Safe order is
always: **backup → merge → build → migrate → restart → verify → (undo if needed).**
