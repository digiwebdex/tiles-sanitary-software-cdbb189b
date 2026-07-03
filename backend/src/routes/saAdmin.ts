/**
 * /api/admin/audit          — Super Admin audit trail (read)
 * /api/admin/announcements  — Platform announcements CRUD (super_admin)
 *
 * All routes here require super_admin. The dealer-facing endpoint to fetch
 * active announcements lives in announcements.ts (any authenticated user).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { recordSaAudit } from '../services/saAuditService';

const router = Router();
router.use(authenticate, requireRole('super_admin'));

// ── GET /audit — list audit entries with filters ───────────────────
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const action = (req.query.action as string) || '';
    const targetType = (req.query.target_type as string) || '';
    const search = (req.query.q as string) || '';

    let q = db('sa_audit_log').select('*').orderBy('created_at', 'desc');
    if (action) q = q.where('action', action);
    if (targetType) q = q.where('target_type', targetType);
    if (search) {
      q = q.where((b) =>
        b.whereILike('actor_email', `%${search}%`)
          .orWhereILike('target_label', `%${search}%`)
          .orWhereILike('action', `%${search}%`),
      );
    }

    const rows = await q.limit(limit).offset(offset);

    // distinct actions for filter dropdown
    const actionsRows = await db('sa_audit_log').distinct('action').orderBy('action');

    res.json({
      entries: rows,
      actions: actionsRows.map((r: any) => r.action),
      limit,
      offset,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Announcements ──────────────────────────────────────────────────
const announcementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  severity: z.enum(['info', 'warning', 'critical', 'success']).default('info'),
  audience: z.enum(['all', 'active', 'expiring', 'trial', 'suspended']).default('all'),
  is_active: z.boolean().default(true),
  dismissible: z.boolean().default(true),
  start_at: z.string().datetime().nullable().optional(),
  end_at: z.string().datetime().nullable().optional(),
});

// GET /announcements — list all (SA view)
router.get('/announcements', async (_req: Request, res: Response) => {
  try {
    const rows = await db('platform_announcements').select('*').orderBy('created_at', 'desc');
    res.json({ announcements: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /announcements — create
router.post('/announcements', async (req: Request, res: Response) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid input' });
    return;
  }
  try {
    const [row] = await db('platform_announcements')
      .insert({
        ...parsed.data,
        start_at: parsed.data.start_at ?? null,
        end_at: parsed.data.end_at ?? null,
        created_by: (req.user as any)?.userId ?? null,
        created_by_email: req.user?.email ?? null,
      })
      .returning('*');

    await recordSaAudit(req, {
      action: 'announcement.create',
      targetType: 'announcement',
      targetId: row.id,
      targetLabel: row.title,
      details: { severity: row.severity, audience: row.audience },
    });

    res.status(201).json({ announcement: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /announcements/:id — update
router.patch('/announcements/:id', async (req: Request, res: Response) => {
  const parsed = announcementSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid input' });
    return;
  }
  try {
    const [row] = await db('platform_announcements')
      .where({ id: req.params.id })
      .update({ ...parsed.data, updated_at: db.fn.now() })
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    await recordSaAudit(req, {
      action: 'announcement.update',
      targetType: 'announcement',
      targetId: row.id,
      targetLabel: row.title,
      details: parsed.data,
    });

    res.json({ announcement: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /announcements/:id
router.delete('/announcements/:id', async (req: Request, res: Response) => {
  try {
    const row = await db('platform_announcements').where({ id: req.params.id }).first();
    const count = await db('platform_announcements').where({ id: req.params.id }).delete();
    if (!count) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    await recordSaAudit(req, {
      action: 'announcement.delete',
      targetType: 'announcement',
      targetId: req.params.id,
      targetLabel: row?.title ?? null,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
