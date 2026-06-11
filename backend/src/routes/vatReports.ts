/**
 * Phase 5 — VAT / Mushak register reports (P5-04).
 *
 *   GET /api/reports/vat/sales-register?dealerId=&from=&to=     Mushak 6.3 style
 *   GET /api/reports/vat/purchase-register?dealerId=&from=&to= Mushak 6.1 style
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import {
  fetchMushak61PurchaseRegister,
  fetchMushak63SalesRegister,
} from '../services/vatReportService';

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
  res.status(403).json({ error: 'VAT reports require dealer_admin role' });
  return false;
}

function parsePeriod(req: Request, res: Response): { from: string; to: string } | null {
  const from = (req.query.from as string | undefined) || '';
  const to = (req.query.to as string | undefined) || '';
  if (!from || !to) {
    res.status(400).json({ error: 'from and to dates are required (YYYY-MM-DD)' });
    return null;
  }
  return { from, to };
}

router.get('/sales-register', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  try {
    const result = await fetchMushak63SalesRegister(dealerId, period.from, period.to);
    res.json({ ...result, period, form: 'mushak-6.3' });
  } catch (err: any) {
    console.error('[vat.sales-register]', err.message);
    res.status(500).json({ error: 'Failed to load VAT sales register' });
  }
});

router.get('/purchase-register', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const period = parsePeriod(req, res);
  if (!period) return;
  try {
    const result = await fetchMushak61PurchaseRegister(dealerId, period.from, period.to);
    res.json({ ...result, period, form: 'mushak-6.1' });
  } catch (err: any) {
    console.error('[vat.purchase-register]', err.message);
    res.status(500).json({ error: 'Failed to load VAT purchase register' });
  }
});

export default router;
