import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const noticeSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  audience: z.enum(['all', 'admin', 'manager', 'accountant', 'salesman']).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('notices')
    .where({ dealer_id: dealerId })
    .orderBy([{ column: 'pinned', order: 'desc' }, { column: 'created_at', order: 'desc' }]);
  res.json(rows);
});

router.get('/active', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const roles = req.user!.roles ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db('notices')
    .where({ dealer_id: dealerId, is_active: true })
    .andWhere((q: any) => q.whereNull('start_date').orWhere('start_date', '<=', today))
    .andWhere((q: any) => q.whereNull('end_date').orWhere('end_date', '>=', today))
    .orderBy([{ column: 'pinned', order: 'desc' }, { column: 'created_at', order: 'desc' }]);
  const filtered = rows.filter((n: any) =>
    n.audience === 'all' || roles.includes(n.audience) || roles.includes('dealer_admin'),
  );
  res.json(filtered);
});

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = noticeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('notices')
    .insert({ ...parsed.data, dealer_id: dealerId, created_by: req.user!.userId })
    .returning('*');
  res.json(row);
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = noticeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('notices')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Notice not found' });
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const count = await db('notices').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!count) return res.status(404).json({ error: 'Notice not found' });
  res.json({ success: true });
});

export default router;
