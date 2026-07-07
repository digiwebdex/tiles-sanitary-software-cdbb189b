/**
 * Departments — V2 Sprint 6D.
 *
 *   GET    /api/departments?dealerId=&activeOnly=
 *   POST   /api/departments
 *   PUT    /api/departments/:id
 *   DELETE /api/departments/:id   (soft delete via is_active=false)
 *
 * A new, lightweight, referenceable entity — nothing existed beyond a
 * free-text `department` varchar column on employees/purchase_requests
 * (no referential integrity, cannot be "mapped" to by Cost Centers). Those
 * existing free-text columns are untouched by this sprint.
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

const departmentSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(150),
});

router.get('/', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const activeOnly = req.query.activeOnly !== 'false';
  const q = db('departments').where({ dealer_id: dealerId });
  if (activeOnly) q.andWhere('is_active', true);
  const rows = await q.orderBy('name');
  res.json({ rows });
});

router.post('/', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = departmentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const [row] = await db('departments')
      .insert({ dealer_id: dealerId, code: parsed.data.code, name: parsed.data.name })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: `Department code ${req.body?.code} already exists for this dealer.` }); return; }
    console.error('[departments/create]', err.message);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

router.put('/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = departmentSchema.partial().extend({ is_active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const [row] = await db('departments')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Department not found' }); return; }
  res.json({ row });
});

router.delete('/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const [row] = await db('departments')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() })
    .returning('id');
  if (!row) { res.status(404).json({ error: 'Department not found' }); return; }
  res.json({ ok: true });
});

export default router;
