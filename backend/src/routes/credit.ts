/**
 * Credit Control route — Phase 3U-12 / P4-02 read-model cutover.
 *
 *   GET /api/credit/report?dealerId=
 *
 * Per-customer outstanding from `mv_customer_outstanding` (sales-header AR).
 * dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import {
  getCustomerOldestUnpaidMapFromReadModel,
  getCustomerOutstandingMapFromReadModel,
} from '../services/reportQueryService';

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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can view credit report' });
    return false;
  }
  return true;
}

type CreditStatus = 'safe' | 'near' | 'exceeded' | 'no_limit';

function classify(outstanding: number, creditLimit: number): CreditStatus {
  if (creditLimit <= 0) return 'no_limit';
  if (outstanding > creditLimit) return 'exceeded';
  if (outstanding / creditLimit >= 0.8) return 'near';
  return 'safe';
}

router.get('/report', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;

    const [customers, outstandingMap, oldestMap] = await Promise.all([
      db('customers')
        .select('id', 'name', 'credit_limit', 'max_overdue_days')
        .where({ dealer_id: dealerId, status: 'active' })
        .orderBy('name'),
      getCustomerOutstandingMapFromReadModel(dealerId),
      getCustomerOldestUnpaidMapFromReadModel(dealerId),
    ]);

    if (customers.length === 0) {
      res.json({ rows: [] });
      return;
    }

    const today = Date.now();
    const rows = customers
      .map((c) => {
        const outstanding = outstandingMap.get(c.id) ?? 0;
        const oldest = oldestMap.get(c.id) ?? null;
        const overdue_days = oldest
          ? Math.max(0, Math.floor((today - new Date(oldest).getTime()) / 86_400_000))
          : 0;
        const credit_limit = Number(c.credit_limit ?? 0);
        const status = classify(outstanding, credit_limit);
        const utilization_pct = credit_limit > 0 ? Math.round((outstanding / credit_limit) * 100) : 0;
        return {
          customer_id: c.id,
          customer_name: c.name,
          credit_limit,
          max_overdue_days: Number(c.max_overdue_days ?? 0),
          current_outstanding: outstanding,
          oldest_due_date: oldest,
          overdue_days,
          status,
          utilization_pct,
        };
      })
      .filter((r) => r.current_outstanding > 0 || r.credit_limit > 0)
      .sort((a, b) => b.current_outstanding - a.current_outstanding);

    res.json({ rows });
  } catch (err: any) {
    console.error('[credit/report]', err.message);
    res.status(500).json({ error: 'Failed to load credit report' });
  }
});

export default router;
