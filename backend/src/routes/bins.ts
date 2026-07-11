/**
 * Bin / Storage Location management — V2 Sprint 3B (Warehouse & Godown).
 *
 *   GET    /api/bins?rackId=       list (optionally scoped to one rack)
 *   POST   /api/bins                create (requires rack_id)
 *   PUT    /api/bins/:id            update
 *   DELETE /api/bins/:id            soft delete
 *
 * A bin is a lightweight location label (bin code, storage location,
 * position within its rack) — it does NOT carry its own stock cache; Sprint
 * 3B tracks quantities down to the rack tier only (see rack_stock).
 *
 * dealer_admin only for writes, same as warehouses.ts / godowns.ts / racks.ts.
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
    res.status(403).json({ error: 'Only dealer_admin can manage bins' });
    return false;
  }
  return true;
}

const BinSchema = z.object({
  rack_id: z.string().uuid(),
  bin_code: z.string().min(1).max(30),
  storage_location: z.string().max(120).optional().nullable(),
  rack_position: z.string().max(30).optional().nullable(),
  is_active: z.boolean().default(true),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rackId = req.query.rackId as string | undefined;
  const q = db('bins as b')
    .innerJoin('racks as r', 'r.id', 'b.rack_id')
    .where('b.dealer_id', dealerId)
    .select('b.*', 'r.name as rack_name', 'r.godown_id')
    .orderBy([{ column: 'b.is_active', order: 'desc' }, { column: 'b.bin_code' }]);
  if (rackId) q.andWhere('b.rack_id', rackId);
  res.json(await q);
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = BinSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  const rack = await db('racks').where({ id: p.data.rack_id, dealer_id: dealerId }).first('id');
  if (!rack) { res.status(404).json({ error: 'Rack not found' }); return; }

  const [row] = await db('bins').insert({ dealer_id: dealerId, ...p.data }).returning('*');
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = BinSchema.partial().safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('bins').where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...p.data, updated_at: db.fn.now() }).returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('bins').where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() });
  res.status(204).end();
});

export default router;
