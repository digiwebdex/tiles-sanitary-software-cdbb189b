/**
 * Cost Centers — V2 Sprint 6D.
 *
 *   GET    /api/cost-centers?dealerId=&activeOnly=
 *   POST   /api/cost-centers
 *   PUT    /api/cost-centers/:id
 *   DELETE /api/cost-centers/:id            (soft delete via is_active=false)
 *   GET    /api/cost-centers/:id/report?from=&to=   (actuals from posting_lines, sliced by cost_center_id)
 *
 * Reuses the existing `branches` table (Phase 8) and the new `departments`
 * table (this sprint) for mapping — no new organization structure invented.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;
const MANAGE_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'] as const;

const costCenterSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(150),
  parent_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  branch_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

router.get('/', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const activeOnly = req.query.activeOnly !== 'false';
  const q = db('cost_centers as cc')
    .leftJoin('departments as d', 'd.id', 'cc.department_id')
    .leftJoin('branches as b', 'b.id', 'cc.branch_id')
    .where({ 'cc.dealer_id': dealerId });
  if (activeOnly) q.andWhere('cc.is_active', true);
  const rows = await q.orderBy('cc.code').select(
    'cc.*', 'd.name as department_name', 'b.name as branch_name',
  );
  res.json({ rows });
});

router.post('/', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = costCenterSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    if (parsed.data.parent_id) {
      const parent = await db('cost_centers').where({ id: parsed.data.parent_id, dealer_id: dealerId }).first('id');
      if (!parent) { res.status(400).json({ error: 'Parent cost center not found' }); return; }
    }
    const [row] = await db('cost_centers')
      .insert({
        dealer_id: dealerId,
        code: parsed.data.code,
        name: parsed.data.name,
        parent_id: parsed.data.parent_id || null,
        department_id: parsed.data.department_id || null,
        branch_id: parsed.data.branch_id || null,
        notes: parsed.data.notes || null,
        created_by: req.user?.userId ?? null,
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: `Cost center code ${req.body?.code} already exists for this dealer.` }); return; }
    console.error('[cost-centers/create]', err.message);
    res.status(500).json({ error: 'Failed to create cost center' });
  }
});

const updateSchema = costCenterSchema.partial().extend({ is_active: z.boolean().optional() });

router.put('/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  if (parsed.data.parent_id === req.params.id) { res.status(400).json({ error: 'A cost center cannot be its own parent' }); return; }
  const [row] = await db('cost_centers')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Cost center not found' }); return; }
  res.json({ row });
});

router.delete('/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const [row] = await db('cost_centers')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() })
    .returning('id');
  if (!row) { res.status(404).json({ error: 'Cost center not found' }); return; }
  res.json({ ok: true });
});

// ── GET /:id/report — actuals for this cost center, from posting_lines ──
router.get('/:id/report', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const cc = await db('cost_centers').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!cc) { res.status(404).json({ error: 'Cost center not found' }); return; }

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = db('posting_lines').where({ dealer_id: dealerId, cost_center_id: cc.id });
  if (from) q.andWhere('entry_date', '>=', from);
  if (to) q.andWhere('entry_date', '<=', to);
  const rows = await q.select('line_domain', 'line_type', 'amount', 'entry_date');

  const byDomain: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    byDomain[r.line_domain] = (byDomain[r.line_domain] || 0) + amt;
    total += amt;
  }

  res.json({
    cost_center: { id: cc.id, code: cc.code, name: cc.name },
    from: from ?? null, to: to ?? null,
    total: Math.round(total * 100) / 100,
    by_domain: byDomain,
    line_count: rows.length,
  });
});

export default router;
