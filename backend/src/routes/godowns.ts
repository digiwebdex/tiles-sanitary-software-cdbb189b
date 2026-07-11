/**
 * Godown management — V2 Sprint 3B (Warehouse & Godown).
 *
 *   GET    /api/godowns?warehouseId=       list (optionally scoped to one warehouse)
 *   POST   /api/godowns                    create (requires warehouse_id)
 *   PUT    /api/godowns/:id                update
 *   DELETE /api/godowns/:id                soft delete
 *   GET    /api/godowns/:id/stock          stock cached at this godown
 *
 * A godown always belongs to exactly one warehouse (`warehouse_id`, NOT
 * NULL). `is_default` marks the default godown WITHIN its parent warehouse —
 * setting one clears the flag on the warehouse's other godowns only, not
 * dealer-wide (mirrors `warehouses.is_default`, which is dealer-wide since
 * warehouses have no parent).
 *
 * dealer_admin only for writes, same as warehouses.ts.
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
    res.status(403).json({ error: 'Only dealer_admin can manage godowns' });
    return false;
  }
  return true;
}

const GodownSchema = z.object({
  warehouse_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().max(30).optional().nullable(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const warehouseId = req.query.warehouseId as string | undefined;
  const q = db('godowns as g')
    .innerJoin('warehouses as w', 'w.id', 'g.warehouse_id')
    .where('g.dealer_id', dealerId)
    .select('g.*', 'w.name as warehouse_name')
    .orderBy([{ column: 'g.is_active', order: 'desc' }, { column: 'g.is_default', order: 'desc' }, { column: 'g.name' }]);
  if (warehouseId) q.andWhere('g.warehouse_id', warehouseId);
  res.json(await q);
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = GodownSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  const warehouse = await db('warehouses').where({ id: p.data.warehouse_id, dealer_id: dealerId }).first('id');
  if (!warehouse) { res.status(404).json({ error: 'Warehouse not found' }); return; }

  if (p.data.is_default) {
    await db('godowns').where({ dealer_id: dealerId, warehouse_id: p.data.warehouse_id }).update({ is_default: false });
  }
  const [row] = await db('godowns').insert({ dealer_id: dealerId, ...p.data }).returning('*');
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = GodownSchema.partial().safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  if (p.data.is_default) {
    const current = await db('godowns').where({ id: req.params.id, dealer_id: dealerId }).first('warehouse_id');
    if (!current) { res.status(404).json({ error: 'Not found' }); return; }
    await db('godowns')
      .where({ dealer_id: dealerId, warehouse_id: current.warehouse_id })
      .whereNot({ id: req.params.id })
      .update({ is_default: false });
  }
  const [row] = await db('godowns').where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...p.data, updated_at: db.fn.now() }).returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('godowns').where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() });
  res.status(204).end();
});

/** V2 Sprint 3B — Multi-location Stock: stock cached at this godown. */
router.get('/:id/stock', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('godown_stock as gs')
    .innerJoin('products as p', 'p.id', 'gs.product_id')
    .where({ 'gs.dealer_id': dealerId, 'gs.godown_id': req.params.id })
    .select(
      'gs.product_id', 'p.name as product_name', 'p.sku as product_sku',
      'p.unit_type as product_unit_type', 'p.pieces_per_box as product_pieces_per_box',
      'gs.box_qty', 'gs.piece_qty', 'gs.sft_qty', 'gs.total_pieces', 'gs.updated_at',
    )
    .orderBy('p.name');
  res.json({ rows });
});

export default router;
