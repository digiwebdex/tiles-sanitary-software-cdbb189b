/**
 * Bank Accounts route — Phase 1 (Multi-Bank), extended V2 Sprint 6C with
 * GL-wired Deposit/Withdrawal (the Bank Book's own write endpoints — the
 * pre-existing generic `/entry` below remains unchanged, for backward
 * compatibility, and still does NOT reach the GL).
 *
 *   GET    /api/bank-accounts?dealerId=
 *   POST   /api/bank-accounts                     (create)
 *   PUT    /api/bank-accounts/:id                 (update meta — not opening balance)
 *   DELETE /api/bank-accounts/:id                 (soft delete via is_active=false)
 *   GET    /api/bank-accounts/:id/balance         (current computed balance)
 *   GET    /api/bank-accounts/:id/ledger?from=&to=&page=&pageSize=
 *   POST   /api/bank-accounts/:id/entry           ({ type, amount, description, entry_date }) — legacy, no GL
 *   POST   /api/bank-accounts/:id/deposit         ({ amount, description, entry_date?, payment_mode?, cheque_no? })
 *   POST   /api/bank-accounts/:id/withdrawal      (same shape)
 *
 * dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { recordBankDeposit, recordBankWithdrawal } from '../services/accounting/cashBankTransactions';
import { normalizePaymentMode } from '../lib/paymentModes';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealer_id as string | undefined);
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
    res.status(403).json({ error: 'Only dealer_admin can manage bank accounts' });
    return false;
  }
  return true;
}

const CreateSchema = z.object({
  bank_name: z.string().min(1).max(120),
  account_name: z.string().min(1).max(120),
  account_number: z.string().min(1).max(60),
  branch: z.string().max(120).optional().nullable(),
  routing_no: z.string().max(30).optional().nullable(),
  account_type: z.enum(['current', 'savings', 'cc']).default('current'),
  opening_balance: z.coerce.number().default(0),
  opened_on: z.string().optional(),
  notes: z.string().optional().nullable(),
});

const UpdateSchema = CreateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

const EntrySchema = z.object({
  type: z.enum(['deposit', 'withdrawal', 'sale', 'payment', 'expense', 'transfer', 'adjustment']),
  amount: z.coerce.number(),
  description: z.string().optional().nullable(),
  entry_date: z.string().optional(),
  reference_type: z.string().max(50).optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const rows = await db('bank_accounts')
    .where({ dealer_id: dealerId })
    .orderBy([{ column: 'is_active', order: 'desc' }, { column: 'bank_name' }]);

  // Attach computed balance per account
  const ids = rows.map(r => r.id);
  let balances: Record<string, number> = {};
  if (ids.length) {
    const sums = await db('bank_ledger')
      .select('bank_account_id')
      .sum({ total: 'amount' })
      .where({ dealer_id: dealerId })
      .whereIn('bank_account_id', ids)
      .groupBy('bank_account_id');
    balances = Object.fromEntries(sums.map((s: any) => [s.bank_account_id, Number(s.total) || 0]));
  }
  res.json(rows.map(r => ({ ...r, balance: balances[r.id] ?? Number(r.opening_balance) })));
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const [row] = await db('bank_accounts').insert({
      dealer_id: dealerId,
      ...parsed.data,
    }).returning('*');
    res.status(201).json(row);
  } catch (e: any) {
    if (String(e.message).includes('unique')) {
      res.status(409).json({ error: 'Account number already exists for this dealer' });
    } else { res.status(500).json({ error: e.message }); }
  }
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { opening_balance, ...rest } = parsed.data; // never allow opening_balance edit post-create
  const [row] = await db('bank_accounts')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...rest, updated_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('bank_accounts')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() });
  res.json({ ok: true });
});

router.get('/:id/balance', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const sum = await db('bank_ledger')
    .where({ dealer_id: dealerId, bank_account_id: req.params.id })
    .sum({ total: 'amount' }).first();
  res.json({ balance: Number(sum?.total) || 0 });
});

router.get('/:id/ledger', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const pageSize = Math.min(100, parseInt(String(req.query.pageSize ?? '25'), 10));
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = db('bank_ledger')
    .where({ dealer_id: dealerId, bank_account_id: req.params.id });
  if (from) q.where('entry_date', '>=', from);
  if (to) q.where('entry_date', '<=', to);
  const totalRow = await q.clone().count<{ count: string }[]>('id as count').first();
  const rows = await q.orderBy([{ column: 'entry_date', order: 'desc' }, { column: 'created_at', order: 'desc' }])
    .limit(pageSize).offset((page - 1) * pageSize);
  res.json({ rows, total: Number(totalRow?.count ?? 0), page, pageSize });
});

router.post('/:id/entry', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = EntrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const acct = await db('bank_accounts').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!acct) { res.status(404).json({ error: 'Bank account not found' }); return; }
  // Convention: deposit/sale/transfer-in => positive; withdrawal/payment/expense => caller passes signed amount.
  // To make the API ergonomic we sign automatically based on type if amount provided is positive.
  let amt = parsed.data.amount;
  const debits = ['withdrawal', 'payment', 'expense'];
  if (debits.includes(parsed.data.type) && amt > 0) amt = -amt;
  const [row] = await db('bank_ledger').insert({
    dealer_id: dealerId,
    bank_account_id: req.params.id,
    type: parsed.data.type,
    amount: amt,
    description: parsed.data.description ?? null,
    entry_date: parsed.data.entry_date ?? db.fn.now(),
    reference_type: parsed.data.reference_type ?? null,
    reference_id: parsed.data.reference_id ?? null,
    created_by: req.user?.userId ?? null,
  }).returning('*');
  res.status(201).json(row);
});

const MovementSchema = z.object({
  amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(500),
  entry_date: z.string().optional(),
  payment_mode: z.string().optional().nullable(),
  cheque_no: z.string().trim().max(30).optional().nullable(),
  reference_type: z.string().max(50).optional().nullable(),
  reference_id: z.string().uuid().optional().nullable(),
});

router.post('/:id/deposit', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = MovementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const result = await db.transaction((trx) => recordBankDeposit(trx, {
      dealerId,
      bankAccountId: req.params.id,
      amount: parsed.data.amount,
      description: parsed.data.description,
      entryDate: parsed.data.entry_date || new Date().toISOString().slice(0, 10),
      paymentMode: normalizePaymentMode(parsed.data.payment_mode ?? undefined),
      chequeNo: parsed.data.cheque_no ?? null,
      referenceType: parsed.data.reference_type ?? null,
      referenceId: parsed.data.reference_id ?? null,
      postedBy: req.user?.userId ?? null,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[bank-accounts/deposit]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record bank deposit' });
  }
});

router.post('/:id/withdrawal', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = MovementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const result = await db.transaction((trx) => recordBankWithdrawal(trx, {
      dealerId,
      bankAccountId: req.params.id,
      amount: parsed.data.amount,
      description: parsed.data.description,
      entryDate: parsed.data.entry_date || new Date().toISOString().slice(0, 10),
      paymentMode: normalizePaymentMode(parsed.data.payment_mode ?? undefined),
      chequeNo: parsed.data.cheque_no ?? null,
      referenceType: parsed.data.reference_type ?? null,
      referenceId: parsed.data.reference_id ?? null,
      postedBy: req.user?.userId ?? null,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[bank-accounts/withdrawal]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record bank withdrawal' });
  }
});

export default router;
