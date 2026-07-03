/**
 * GL spine API (P6-01 / P6-02 foundation).
 *
 *   GET  /api/gl/accounts?dealerId=           chart of accounts
 *   POST /api/gl/accounts/seed?dealerId=      seed default chart
 *   GET  /api/gl/trial-balance?dealerId=&asOf=
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { ensureDealerGlChart, getTrialBalance } from '../services/gl/glJournalWriter';
import { isGlSpineEnabled } from '../services/gl/glConfig';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

router.get(
  '/accounts',
  requireRole('dealer_admin', 'super_admin', 'accountant', 'manager'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await db('gl_accounts')
        .where({ dealer_id: dealerId, is_active: true })
        .orderBy('code');
      res.json({ rows, gl_spine_enabled: isGlSpineEnabled() });
    } catch (err: any) {
      console.error('[gl/accounts]', err.message);
      res.status(500).json({ error: 'Failed to load GL accounts' });
    }
  },
);

router.post(
  '/accounts/seed',
  requireRole('dealer_admin', 'super_admin'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      await db.transaction(async (trx) => {
        await ensureDealerGlChart(trx, dealerId);
      });
      const rows = await db('gl_accounts').where({ dealer_id: dealerId }).orderBy('code');
      res.json({ success: true, count: rows.length, rows });
    } catch (err: any) {
      console.error('[gl/accounts/seed]', err.message);
      res.status(500).json({ error: 'Failed to seed GL chart' });
    }
  },
);

router.get(
  '/trial-balance',
  requireRole('dealer_admin', 'super_admin', 'accountant', 'manager'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const asOf = (req.query.asOf as string | undefined) || undefined;
      const rows = await getTrialBalance(dealerId, asOf);
      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
      res.json({
        rows,
        totals: {
          debit: Math.round(totalDebit * 100) / 100,
          credit: Math.round(totalCredit * 100) / 100,
        },
        gl_spine_enabled: isGlSpineEnabled(),
        as_of: asOf ?? null,
      });
    } catch (err: any) {
      console.error('[gl/trial-balance]', err.message);
      res.status(500).json({ error: 'Failed to load trial balance' });
    }
  },
);

export default router;
