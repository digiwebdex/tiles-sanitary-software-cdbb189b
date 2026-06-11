/**
 * P4-05 — Posting trace API for drill-down from balance reports.
 *
 *   GET /api/postings/trace?dealerId=&lineDomain=customer|supplier&partyId=
 *   GET /api/postings/batch/:batchId?dealerId=
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import {
  getPostingBatchDetail,
  tracePartyPostings,
  type TraceLineDomain,
} from '../services/postingTraceService';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
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

function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return true;
  res.status(403).json({ error: 'Posting trace requires dealer_admin role' });
  return false;
}

const traceQuerySchema = z.object({
  lineDomain: z.enum(['customer', 'supplier']),
  partyId: z.string().uuid(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/trace', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const parsed = traceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
    return;
  }

  try {
    const result = await tracePartyPostings(
      dealerId,
      parsed.data.lineDomain as TraceLineDomain,
      parsed.data.partyId,
      { from: parsed.data.from ?? null, to: parsed.data.to ?? null, limit: parsed.data.limit },
    );
    res.json(result);
  } catch (err: any) {
    console.error('[postings.trace]', err.message);
    res.status(500).json({ error: 'Failed to load posting trace' });
  }
});

router.get('/batch/:batchId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const batch = await getPostingBatchDetail(dealerId, req.params.batchId);
    if (!batch) {
      res.status(404).json({ error: 'Posting batch not found' });
      return;
    }
    res.json(batch);
  } catch (err: any) {
    console.error('[postings.batch]', err.message);
    res.status(500).json({ error: 'Failed to load posting batch' });
  }
});

export default router;
