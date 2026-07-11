/**
 * Rack management — V2 Sprint 3B (Warehouse & Godown).
 *
 *   GET    /api/racks?godownId=       list (optionally scoped to one godown)
 *   POST   /api/racks                 create (requires godown_id)
 *   PUT    /api/racks/:id             update
 *   DELETE /api/racks/:id             soft delete
 *   GET    /api/racks/:id/stock       stock cached at this rack
 *
 * A rack always belongs to exactly one godown (`godown_id`, NOT NULL).
 * dealer_admin only for writes, same as warehouses.ts / godowns.ts.
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
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealer_id as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}
function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage racks' });
    return false;
  }
  return true;
}

const RackSchema = z.object({
  godown_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().max(30).optional().nullable(),
  is_active: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const godownId = req.query.godownId as string | undefined;
  const q = db('racks as r')
    .innerJoin('godowns as g', 'g.id', 'r.godown_id')
    .where('r.dealer_id', dealerId)
    .select('r.*', 'g.name as godown_name', 'g.warehouse_id')
    .orderBy([{ column: 'r.is_active', order: 'desc' }, { column: 'r.name' }]);
  if (godownId) q.andWhere('r.godown_id', godownId);
  res.json(await q);
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = RackSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  const godown = await db('godowns').where({ id: p.data.godown_id, dealer_id: dealerId }).first('id');
  if (!godown) { res.status(404).json({ error: 'Godown not found' }); return; }

  const [row] = await db('racks').insert({ dealer_id: dealerId, ...p.data }).returning('*');
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = RackSchema.partial().safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('racks').where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...p.data, updated_at: db.fn.now() }).returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('racks').where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() });
  res.status(204).end();
});

/** V2 Sprint 3B — Multi-location Stock: stock cached at this rack. */
router.get('/:id/stock', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('rack_stock as rs')
    .innerJoin('products as p', 'p.id', 'rs.product_id')
    .where({ 'rs.dealer_id': dealerId, 'rs.rack_id': req.params.id })
    .select(
      'rs.product_id', 'p.name as product_name', 'p.sku as product_sku',
      'p.unit_type as product_unit_type', 'p.pieces_per_box as product_pieces_per_box',
      'rs.box_qty', 'rs.piece_qty', 'rs.sft_qty', 'rs.total_pieces', 'rs.updated_at',
    )
    .orderBy('p.name');
  res.json({ rows });
});

export default router;
