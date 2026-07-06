/**
 * Availability Engine route — V2 Sprint 3C.
 *
 *   GET /api/availability/:productId?dealerId=          product-level breakdown
 *   GET /api/availability/:productId/batches?dealerId=   per-batch (shade/lot/caliber) breakdown
 *
 * Read-only. See services/availabilityService.ts for the formula and the
 * reasoning behind each term. Not wired into Sales/Purchase/Reports' own
 * existing computations (see that sprint's "no Sales workflow changes" /
 * "no Reports redesign" constraints) — this is a new, additive read surface.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { computeAvailability, computeBatchAvailability } from '../services/availabilityService';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = req.query.dealerId as string | undefined;
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

router.get('/:productId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const breakdown = await computeAvailability(dealerId, req.params.productId);
    res.json(breakdown);
  } catch (err: any) {
    console.error('[availability/get]', err.message);
    res.status(400).json({ error: err.message || 'Failed to compute availability' });
  }
});

router.get('/:productId/batches', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await computeBatchAvailability(dealerId, req.params.productId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[availability/batches]', err.message);
    res.status(400).json({ error: err.message || 'Failed to compute batch availability' });
  }
});

export default router;
