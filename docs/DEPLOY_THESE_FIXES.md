# How to deploy these fixes (simple, step-by-step)

This guide is written for someone who is **not** a developer. Follow it in order.
Don't skip the "check first" and "how to undo" parts.

The code changes are already written, committed, and both the backend and
frontend build successfully. What's left is: get the code to GitHub, let your
server pick it up, run two small database updates, and check it worked.

---

## What changed (one line)
Fixes for money/stock bugs, access control, tax reports, and safety — see
`docs/PRODUCTION_READINESS_AUDIT.md` for the full list.

## ⚠️ Two things you MUST know before deploying
1. **Two database migrations run on deploy** (`066_journal_soft_void` and
   `067_document_number_unique`). Migration **067 will stop with an error if you
   already have duplicate invoice/challan/delivery numbers.** That's on purpose —
   fix the duplicates first (Step 2 shows how to check).
2. **Profit numbers change for VAT-registered dealers.** VAT and SD are now
   correctly treated as tax you owe the government, not as your income. Your
   Profit & Loss and Trial Balance will show lower (correct) profit than before.
   Dealers with VAT turned off see **no change**.

---

## Step 1 — Push the code to GitHub
The commit is on branch `claude/sweet-mccarthy-9a4489`. This machine has no
GitHub login, so push from your own computer (or fix the token here).

```bash
# set your real GitHub token (get one at github.com → Settings → Developer
# settings → Personal access tokens). Keep it secret.
git remote set-url origin https://<YOUR_TOKEN>@github.com/digiwebdex/tiles-sanitary-software-cdbb189b.git
git push -u origin claude/sweet-mccarthy-9a4489
```

Then on GitHub, open a Pull Request from `claude/sweet-mccarthy-9a4489` into
`main`, review, and merge it. (If your server deploys from `main`, merging is
what triggers the deploy.)

## Step 2 — BEFORE deploying: check for duplicate document numbers
Run these against your **production database** (read-only, safe). If any return
rows, de-duplicate them before deploying, or migration 067 will fail.

```sql
SELECT dealer_id, invoice_number, COUNT(*) FROM sales
  WHERE invoice_number IS NOT NULL AND invoice_number <> ''
  GROUP BY dealer_id, invoice_number HAVING COUNT(*) > 1;

SELECT dealer_id, challan_no, COUNT(*) FROM challans
  WHERE challan_no IS NOT NULL AND challan_no <> ''
  GROUP BY dealer_id, challan_no HAVING COUNT(*) > 1;

SELECT dealer_id, delivery_no, COUNT(*) FROM deliveries
  WHERE delivery_no IS NOT NULL AND delivery_no <> ''
  GROUP BY dealer_id, delivery_no HAVING COUNT(*) > 1;
```
No rows returned = you're good.

## Step 3 — Take a database backup (always)
Your project already has a backup script:
```bash
bash scripts/backup.sh
```
Keep the backup file somewhere safe. This is your undo button for the migrations.

## Step 4 — Deploy
- If you use **Coolify**: after the PR is merged (or the branch is pushed),
  Coolify redeploys automatically, or click **Redeploy** on the backend service.
- The backend must run the database migrations. If your deploy does NOT run them
  automatically, run them once after deploy:
  ```bash
  # from the backend service/container, with the DB env configured
  npm run migrate:latest
  ```
  (If a migration fails, read the error — 067 lists the duplicate rows to fix.)

## Step 5 — Verify it worked
1. Open https://app.sanitileserp.com and log in — the app should load normally.
2. Create a test sale, a return, and check a report — no errors.
3. Confirm rate limiting now works (ask your dev, or): repeated bad logins should
   start returning "Too many login attempts" after 20 tries in 15 minutes.
4. Check a Profit & Loss report for a VAT dealer — profit reflects ex-VAT revenue.

## How to UNDO if something goes wrong
- **Undo the code:** in Coolify, redeploy the previous version (or
  `git revert` the merge commit and redeploy).
- **Undo the migrations:**
  ```bash
  npm run migrate:rollback   # rolls back 067, then run again for 066
  ```
- **Restore the database** from the Step 3 backup if needed (see
  `docs/BACKUP_RESTORE.md`).

---

## If you get stuck
Tell your developer (or paste back here): which step, and the exact error
message. The safe order is always: **backup → check duplicates → deploy →
verify → (undo if needed).**
