/**
 * /api/dealer-drive — Per-dealer Google Drive backup (bring your own credentials).
 *
 * Each dealer_admin supplies THEIR OWN Google OAuth app (Client ID + Secret,
 * created in their own Google Cloud project), then connects their Google
 * account. Their full data is exported to Excel and uploaded to a
 * "SaniTiles Backups" folder in their own Drive — on demand and every night.
 *
 *   POST /credentials     (dealer_admin) save this dealer's Google Client ID+Secret
 *   GET  /auth-url        (dealer_admin) → Google consent URL (uses their creds)
 *   GET  /callback        (public) Google redirects here; stores the token
 *   GET  /status          (dealer_admin) → { has_credentials, connected, ... }
 *   POST /disconnect      (dealer_admin) revoke + delete token (keeps creds)
 *   POST /backup-now      (dealer_admin) run a backup immediately
 *   POST /cron/run-all    (x-cron-secret) nightly: back up every connected dealer
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { db } from '../db/connection';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { EXPORTS } from './dataExport';

const router = Router();
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const CRON_SECRET = process.env.CRON_SECRET || 'tilessaas-cron-internal';

// Fixed backend callback — every dealer registers this same URI in their own
// Google OAuth app's "Authorized redirect URIs".
function redirectUri(): string {
  return (
    env.GOOGLE_OAUTH_REDIRECT_URI ||
    `${env.APP_PUBLIC_URL || 'https://api.sanitileserp.com'}/api/dealer-drive/callback`
  );
}

async function getDealerCreds(
  dealerId: string,
): Promise<{ client_id: string; client_secret: string } | null> {
  const { rows } = await db.raw(
    `SELECT client_id, client_secret FROM dealer_drive_tokens WHERE dealer_id = ?`,
    [dealerId],
  );
  const r = rows[0];
  if (!r?.client_id || !r?.client_secret) return null;
  return { client_id: r.client_id, client_secret: r.client_secret };
}

// ── Excel + Drive helpers ─────────────────────────────────────────────
function cellSafe(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  return v as string | number | boolean;
}
function sheetName(label: string): string {
  return label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
}

async function buildWorkbookBuffer(dealerId: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet('Summary');
  summary.addRow(['SaniTiles ERP — Full Data Backup']).font = { bold: true, size: 14 };
  summary.addRow([`Generated: ${new Date().toISOString()}`]);
  summary.addRow([]);
  summary.addRow(['Data area', 'Records']).font = { bold: true };

  for (const spec of EXPORTS) {
    const rows = await db(spec.table).where({ dealer_id: dealerId }).select('*');
    summary.addRow([spec.label, rows.length]);
    const ws = wb.addWorksheet(sheetName(spec.label));
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      ws.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
      ws.getRow(1).font = { bold: true };
      for (const row of rows) {
        const out: Record<string, unknown> = {};
        for (const h of headers) out[h] = cellSafe((row as any)[h]);
        ws.addRow(out);
      }
    } else {
      ws.addRow(['(no records)']);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function getValidAccessToken(dealerId: string): Promise<string> {
  const { rows } = await db.raw(
    `SELECT access_token, refresh_token, expires_at, client_id, client_secret
       FROM dealer_drive_tokens WHERE dealer_id = ?`,
    [dealerId],
  );
  const tok = rows[0];
  if (!tok) throw new Error('Google Drive not connected');
  if (new Date(tok.expires_at).getTime() - Date.now() > 60_000) return tok.access_token;
  if (!tok.refresh_token) throw new Error('Session expired — please reconnect Google Drive');
  if (!tok.client_id || !tok.client_secret) throw new Error('Google credentials missing — re-enter them');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: tok.client_id,
      client_secret: tok.client_secret,
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Token refresh failed: ${j.error_description || j.error}`);
  const exp = new Date(Date.now() + (j.expires_in || 3600) * 1000);
  await db.raw(
    `UPDATE dealer_drive_tokens SET access_token = ?, expires_at = ?, updated_at = now() WHERE dealer_id = ?`,
    [j.access_token, exp, dealerId],
  );
  return j.access_token;
}

async function ensureFolder(dealerId: string, accessToken: string): Promise<string> {
  const { rows } = await db.raw(
    `SELECT folder_id FROM dealer_drive_tokens WHERE dealer_id = ?`,
    [dealerId],
  );
  if (rows[0]?.folder_id) return rows[0].folder_id;
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'SaniTiles Backups', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Drive folder create failed: ${j.error?.message || r.status}`);
  await db.raw(`UPDATE dealer_drive_tokens SET folder_id = ?, updated_at = now() WHERE dealer_id = ?`, [
    j.id,
    dealerId,
  ]);
  return j.id;
}

async function uploadToDrive(
  accessToken: string,
  folderId: string,
  filename: string,
  buffer: Buffer,
): Promise<{ id: string; name: string }> {
  const boundary = '----sanitiles' + Date.now().toString(36);
  const meta = JSON.stringify({ name: filename, parents: [folderId] });
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([pre, buffer, post]);
  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Drive upload failed: ${j.error?.message || r.status}`);
  return { id: j.id, name: j.name };
}

async function runBackupForDealer(dealerId: string): Promise<{ file: string }> {
  try {
    const at = await getValidAccessToken(dealerId);
    const folderId = await ensureFolder(dealerId, at);
    const buffer = await buildWorkbookBuffer(dealerId);
    const filename = `SaniTiles_backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const up = await uploadToDrive(at, folderId, filename, buffer);
    await db.raw(
      `UPDATE dealer_drive_tokens SET last_backup_at = now(), last_backup_status = 'success',
         last_backup_error = NULL, last_backup_file = ?, updated_at = now() WHERE dealer_id = ?`,
      [up.name, dealerId],
    );
    return { file: up.name };
  } catch (err: any) {
    await db
      .raw(
        `UPDATE dealer_drive_tokens SET last_backup_at = now(), last_backup_status = 'failed',
           last_backup_error = ?, updated_at = now() WHERE dealer_id = ?`,
        [String(err?.message || err).slice(0, 500), dealerId],
      )
      .catch(() => {});
    throw err;
  }
}

// ── PUBLIC: OAuth callback (Google redirects the browser here) ─────────
router.get('/callback', async (req: Request, res: Response) => {
  const code = (req.query.code as string) || '';
  const state = (req.query.state as string) || '';
  const gErr = (req.query.error as string) || '';
  const close = (ok: boolean, msg: string) =>
    res.status(ok ? 200 : 400).type('html').send(
      `<!doctype html><html><body style="font-family:sans-serif;background:#0f172a;color:#fff;padding:32px;text-align:center">
<h2>${ok ? '✅ Google Drive Connected' : '❌ Connection Failed'}</h2><p>${msg}</p><p>You can close this window.</p>
<script>try{window.opener&&window.opener.postMessage({type:'dealer_gdrive_oauth',ok:${ok},message:${JSON.stringify(
        msg,
      )}},'*')}catch(e){}setTimeout(function(){window.close()},1500);</script></body></html>`,
    );

  if (gErr) return close(false, `Google returned: ${gErr}`);
  if (!code || !state) return close(false, 'Missing code or state.');

  let dealerId: string;
  try {
    const d = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    dealerId = d.did;
    if (!dealerId) throw new Error('no did');
  } catch {
    return close(false, 'Invalid state.');
  }

  const creds = await getDealerCreds(dealerId);
  if (!creds) return close(false, 'No Google credentials saved for this account.');

  try {
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const tokens: any = await tr.json();
    if (!tr.ok) return close(false, `Token exchange failed: ${tokens.error_description || tokens.error}`);

    let email: string | null = null;
    try {
      const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (u.ok) email = ((await u.json()) as any).email || null;
    } catch {/* ignore */}

    const exp = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    await db.raw(
      `UPDATE dealer_drive_tokens SET
         google_email = ?, access_token = ?,
         refresh_token = COALESCE(?, refresh_token),
         token_type = ?, scope = ?, expires_at = ?, connected_at = now(), updated_at = now()
       WHERE dealer_id = ?`,
      [
        email,
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.token_type || 'Bearer',
        tokens.scope || SCOPES.join(' '),
        exp,
        dealerId,
      ],
    );
    return close(true, email ? `Connected as ${email}` : 'Connected.');
  } catch (err: any) {
    return close(false, err?.message || 'Unknown error');
  }
});

