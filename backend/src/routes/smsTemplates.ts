/**
 * /api/sms-templates — per-dealer SMS template overrides.
 *
 *   GET /            list this dealer's overrides
 *   PUT /:key        upsert one template override { label?, body, is_enabled? }
 *   DELETE /:key     remove the override (falls back to the built-in default)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard, requireDealer } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard, requireDealer);

const KEY_RE = /^[a-z0-9_]{2,60}$/;

router.get(
  '/',
  requireRole('dealer_admin', 'manager', 'accountant', 'salesman'),
  async (req: Request, res: Response) => {
    try {
      const rows = await db('sms_templates')
        .select('template_key', 'label', 'body', 'is_enabled', 'updated_at')
        .where({ dealer_id: req.dealerId! })
        .orderBy('template_key');
      res.json({ rows });
    } catch (err) {
      console.error('[sms-templates/list]', (err as Error).message);
      res.status(500).json({ error: 'Failed to load templates' });
    }
  },
);

const upsertSchema = z.object({
  label: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(1000),
  is_enabled: z.boolean().optional(),
});

router.put(
  '/:key',
  requireRole('dealer_admin', 'manager'),
  async (req: Request, res: Response) => {
    const key = String(req.params.key || '');
    if (!KEY_RE.test(key)) {
      res.status(400).json({ error: 'Invalid template key' });
      return;
    }
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    try {
      const dealerId = req.dealerId!;
      const values = {
        dealer_id: dealerId,
        template_key: key,
        label: parsed.data.label ?? null,
        body: parsed.data.body,
        is_enabled: parsed.data.is_enabled ?? true,
        updated_at: new Date(),
      };
      const [row] = await db('sms_templates')
        .insert(values)
        .onConflict(['dealer_id', 'template_key'])
        .merge({
          label: values.label,
          body: values.body,
          is_enabled: values.is_enabled,
          updated_at: values.updated_at,
        })
        .returning(['template_key', 'label', 'body', 'is_enabled', 'updated_at']);
      res.json({ row });
    } catch (err) {
      console.error('[sms-templates/upsert]', (err as Error).message);
      res.status(500).json({ error: 'Failed to save template' });
    }
  },
);

router.delete(
  '/:key',
  requireRole('dealer_admin', 'manager'),
  async (req: Request, res: Response) => {
    const key = String(req.params.key || '');
    if (!KEY_RE.test(key)) {
      res.status(400).json({ error: 'Invalid template key' });
      return;
    }
    try {
      await db('sms_templates')
        .where({ dealer_id: req.dealerId!, template_key: key })
        .delete();
      res.json({ ok: true });
    } catch (err) {
      console.error('[sms-templates/delete]', (err as Error).message);
      res.status(500).json({ error: 'Failed to reset template' });
    }
  },
);

export default router;
