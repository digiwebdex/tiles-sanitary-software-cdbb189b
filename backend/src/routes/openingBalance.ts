/**
 * Opening Balance posting — V2 Sprint 6B.
 *
 *   POST /api/opening-balance/customers/:id/post?dealerId=
 *   POST /api/opening-balance/suppliers/:id/post?dealerId=
 *
 * `customers.opening_balance`/`suppliers.opening_balance` are set once at
 * creation and never edited again, but were never mirrored into any ledger
 * or the GL (see docs/SPRINT6B_AR_AP.md). Rather than silently backfilling
 * every dealer's existing customers/suppliers as a side effect of this
 * migration (an unannounced posting into their books), this is an explicit,
 * idempotent, dealer_admin-triggered action — safe to call any number of
 * times; a second call for an already-posted party is a no-op.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';
import { postCustomerOpeningBalance, postSupplierOpeningBalance } from '../services/accounting/openingBalancePosting';

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

const MANAGE_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'] as const;

router.post(
  '/customers/:id/post',
  requireRole(...MANAGE_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req: Request, res: Response) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const customer = await db('customers').where({ id: req.params.id, dealer_id: dealerId }).first('id', 'opening_balance', 'created_at');
      if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }

      const result = await db.transaction((trx) => postCustomerOpeningBalance(trx, {
        dealerId,
        customerId: customer.id,
        amount: Number(customer.opening_balance) || 0,
        entryDate: new Date(customer.created_at).toISOString().slice(0, 10),
        postedBy: req.user?.userId ?? null,
      }));

      res.json(result);
    } catch (err: any) {
      console.error('[opening-balance/customers/post]', err.message);
      res.status(500).json({ error: 'Failed to post customer opening balance' });
    }
  },
);

router.post(
  '/suppliers/:id/post',
  requireRole(...MANAGE_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req: Request, res: Response) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const supplier = await db('suppliers').where({ id: req.params.id, dealer_id: dealerId }).first('id', 'opening_balance', 'created_at');
      if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }

      const result = await db.transaction((trx) => postSupplierOpeningBalance(trx, {
        dealerId,
        supplierId: supplier.id,
        amount: Number(supplier.opening_balance) || 0,
        entryDate: new Date(supplier.created_at).toISOString().slice(0, 10),
        postedBy: req.user?.userId ?? null,
      }));

      res.json(result);
    } catch (err: any) {
      console.error('[opening-balance/suppliers/post]', err.message);
      res.status(500).json({ error: 'Failed to post supplier opening balance' });
    }
  },
);

export default router;
