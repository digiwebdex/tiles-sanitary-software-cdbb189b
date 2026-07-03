# Dealer guide — Auto-backup to your own Google Drive

Each dealer connects their **own** Google account so their full data is backed
up to their **own** Google Drive — automatically every night, and on demand.

You do this **once**. It has two parts: create a small Google app (to get a
Client ID + Secret), then paste them into SaniTiles and connect.

---

## Part 1 — Create your Google app (one time, ~10 min)

1. Go to **https://console.cloud.google.com** and sign in with the Google
   account where you want your backups stored.
2. Top bar → **New Project** → name it `My Shop Backup` → **Create** (select it).
3. Left menu (☰) → **APIs & Services → Library** → search **Google Drive API** →
   **Enable**.
4. Left menu → **APIs & Services → OAuth consent screen**
   - User type **External** → **Create**
   - App name `My Shop Backup`, your email for support + developer → **Save and Continue**
   - **Scopes** → **Add or Remove Scopes** → search `drive.file` → tick
     **.../auth/drive.file** → **Update** → **Save and Continue**
   - **Test users** → **Add Users** → add **your own Gmail address** → **Save and Continue**
     (keeping it in "Testing" with yourself as a test user is fine — no publishing needed.)
5. Left menu → **APIs & Services → Credentials** → **+ Create Credentials →
   OAuth client ID**
   - Application type **Web application**, name `SaniTiles`
   - **Authorized redirect URIs → + Add URI** → paste **exactly**:
     `https://api.sanitileserp.com/api/dealer-drive/callback`
   - **Create**
6. A popup shows your **Client ID** (ends with `.apps.googleusercontent.com`) and
   **Client secret** (starts with `GOCSPX-`). Keep it open.

## Part 2 — Connect it in SaniTiles

1. In SaniTiles: **Settings → Data Backup → Google Drive Auto-Backup**.
2. Paste your **Client ID** and **Client Secret** → **Save credentials**.
3. Click **Connect Google Drive** → a Google window opens → sign in and **Allow**.
   (If you see “Google hasn’t verified this app”, click **Advanced → Go to … (unsafe)**
   — it’s your own app, so it’s safe.)
4. Done! You’ll see **Connected as your@gmail.com**.

## What happens next
- Every night, your full data (an Excel workbook) is uploaded to a
  **“SaniTiles Backups”** folder in your Google Drive.
- Use **Back up now** any time for an instant backup.
- **Disconnect** stops the auto-backup (your saved credentials stay so you can
  reconnect quickly).

## Troubleshooting
- **“redirect_uri_mismatch”** → the redirect URI in your Google app must be
  exactly `https://api.sanitileserp.com/api/dealer-drive/callback`.
- **“access_blocked” / app not verified** → make sure your Gmail is added as a
  **Test user** on the OAuth consent screen (Part 1, step 4).
- **“invalid_client”** → re-check the Client ID/Secret you pasted (no extra
  spaces).