// ── PUBLIC (cron secret): nightly — back up every connected dealer ─────
router.post('/cron/run-all', async (req: Request, res: Response) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { rows } = await db.raw(
    `SELECT dealer_id FROM dealer_drive_tokens WHERE auto_backup_enabled = true AND refresh_token IS NOT NULL`,
  );
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await runBackupForDealer(r.dealer_id);
      ok++;
    } catch {
      failed++;
    }
  }
  res.json({ ran: rows.length, ok, failed });
});

// ── Authenticated dealer_admin routes ─────────────────────────────────
router.use(authenticate, tenantGuard, requireRole('dealer_admin'));

function dealerOf(req: Request): string | null {
  return (req.dealerId as string) || req.user?.dealerId || null;
}

const credsSchema = z.object({
  client_id: z.string().trim().min(10).max(400),
  client_secret: z.string().trim().min(6).max(400),
});

router.post('/credentials', async (req: Request, res: Response) => {
  const dealerId = dealerOf(req);
  if (!dealerId) { res.status(403).json({ error: 'Dealer scope required' }); return; }
  const parsed = credsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid Client ID and Client Secret.' });
    return;
  }
  await db.raw(
    `INSERT INTO dealer_drive_tokens (dealer_id, client_id, client_secret, connected_at, updated_at)
       VALUES (?, ?, ?, now(), now())
     ON CONFLICT (dealer_id) DO UPDATE SET
       client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret, updated_at = now()`,
    [dealerId, parsed.data.client_id, parsed.data.client_secret],
  );
  res.json({ ok: true });
});

