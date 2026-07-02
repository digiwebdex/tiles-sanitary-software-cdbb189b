import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const branchSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  manager_name: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('branches').where({ dealer_id: dealerId }).orderBy('name', 'asc');
  res.json(rows);
});

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = branchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // Enforce per-plan branch limit
  const sub = await db('subscriptions as s')
    .leftJoin('plans as p', 'p.id', 's.plan_id')
    .where({ 's.dealer_id': dealerId })
    .orderBy('s.start_date', 'desc')
    .select('p.max_branches')
    .first();
  const maxBranches: number = sub?.max_branches ?? 1;
  const currentCount: number = await db('branches')
    .where({ dealer_id: dealerId })
    .count('id as cnt')
    .then((r: any[]) => Number(r[0]?.cnt ?? 0));
  if (currentCount >= maxBranches) {
    return res.status(403).json({
      error: `Your plan allows a maximum of ${maxBranches} branch(es). Please upgrade to add more.`,
      code: 'PLAN_LIMIT_BRANCHES',
      limit: maxBranches,
    });
  }

  try {
    const [row] = await db('branches')
      .insert({ ...parsed.data, dealer_id: dealerId, created_by: req.user!.userId })
      .returning('*');
    if (parsed.data.is_default) {
      await db('branches')
        .where({ dealer_id: dealerId })
        .andWhereNot({ id: row.id })
        .update({ is_default: false });
    }
    res.json(row);
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Failed to create branch' });
  }
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = branchSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('branches')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Branch not found' });
  if (parsed.data.is_default) {
    await db('branches')
      .where({ dealer_id: dealerId })
      .andWhereNot({ id: row.id })
      .update({ is_default: false });
  }
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const count = await db('branches').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!count) return res.status(404).json({ error: 'Branch not found' });
  res.json({ success: true });
});

export default router;
