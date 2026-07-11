/**
 * Inventory Intelligence route — V2 Sprint 3D.
 *
 *   GET  /api/inventory-intelligence/thresholds?dealerId=
 *   PUT  /api/inventory-intelligence/thresholds/:productId
 *   GET  /api/inventory-intelligence/low-stock?dealerId=
 *   GET  /api/inventory-intelligence/stock-aging?dealerId=
 *   GET  /api/inventory-intelligence/analytics?dealerId=      (ABC/XYZ)
 *   GET  /api/inventory-intelligence/value?dealerId=          (Stock/Warehouse/Godown Value)
 *   GET  /api/inventory-intelligence/turnover?dealerId=
 *   GET  /api/inventory-intelligence/health?dealerId=
 *
 * Read-only except the threshold upsert. Dead/Slow/Fast-moving analysis and
 * Reorder Intelligence (Purchase/Reorder suggestions) already exist in full
 * (demandPlanning.ts + autoPo.ts, surfaced via the Reports module and
 * /purchases/auto-draft respectively) — deliberately NOT duplicated here.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  getLowStockView, upsertStockThreshold, listStockThresholds,
  getStockAging, getInventoryAnalytics, getInventoryValue, getInventoryTurnover, getInventoryHealth,
} from '../services/inventoryIntelligenceService';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage stock thresholds' });
    return false;
  }
  return true;
}

router.get('/thresholds', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    res.json({ rows: await listStockThresholds(dealerId) });
  } catch (err: any) {
    console.error('[inventory-intelligence/thresholds GET]', err.message);
    res.status(500).json({ error: 'Failed to load stock thresholds' });
  }
});

const ThresholdSchema = z.object({
  min_stock: z.coerce.number().min(0).nullable().optional(),
  max_stock: z.coerce.number().min(0).nullable().optional(),
});

router.put('/thresholds/:productId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = ThresholdSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  if (
    parsed.data.min_stock != null && parsed.data.max_stock != null &&
    parsed.data.min_stock > parsed.data.max_stock
  ) {
    res.status(400).json({ error: 'min_stock cannot exceed max_stock' });
    return;
  }
  try {
    const row = await upsertStockThreshold(dealerId, req.params.productId, parsed.data);
    res.json(row);
  } catch (err: any) {
    console.error('[inventory-intelligence/thresholds PUT]', err.message);
    res.status(400).json({ error: err.message || 'Failed to save stock thresholds' });
  }
});

router.get('/low-stock', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    res.json({ rows: await getLowStockView(dealerId) });
  } catch (err: any) {
    console.error('[inventory-intelligence/low-stock]', err.message);
    res.status(500).json({ error: 'Failed to load low stock view' });
  }
});

router.get('/stock-aging', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    res.json(await getStockAging(dealerId));
  } catch (err: any) {
    console.error('[inventory-intelligence/stock-aging]', err.message);
    res.status(500).json({ error: 'Failed to load stock aging' });
  }
});

router.get('/analytics', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ rows: await getInventoryAnalytics(dealerId) });
  } catch (err: any) {
    console.error('[inventory-intelligence/analytics]', err.message);
    res.status(500).json({ error: 'Failed to load ABC/XYZ analytics' });
  }
});

router.get('/value', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getInventoryValue(dealerId));
  } catch (err: any) {
    console.error('[inventory-intelligence/value]', err.message);
    res.status(500).json({ error: 'Failed to load inventory value' });
  }
});

router.get('/turnover', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await getInventoryTurnover(dealerId));
  } catch (err: any) {
    console.error('[inventory-intelligence/turnover]', err.message);
    res.status(500).json({ error: 'Failed to load inventory turnover' });
  }
});

router.get('/health', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    res.json(await getInventoryHealth(dealerId));
  } catch (err: any) {
    console.error('[inventory-intelligence/health]', err.message);
    res.status(500).json({ error: 'Failed to load inventory health dashboard' });
  }
});

export default router;
