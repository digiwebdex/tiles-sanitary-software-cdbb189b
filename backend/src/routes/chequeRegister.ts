/**
 * Cheque Register — V2 Sprint 6C.
 *
 *   GET  /api/cheque-register?dealerId=&bankAccountId=&status=
 *   POST /api/cheque-register/:bankLedgerId/status   ({ status })
 *
 * A cheque IS a `bank_ledger` row with `cheque_no` set (written by
 * `POST /api/bank-accounts/:id/withdrawal` with a `cheque_no`) — no separate
 * table. This route only adds: listing/filtering those rows, and a guarded
 * status transition (issued -> presented -> cleared, or -> bounced/cancelled).
 * Reaching 'cleared' also marks the row `is_cleared` for Bank Reconciliation
 * (the same flag a statement match sets) — a cheque the dealer has already
 * confirmed cleared doesn't need to separately wait for a bank statement line.
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
    res.status(403).json({ error: 'Only dealer_admin can manage the cheque register' });
    return false;
  }
  return true;
}

const CHEQUE_STATUSES = ['issued', 'presented', 'cleared', 'bounced', 'cancelled'] as const;
type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  issued: ['presented', 'cleared', 'bounced', 'cancelled'],
  presented: ['cleared', 'bounced'],
  cleared: [],
  bounced: ['issued'], // re-issue the same cheque after resolving with the payee
  cancelled: [],
};

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const bankAccountId = req.query.bankAccountId as string | undefined;
  const status = req.query.status as string | undefined;

  const q = db('bank_ledger as bl')
    .leftJoin('bank_accounts as ba', 'ba.id', 'bl.bank_account_id')
    .where({ 'bl.dealer_id': dealerId })
    .whereNotNull('bl.cheque_no');
  if (bankAccountId) q.andWhere('bl.bank_account_id', bankAccountId);
  if (status) q.andWhere('bl.cheque_status', status);

  const rows = await q
    .orderBy('bl.entry_date', 'desc')
    .select(
      'bl.id', 'bl.bank_account_id', 'bl.cheque_no', 'bl.cheque_status', 'bl.amount',
      'bl.description', 'bl.entry_date', 'bl.is_cleared', 'bl.cleared_at',
      'ba.bank_name', 'ba.account_number',
    );
  res.json({ rows: rows.map((r: any) => ({ ...r, amount: Number(r.amount) })) });
});

const StatusSchema = z.object({ status: z.enum(CHEQUE_STATUSES) });

router.post('/:bankLedgerId/status', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

  try {
    const row = await db.transaction(async (trx) => {
      const cheque = await trx('bank_ledger')
        .where({ id: req.params.bankLedgerId, dealer_id: dealerId })
        .whereNotNull('cheque_no')
        .first();
      if (!cheque) return null;

      const current = cheque.cheque_status as ChequeStatus;
      const next = parsed.data.status;
      if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
        throw Object.assign(new Error(`Cannot move a cheque from '${current}' to '${next}'.`), { status: 409 });
      }

      const update: Record<string, unknown> = { cheque_status: next };
      if (next === 'cleared') {
        update.is_cleared = true;
        update.cleared_at = trx.fn.now();
      }

      const [updated] = await trx('bank_ledger').where({ id: cheque.id }).update(update).returning('*');
      return updated;
    });
    if (!row) { res.status(404).json({ error: 'Cheque not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[cheque-register/status]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update cheque status' });
  }
});

export default router;
