/**
 * Cashbook (Consolidated Cash + Bank movements) — Phase 1, extended V2
 * Sprint 6C with the Cash Ledger's own write endpoints.
 *
 *   GET  /api/cashbook?dealerId=&from=&to=&account=cash|bank|all&bankAccountId=
 *   POST /api/cashbook/receipt   ({ amount, description, entry_date?, payment_mode?, reference_type?, reference_id? })
 *   POST /api/cashbook/payment   (same shape)
 *
 * Returns merged ledger rows from `cash_ledger` (account='cash') and
 * `bank_ledger` (account='bank') with running balance, opening/closing
 * totals, and a category summary. dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { recordCashReceipt, recordCashPayment } from '../services/accounting/cashBankTransactions';
import { normalizePaymentMode } from '../lib/paymentModes';

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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can view cashbook' });
    return false;
  }
  return true;
}

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;
  const account = (req.query.account as string | undefined) || 'all';
  const bankAccountId = req.query.bankAccountId as string | undefined;

  // ── Cash entries ──
  let cashRows: any[] = [];
  let cashOpening = 0;
  if (account === 'cash' || account === 'all') {
    const q = db('cash_ledger').where({ dealer_id: dealerId });
    if (from) q.where('entry_date', '>=', from);
    if (to) q.where('entry_date', '<=', to);
    cashRows = await q.select(
      'id', 'entry_date', 'type', 'amount', 'description',
      'reference_type', 'reference_id', 'created_at', 'payment_mode',
      db.raw("'cash' as account_kind"),
      db.raw('NULL::uuid as bank_account_id'),
    );
    if (from) {
      const op = await db('cash_ledger').where({ dealer_id: dealerId })
        .where('entry_date', '<', from).sum({ total: 'amount' }).first();
      cashOpening = Number(op?.total) || 0;
    }
  }

  // ── Bank entries ──
  let bankRows: any[] = [];
  let bankOpening = 0;
  if (account === 'bank' || account === 'all') {
    const q = db('bank_ledger').where({ dealer_id: dealerId });
    if (bankAccountId) q.where({ bank_account_id: bankAccountId });
    if (from) q.where('entry_date', '>=', from);
    if (to) q.where('entry_date', '<=', to);
    bankRows = await q.select(
      'id', 'entry_date', 'type', 'amount', 'description',
      'reference_type', 'reference_id', 'created_at', 'bank_account_id', 'payment_mode',
      db.raw("'bank' as account_kind"),
    );
    if (from) {
      const opQ = db('bank_ledger').where({ dealer_id: dealerId }).where('entry_date', '<', from);
      if (bankAccountId) opQ.where({ bank_account_id: bankAccountId });
      const op = await opQ.sum({ total: 'amount' }).first();
      bankOpening = Number(op?.total) || 0;
    }
  }

  // Merge & sort chronologically
  const merged = [...cashRows, ...bankRows].sort((a, b) => {
    const d = String(a.entry_date).localeCompare(String(b.entry_date));
    if (d !== 0) return d;
    return String(a.created_at).localeCompare(String(b.created_at));
  });

  let running = cashOpening + bankOpening;
  const opening = running;
  const withRunning = merged.map(r => {
    running += Number(r.amount);
    return { ...r, amount: Number(r.amount), running_balance: running };
  });

  // Summary by type
  const summary: Record<string, { in: number; out: number }> = {};
  for (const r of withRunning) {
    const k = r.type;
    summary[k] = summary[k] || { in: 0, out: 0 };
    if (r.amount >= 0) summary[k].in += r.amount;
    else summary[k].out += Math.abs(r.amount);
  }

  res.json({
    opening,
    closing: running,
    rows: withRunning,
    summary,
    filters: { from, to, account, bankAccountId: bankAccountId ?? null },
  });
});

const MovementSchema = z.object({
  amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(500),
  entry_date: z.string().optional(),
  payment_mode: z.string().optional().nullable(),
  reference_type: z.string().max(50).optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
});

router.post('/receipt', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = MovementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const result = await db.transaction((trx) => recordCashReceipt(trx, {
      dealerId,
      amount: parsed.data.amount,
      description: parsed.data.description,
      entryDate: parsed.data.entry_date || new Date().toISOString().slice(0, 10),
      paymentMode: normalizePaymentMode(parsed.data.payment_mode ?? undefined),
      referenceType: parsed.data.reference_type ?? null,
      referenceId: parsed.data.reference_id ?? null,
      postedBy: req.user?.userId ?? null,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[cashbook/receipt]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record cash receipt' });
  }
});

router.post('/payment', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = MovementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const result = await db.transaction((trx) => recordCashPayment(trx, {
      dealerId,
      amount: parsed.data.amount,
      description: parsed.data.description,
      entryDate: parsed.data.entry_date || new Date().toISOString().slice(0, 10),
      paymentMode: normalizePaymentMode(parsed.data.payment_mode ?? undefined),
      referenceType: parsed.data.reference_type ?? null,
      referenceId: parsed.data.reference_id ?? null,
      postedBy: req.user?.userId ?? null,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[cashbook/payment]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record cash payment' });
  }
});

export default router;