router.get('/auth-url', async (req: Request, res: Response) => {
  const dealerId = dealerOf(req);
  if (!dealerId) { res.status(403).json({ error: 'Dealer scope required' }); return; }
  const creds = await getDealerCreds(dealerId);
  if (!creds) {
    res.status(400).json({ error: 'Add your Google Client ID and Secret first, then connect.' });
    return;
  }
  const state = Buffer.from(JSON.stringify({ did: dealerId, t: Date.now() })).toString('base64url');
  const params = new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

router.get('/status', async (req: Request, res: Response) => {
  const dealerId = dealerOf(req);
  if (!dealerId) { res.status(403).json({ error: 'Dealer scope required' }); return; }
  const { rows } = await db.raw(
    `SELECT google_email, auto_backup_enabled, last_backup_at, last_backup_status,
            last_backup_error, last_backup_file,
            client_id IS NOT NULL AND client_secret IS NOT NULL AS has_credentials,
            refresh_token IS NOT NULL AS connected
       FROM dealer_drive_tokens WHERE dealer_id = ?`,
    [dealerId],
  );
  const row = rows[0];
  res.json({
    has_credentials: !!row?.has_credentials,
    connected: !!row?.connected,
    email: row?.google_email || null,
    auto_backup_enabled: row?.auto_backup_enabled ?? true,
    last_backup_at: row?.last_backup_at || null,
    last_backup_status: row?.last_backup_status || null,
    last_backup_error: row?.last_backup_error || null,
    last_backup_file: row?.last_backup_file || null,
    redirect_uri: redirectUri(),
  });
});

router.post('/disconnect', async (req: Request, res: Response) => {
  const dealerId = dealerOf(req);
  if (!dealerId) { res.status(403).json({ error: 'Dealer scope required' }); return; }
  const { rows } = await db.raw(
    `SELECT access_token, refresh_token FROM dealer_drive_tokens WHERE dealer_id = ?`,
    [dealerId],
  );
  const tok = rows[0];
  if (tok) {
    const t = tok.refresh_token || tok.access_token;
    if (t) {
      try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }); }
      catch {/* ignore */}
    }
  }
  // Keep the saved credentials; only clear the connected tokens.
  await db.raw(
    `UPDATE dealer_drive_tokens SET access_token = NULL, refresh_token = NULL, google_email = NULL,
       expires_at = NULL, folder_id = NULL, updated_at = now() WHERE dealer_id = ?`,
    [dealerId],
  );
  res.json({ ok: true });
});

router.post('/backup-now', async (req: Request, res: Response) => {
  const dealerId = dealerOf(req);
  if (!dealerId) { res.status(403).json({ error: 'Dealer scope required' }); return; }
  try {
    const result = await runBackupForDealer(dealerId);
    res.json({ ok: true, file: result.file });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Backup failed' });
  }
});

export default router;
