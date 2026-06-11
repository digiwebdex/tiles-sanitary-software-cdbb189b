/**
 * Supplier payables — FIFO payment across oldest due purchase bills.
 *
 *   GET  /api/payables/outstanding?dealerId=
 *   POST /api/payables/payment?dealerId=
 *
 * P4-02: supplier totals from `mv_supplier_payable`; bill rows for FIFO allocation UI.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { recordSupplierPaymentFifo } from '../lib/supplierPayment';
import { db } from '../db/connection';
import { listPayablesOutstanding } from '../services/reportQueryService';

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

router.get('/outstanding', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const result = await listPayablesOutstanding(dealerId);
    res.json(result);
  } catch (err: any) {
    console.error('[payables/outstanding]', err.message);
    res.status(500).json({ error: 'Failed to load supplier payables' });
  }
});

const payablesPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional(),
  paid_account_id: z.string().uuid().optional().nullable(),
  purchase_id: z.string().uuid().optional(),
});

router.post(
  '/payment',
  requireRole('dealer_admin', 'manager', 'accountant'),
  async (req: Request, res: Response) => {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = payablesPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const { supplier_id, amount, note, paid_account_id, purchase_id } = parsed.data;

    try {
      const result = await db.transaction(async (trx) =>
        recordSupplierPaymentFifo(trx, {
          dealerId,
          supplierId: supplier_id,
          amount,
          note,
          paid_account_id,
          purchaseId: purchase_id,
        }),
      );
      res.status(201).json({ ok: true, ...result });
    } catch (err: any) {
      console.error('[payables/payment]', err.message);
      res.status(400).json({ error: err.message || 'Failed to record supplier payment' });
    }
  },
);

export default router;
