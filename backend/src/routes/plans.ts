/**
 * /api/plans — public list (for landing page) + super_admin CRUD.
 *
 * Powers both the marketing site pricing section and the Super Admin
 * "Plans" management screen so they always stay in sync.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();

// Every boolean feature flag a plan/package can carry. The Super Admin can
// enable/disable each of these per package. Add new columns here and they
// automatically become editable end-to-end (read + create + update).
const FEATURE_FLAGS = [
  'sms_enabled',
  'email_enabled',
  'whatsapp_enabled',
  'daily_summary_enabled',
  'pos_enabled',
  'leads_enabled',
  'projects_enabled',
  'quotations_enabled',
  'campaigns_enabled',
  'hrm_enabled',
  'portal_enabled',
  'backorders_enabled',
  'barcode_enabled',
  'advanced_finance_enabled',
  'advanced_reports_enabled',
] as const;

// Integer capacity limits (0 = none/unlimited depending on the feature).
const LIMIT_FIELDS = ['max_users', 'max_branches', 'max_staff_users', 'max_warehouses'] as const;

function rowToPlan(r: any) {
  const out: Record<string, any> = {
    id: r.id,
    name: r.name,
    monthly_price: Number(r.price_monthly ?? 0),
    yearly_price: Number(r.price_yearly ?? 0),
    is_trial: !!r.is_trial,
    trial_days: Number(r.trial_days ?? 0),
    is_active: !!r.is_active,
    sort_order: Number(r.sort_order ?? 0),
    features: Array.isArray(r.features)
      ? r.features
      : (typeof r.features === 'string' ? safeJsonArray(r.features) : []),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  for (const f of FEATURE_FLAGS) out[f] = !!r[f];
  for (const l of LIMIT_FIELDS) out[l] = Number(r[l] ?? (l === 'max_users' ? 1 : 0));
  return out;
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

// ── Public: list active plans for landing page ────────────────────────────
router.get('/public', async (_req: Request, res: Response) => {
  try {
    const rows = await db('plans').where({ is_active: true }).orderBy('sort_order', 'asc').orderBy('price_monthly', 'asc');
    res.json({ plans: rows.map(rowToPlan) });
  } catch (err: any) {
    console.error('[plans:public] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load plans' });
  }
});

// ── Super Admin only routes ───────────────────────────────────────────────
router.use(authenticate, requireRole('super_admin'));

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db('plans').orderBy('sort_order', 'asc').orderBy('price_monthly', 'asc');
    res.json({ plans: rows.map(rowToPlan) });
  } catch (err: any) {
    console.error('[plans:list] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load plans' });
  }
});

const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  monthly_price: z.coerce.number().min(0),
  yearly_price: z.coerce.number().min(0),
  is_trial: z.boolean().optional().default(false),
  trial_days: z.coerce.number().int().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  sort_order: z.coerce.number().int().optional().default(0),
  features: z.array(z.string().trim().min(1)).optional().default([]),
  // Capacity limits
  max_users: z.coerce.number().int().min(1).optional(),
  max_branches: z.coerce.number().int().min(0).optional(),
  max_staff_users: z.coerce.number().int().min(0).optional(),
  max_warehouses: z.coerce.number().int().min(0).optional(),
  // Feature flags (all optional booleans)
  ...Object.fromEntries(FEATURE_FLAGS.map((f) => [f, z.boolean().optional()])),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body: any = planSchema.parse(req.body || {});
    const insertData: Record<string, any> = {
      name: body.name,
      price_monthly: body.monthly_price,
      price_yearly: body.yearly_price,
      max_users: body.max_users ?? 1,
      is_trial: body.is_trial,
      trial_days: body.trial_days,
      is_active: body.is_active,
      sort_order: body.sort_order,
      features: JSON.stringify(body.features),
    };
    for (const f of FEATURE_FLAGS) insertData[f] = body[f] ?? false;
    for (const l of LIMIT_FIELDS) if (body[l] !== undefined) insertData[l] = body[l];
    const [row] = await db('plans').insert(insertData).returning('*');
    res.status(201).json({ plan: rowToPlan(row) });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid plan data' });
      return;
    }
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A plan with this name already exists' });
      return;
    }
    console.error('[plans:create] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to create plan' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body: any = planSchema.partial().parse(req.body || {});
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.monthly_price !== undefined) patch.price_monthly = body.monthly_price;
    if (body.yearly_price !== undefined) patch.price_yearly = body.yearly_price;
    if (body.is_trial !== undefined) patch.is_trial = body.is_trial;
    if (body.trial_days !== undefined) patch.trial_days = body.trial_days;
    if (body.is_active !== undefined) patch.is_active = body.is_active;
    if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
    if (body.features !== undefined) patch.features = JSON.stringify(body.features);
    for (const f of FEATURE_FLAGS) if (body[f] !== undefined) patch[f] = body[f];
    for (const l of LIMIT_FIELDS) if (body[l] !== undefined) patch[l] = body[l];
    patch.updated_at = new Date();

    const [row] = await db('plans').where({ id: req.params.id }).update(patch).returning('*');
    if (!row) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json({ plan: rowToPlan(row) });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid plan data' });
      return;
    }
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A plan with this name already exists' });
      return;
    }
    console.error('[plans:update] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to update plan' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const used = await db('subscriptions').where({ plan_id: req.params.id }).first();
    if (used) {
      res.status(409).json({ error: 'Cannot delete plan in use by a subscription. Mark it inactive instead.' });
      return;
    }
    const n = await db('plans').where({ id: req.params.id }).del();
    if (!n) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[plans:delete] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to delete plan' });
  }
});

export default router;
