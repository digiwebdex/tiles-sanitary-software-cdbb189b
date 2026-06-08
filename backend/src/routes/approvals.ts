/**
 * Approvals route — Phase 3S.
 *
 *   GET    /api/approvals                       ← list (filters: status, type)
 *   GET    /api/approvals/pending               ← pending only
 *   GET    /api/approvals/settings              ← dealer approval settings
 *   PUT    /api/approvals/settings              ← upsert settings
 *   POST   /api/approvals                       ← create approval request
 *   POST   /api/approvals/:id/decide            ← approve/reject (atomic RPC)
 *   POST   /api/approvals/:id/consume           ← consume approved request (hash-validated RPC)
 *   POST   /api/approvals/:id/cancel            ← cancel pending request
 *   POST   /api/approvals/expire-stale          ← sweep expired (cron / on-view)
 *
 * Backorder allocation mutations are already migrated as part of
 * Phases 3K (purchase create), 3M (sale cancel/update), 3N (returns) —
 * the VPS endpoints invoke FIFO allocation atomically inside the same txn,
 * so no standalone /api/backorder mutation surface is needed here.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealer_id as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
    undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

function isAdmin(req: Request): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  return roles.includes('dealer_admin') || roles.includes('super_admin');
}

// ── GET /api/approvals ──
router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    let q = db('approval_requests')
      .where({ dealer_id: dealerId })
      .orderBy('created_at', 'desc')
      .limit(100);
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    if (status) q = q.andWhere({ status });
    if (type) q = q.andWhere({ approval_type: type });
    const rows = await q;
    res.json({ rows });
  } catch (err: any) {
    console.error('[approvals/list]', err.message);
    res.status(500).json({ error: 'Failed to list approvals' });
  }
});

// ── GET /api/approvals/pending ──
router.get('/pending', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('approval_requests')
      .where({ dealer_id: dealerId, status: 'pending' })
      .orderBy('created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    // Fresh installs may not have run migration 021 yet — don't break the UI.
    if (err.code === '42P01') {
      console.warn('[approvals/pending] approval_requests table missing — run migrations');
      res.json({ rows: [] });
      return;
    }
    console.error('[approvals/pending]', err.message);
    res.status(500).json({ error: 'Failed to list pending approvals' });
  }
});

// ── GET /api/approvals/settings ──
router.get('/settings', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const row = await db('approval_settings')
      .where({ dealer_id: dealerId })
      .first();
    if (!row) {
      res.json({
        settings: {
          dealer_id: dealerId,
          require_backorder_approval: true,
          require_mixed_shade_approval: true,
          require_mixed_caliber_approval: true,
          require_credit_override_approval: true,
          require_overdue_override_approval: true,
          require_stock_adjustment_approval: false,
          require_sale_cancel_approval: true,
          discount_approval_threshold: 10,
          auto_approve_for_admins: true,
          approval_expiry_hours: 24,
        },
      });
      return;
    }
    res.json({ settings: row });
  } catch (err: any) {
    console.error('[approvals/settings/get]', err.message);
    res.status(500).json({ error: 'Failed to fetch approval settings' });
  }
});

// ── PUT /api/approvals/settings ──
const SettingsSchema = z.object({
  require_backorder_approval: z.boolean(),
  require_mixed_shade_approval: z.boolean(),
  require_mixed_caliber_approval: z.boolean(),
  require_credit_override_approval: z.boolean(),
  require_overdue_override_approval: z.boolean(),
  require_stock_adjustment_approval: z.boolean(),
  require_sale_cancel_approval: z.boolean(),
  discount_approval_threshold: z.coerce.number().min(0).max(100),
  auto_approve_for_admins: z.boolean(),
  approval_expiry_hours: z.coerce.number().int().min(1).max(720),
});
router.put('/settings', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Only dealer_admin can change approval settings' });
    return;
  }
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const row = { dealer_id: dealerId, ...parsed.data };
    await db('approval_settings')
      .insert(row)
      .onConflict('dealer_id')
      .merge();
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[approvals/settings/put]', err.message);
    res.status(500).json({ error: 'Failed to save approval settings' });
  }
});

// ── POST /api/approvals (create) ──
const CreateSchema = z.object({
  approval_type: z.string().min(1),
  source_type: z.string().min(1),
  source_id: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  context: z.record(z.any()).default({}),
  action_hash: z.string().min(8),
  expiry_hours: z.coerce.number().int().min(1).max(720).optional(),
});
router.post('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { approval_type, source_type, source_id, reason, context, action_hash, expiry_hours } = parsed.data;

  try {
    // Auto-approve for admins if dealer setting allows
    const settings = await db('approval_settings').where({ dealer_id: dealerId }).first();
    const autoApprove = isAdmin(req) && (settings?.auto_approve_for_admins ?? true);
    const status = autoApprove ? 'auto_approved' : 'pending';
    const hours = Math.max(1, Math.min(720, expiry_hours ?? settings?.approval_expiry_hours ?? 24));
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
    const now = new Date();
    const userId = req.user?.userId ?? null;

    const [row] = await db('approval_requests')
      .insert({
        dealer_id: dealerId,
        approval_type,
        status,
        action_hash,
        context_data: context,
        reason: reason ?? null,
        source_type,
        source_id: source_id ?? null,
        requested_by: userId,
        decided_by: autoApprove ? userId : null,
        decided_at: autoApprove ? now : null,
        consumed_at: autoApprove ? now : null,
        consumed_by: autoApprove ? userId : null,
        expires_at: expiresAt,
      })
      .returning('*');

    await db('audit_logs').insert({
      dealer_id: dealerId,
      user_id: userId,
      action: autoApprove ? 'APPROVAL_AUTO_APPROVED' : 'APPROVAL_REQUESTED',
      table_name: 'approval_requests',
      record_id: row.id,
      new_data: { approval_type, source_type, status },
    });

    res.status(201).json({ request: row });
  } catch (err: any) {
    console.error('[approvals/create]', err.message);
    res.status(500).json({ error: err.message || 'Failed to create approval request' });
  }
});

// ── POST /api/approvals/:id/decide ──
const DecideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decision_note: z.string().nullable().optional(),
});
router.post('/:id/decide', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'Only dealer_admin can decide approvals' });
    return;
  }
  const parsed = DecideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { id } = req.params;
  try {
    // Verify dealer ownership
    const owned = await db('approval_requests')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!owned) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    // Use atomic RPC for the actual transition (handles concurrency + audit + note rules)
    await db.raw(
      `SELECT public.decide_approval_request(?::uuid, ?::text, ?::text)`,
      [id, parsed.data.decision, parsed.data.decision_note ?? null],
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[approvals/decide]', err.message);
    res.status(400).json({ error: err.message || 'Failed to decide approval' });
  }
});

// ── POST /api/approvals/:id/consume ──
const ConsumeSchema = z.object({
  action_hash: z.string().min(8),
  source_id: z.string().uuid().nullable().optional(),
});
router.post('/:id/consume', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = ConsumeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { id } = req.params;
  try {
    const owned = await db('approval_requests')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!owned) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    await db.raw(
      `SELECT public.consume_approval_request(?::uuid, ?::text, ?::uuid)`,
      [id, parsed.data.action_hash, parsed.data.source_id ?? null],
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[approvals/consume]', err.message);
    res.status(400).json({ error: err.message || 'Failed to consume approval' });
  }
});

// ── POST /api/approvals/:id/cancel ──
const CancelSchema = z.object({
  reason: z.string().nullable().optional(),
});
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = CancelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { id } = req.params;
  try {
    const owned = await db('approval_requests')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!owned) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    await db.raw(
      `SELECT public.cancel_approval_request(?::uuid, ?::text)`,
      [id, parsed.data.reason ?? null],
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[approvals/cancel]', err.message);
    res.status(400).json({ error: err.message || 'Failed to cancel approval' });
  }
});

// ── POST /api/approvals/expire-stale ──
router.post('/expire-stale', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const result = await db.raw(
      `SELECT public.expire_stale_approvals(?::uuid) AS count`,
      [dealerId],
    );
    const count = Number(result.rows?.[0]?.count ?? 0);
    res.json({ count });
  } catch (err: any) {
    console.error('[approvals/expire-stale]', err.message);
    res.status(500).json({ error: 'Failed to expire stale approvals' });
  }
});

export default router;
