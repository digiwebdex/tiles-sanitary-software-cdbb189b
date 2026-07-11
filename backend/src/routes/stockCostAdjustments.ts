/**
 * Batch/Stock Cost Update routes — V2 Sprint 5E.
 *
 *   GET  /api/stock-cost-adjustments?dealerId=&productId=
 *   POST /api/stock-cost-adjustments
 *
 * No per-batch cost column exists anywhere in this codebase (confirmed by
 * inspection — `product_batches` tracks quantity only). "Batch Cost Update"
 * is therefore implemented as a dealer-wide PRODUCT cost adjustment
 * (`stock.average_cost_per_unit`, the only place unit cost is stored),
 * audited in `stock_cost_adjustments` — the SAME audit table Landed Cost
 * allocation writes to (`adjustment_type='landed_cost'`), so this endpoint
 * covers manual adjustments (`adjustment_type='manual'`) and both show up
 * in one unified history. Introducing true per-batch costing would require
 * touching COGS/valuation across Sales and Inventory Intelligence — out of
 * proportion for this sprint, documented transparently.
 *
 * "Inventory Value Update" needs zero additional wiring: every read in
 * `inventoryIntelligenceService.ts` queries `stock.average_cost_per_unit`
 * live on every call (no cache/materialized view), so a cost adjustment
 * here is reflected on the very next read — same "reuse, zero wiring"
 * precedent Sprint 5C established for the Availability Engine.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
    undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

// ── GET /api/stock-cost-adjustments ──────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const productId = (req.query.productId as string) || '';

    let q = db('stock_cost_adjustments as sca')
      .leftJoin('products as prod', 'prod.id', 'sca.product_id')
      .where({ 'sca.dealer_id': dealerId });
    if (productId) q = q.andWhere('sca.product_id', productId);

    const rows = await q
      .select('sca.*', 'prod.name as product_name', 'prod.sku as product_sku')
      .orderBy('sca.created_at', 'desc')
      .limit(200);
    res.json({ rows });
  } catch (err: any) {
    console.error('[stock-cost-adjustments/list]', err.message);
    res.status(500).json({ error: 'Failed to list cost adjustments' });
  }
});

const adjustmentSchema = z.object({
  product_id: z.string().uuid(),
  new_avg_cost: z.coerce.number().min(0),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

// ── POST /api/stock-cost-adjustments — manual adjustment ─────────────────
router.post('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = adjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { product_id, new_avg_cost, reason } = parsed.data;
    const userId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const stockRow = await trx('stock').where({ dealer_id: dealerId, product_id }).forUpdate().first('average_cost_per_unit');
      if (!stockRow) {
        throw Object.assign(new Error('No stock record found for this product.'), { status: 404 });
      }
      const oldAvgCost = Number(stockRow.average_cost_per_unit) || 0;

      await trx('stock').where({ dealer_id: dealerId, product_id }).update({ average_cost_per_unit: new_avg_cost });

      const [created] = await trx('stock_cost_adjustments')
        .insert({
          dealer_id: dealerId,
          product_id,
          old_avg_cost: oldAvgCost,
          new_avg_cost,
          reason,
          adjustment_type: 'manual',
          created_by: userId,
        })
        .returning('*');
      return created;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[stock-cost-adjustments/create]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to record cost adjustment' });
  }
});

export default router;
