/**
 * Employee Documents — Phase 13.
 *
 *   GET    /api/employee-documents?employee_id=&expiring_within_days=
 *   GET    /api/employee-documents/:id
 *   POST   /api/employee-documents
 *   PUT    /api/employee-documents/:id
 *   DELETE /api/employee-documents/:id
 *   GET    /api/employee-documents/expiring/list?days=30   dealer-wide expiry alert feed
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const docSchema = z.object({
  employee_id: z.string().uuid(),
  doc_type: z.enum(['nid', 'passport', 'contract', 'certificate', 'photo', 'license', 'other']),
  title: z.string().min(1).max(200),
  doc_number: z.string().max(100).nullable().optional(),
  file_url: z.string().max(1000).nullable().optional(),
  issue_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { employee_id, expiring_within_days } = req.query as Record<string, string>;
  const q = db('employee_documents as d')
    .leftJoin('employees as e', 'e.id', 'd.employee_id')
    .where('d.dealer_id', dealerId)
    .select('d.*', 'e.name as employee_name', 'e.employee_code')
    .orderBy('d.created_at', 'desc');
  if (employee_id) q.andWhere('d.employee_id', employee_id);
  if (expiring_within_days) {
    const days = parseInt(expiring_within_days, 10);
    if (!Number.isNaN(days)) {
      q.andWhereRaw(`d.expiry_date IS NOT NULL AND d.expiry_date <= (CURRENT_DATE + INTERVAL '${days} days')`);
    }
  }
  res.json(await q);
});

router.get('/expiring/list', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const days = Math.max(1, Math.min(365, parseInt((req.query.days as string) || '30', 10) || 30));
  const rows = await db('employee_documents as d')
    .leftJoin('employees as e', 'e.id', 'd.employee_id')
    .where('d.dealer_id', dealerId)
    .whereNotNull('d.expiry_date')
    .andWhereRaw(`d.expiry_date <= (CURRENT_DATE + INTERVAL '${days} days')`)
    .select('d.*', 'e.name as employee_name', 'e.employee_code')
    .orderBy('d.expiry_date', 'asc');
  res.json(rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const row = await db('employee_documents').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = docSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // Ensure employee belongs to dealer
  const emp = await db('employees').where({ id: parsed.data.employee_id, dealer_id: dealerId }).first();
  if (!emp) return res.status(400).json({ error: 'Invalid employee' });
  const [row] = await db('employee_documents')
    .insert({ ...parsed.data, dealer_id: dealerId, created_by: req.user!.userId })
    .returning('*');
  res.json(row);
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = docSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('employee_documents')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const count = await db('employee_documents').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!count) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

export default router;
