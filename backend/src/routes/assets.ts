/**
 * Asset Assignment Tracking — Phase 18
 *
 *   GET    /api/assets                       list (?status=&employee_id=&q=)
 *   GET    /api/assets/:id                   detail (with assignment history)
 *   POST   /api/assets                       create
 *   PUT    /api/assets/:id                   update fields
 *   DELETE /api/assets/:id                   delete (only when available)
 *
 *   POST   /api/assets/:id/assign            { employee_id, assigned_date, condition?, notes? }
 *   POST   /api/assets/:id/return            { returned_date, condition_at_return?, notes? }
 *
 *   GET    /api/assets/assignments/active    currently assigned (joined view)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const assetSchema = z.object({
  tag: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  category: z.string().max(60).nullable().optional(),
  serial_no: z.string().max(120).nullable().optional(),
  brand: z.string().max(80).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  purchase_cost: z.coerce.number().min(0).optional(),
  condition: z.enum(['new', 'good', 'fair', 'damaged', 'lost']).optional(),
  status: z.enum(['available', 'assigned', 'retired', 'lost']).optional(),
  notes: z.string().nullable().optional(),
});

/* ============================ Assignments listing ============================ */

router.get('/assignments/active', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('assets as a')
    .leftJoin('employees as e', 'e.id', 'a.assigned_to')
    .where('a.dealer_id', dealerId)
    .where('a.status', 'assigned')
    .select(
      'a.id',
      'a.tag',
      'a.name',
      'a.category',
      'a.condition',
      'a.assigned_at',
      'a.assigned_to as employee_id',
      'e.name as employee_name',
      'e.employee_code',
    )
    .orderBy('a.assigned_at', 'desc');
  res.json(rows);
});

/* ============================ Assets ============================ */

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { status, employee_id, q } = req.query as Record<string, string | undefined>;
  let qb = db('assets as a')
    .leftJoin('employees as e', 'e.id', 'a.assigned_to')
    .where('a.dealer_id', dealerId)
    .select(
      'a.*',
      'e.name as employee_name',
      'e.employee_code',
    )
    .orderBy('a.tag');
  if (status) qb = qb.andWhere('a.status', status);
  if (employee_id) qb = qb.andWhere('a.assigned_to', employee_id);
  if (q) qb = qb.andWhere((b: any) => b.whereILike('a.tag', `%${q}%`).orWhereILike('a.name', `%${q}%`).orWhereILike('a.serial_no', `%${q}%`));
  res.json(await qb);
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const asset = await db('assets as a')
    .leftJoin('employees as e', 'e.id', 'a.assigned_to')
    .where('a.id', req.params.id)
    .andWhere('a.dealer_id', dealerId)
    .select('a.*', 'e.name as employee_name', 'e.employee_code')
    .first();
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const history = await db('asset_assignments as h')
    .leftJoin('employees as e', 'e.id', 'h.employee_id')
    .where('h.asset_id', asset.id)
    .andWhere('h.dealer_id', dealerId)
    .select('h.*', 'e.name as employee_name', 'e.employee_code')
    .orderBy('h.assigned_date', 'desc');
  res.json({ ...asset, history });
});

router.post('/', requireRole('dealer_admin', 'super_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const data = assetSchema.parse(req.body);
  try {
    const [row] = await db('assets')
      .insert({ ...data, dealer_id: dealerId, status: data.status ?? 'available' })
      .returning('*');
    res.status(201).json(row);
  } catch (e: any) {
    if (String(e?.code) === '23505') return res.status(409).json({ error: 'Asset tag already exists' });
    throw e;
  }
});

router.put('/:id', requireRole('dealer_admin', 'super_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const data = assetSchema.partial().parse(req.body);
  const [row] = await db('assets')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Asset not found' });
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin', 'super_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const asset = await db('assets').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status === 'assigned') return res.status(400).json({ error: 'Return the asset before deleting' });
  await db('assets').where({ id: asset.id }).delete();
  res.json({ success: true });
});

/* ============================ Assign / Return ============================ */

const assignSchema = z.object({
  employee_id: z.string().uuid(),
  assigned_date: z.string(),
  condition_at_assignment: z.enum(['new', 'good', 'fair', 'damaged']).optional(),
  notes: z.string().nullable().optional(),
});

router.post('/:id/assign', requireRole('dealer_admin', 'super_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const body = assignSchema.parse(req.body);

  const result = await db.transaction(async (trx: any) => {
    const asset = await trx('assets').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
    if (!asset) throw Object.assign(new Error('Asset not found'), { status: 404 });
    if (asset.status !== 'available') throw Object.assign(new Error(`Asset is ${asset.status} — cannot assign`), { status: 400 });

    const emp = await trx('employees').where({ id: body.employee_id, dealer_id: dealerId }).first();
    if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });

    const [assignment] = await trx('asset_assignments').insert({
      dealer_id: dealerId,
      asset_id: asset.id,
      employee_id: body.employee_id,
      assigned_date: body.assigned_date,
      condition_at_assignment: body.condition_at_assignment ?? asset.condition,
      notes: body.notes ?? null,
      created_by: req.user!.userId,
    }).returning('*');

    const [updated] = await trx('assets').where({ id: asset.id }).update({
      status: 'assigned',
      assigned_to: body.employee_id,
      assigned_at: body.assigned_date,
      updated_at: trx.fn.now(),
    }).returning('*');

    return { asset: updated, assignment };
  });

  res.json(result);
});

const returnSchema = z.object({
  returned_date: z.string(),
  condition_at_return: z.enum(['new', 'good', 'fair', 'damaged', 'lost']).optional(),
  notes: z.string().nullable().optional(),
});

router.post('/:id/return', requireRole('dealer_admin', 'super_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const body = returnSchema.parse(req.body);

  const result = await db.transaction(async (trx: any) => {
    const asset = await trx('assets').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
    if (!asset) throw Object.assign(new Error('Asset not found'), { status: 404 });
    if (asset.status !== 'assigned') throw Object.assign(new Error('Asset is not currently assigned'), { status: 400 });

    const open = await trx('asset_assignments')
      .where({ asset_id: asset.id, dealer_id: dealerId, employee_id: asset.assigned_to })
      .whereNull('returned_date')
      .orderBy('assigned_date', 'desc')
      .first();

    if (open) {
      await trx('asset_assignments').where({ id: open.id }).update({
        returned_date: body.returned_date,
        condition_at_return: body.condition_at_return ?? null,
        notes: body.notes ?? open.notes,
        updated_at: trx.fn.now(),
      });
    }

    const newStatus = body.condition_at_return === 'lost' ? 'lost' : 'available';
    const [updated] = await trx('assets').where({ id: asset.id }).update({
      status: newStatus,
      assigned_to: null,
      assigned_at: null,
      condition: body.condition_at_return ?? asset.condition,
      updated_at: trx.fn.now(),
    }).returning('*');

    return updated;
  });

  res.json(result);
});

/* ============================ Error wrapping ============================ */

router.use((err: any, _req: Request, res: Response, _next: any) => {
  const status = err?.status ?? 500;
  res.status(status).json({ error: err?.message ?? 'Internal error' });
});

export default router;
