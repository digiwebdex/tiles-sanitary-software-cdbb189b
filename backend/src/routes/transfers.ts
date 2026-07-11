/**
 * Cash/Bank Transfers — V2 Sprint 6C.
 *
 *   POST /api/transfers   ({ from, to, amount, description, entry_date? })
 *     from/to: { kind: 'cash' } | { kind: 'bank', bank_account_id }
 *   GET  /api/transfers?dealerId=&from=&to=   (list, cash+bank legs paired by reference_id)
 *
 * A single endpoint for both "Cash Transfer" (cash<->bank) and "Bank
 * Transfer" (bank<->bank) — both are the exact same operation shape, only
 * the endpoint kinds differ. See services/accounting/cashBankTransactions.ts
 * for the two-leg ledger write + single balanced GL batch.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { recordTransfer } from '../services/accounting/cashBankTransactions';

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
    res.status(403).json({ error: 'Only dealer_admin can record transfers' });
    return false;
  }
  return true;
}

const EndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cash') }),
  z.object({ kind: z.literal('bank'), bank_account_id: z.string().uuid() }),
]);

const TransferSchema = z.object({
  from: EndpointSchema,
  to: EndpointSchema,
  amount: z.coerce.number().positive(),
  description: z.string().trim().min(1).max(500),
  entry_date: z.string().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = TransferSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const { from, to, amount, description, entry_date } = parsed.data;

  try {
    const result = await db.transaction((trx) => recordTransfer(trx, {
      dealerId,
      from: from.kind === 'cash' ? { kind: 'cash' } : { kind: 'bank', bankAccountId: from.bank_account_id },
      to: to.kind === 'cash' ? { kind: 'cash' } : { kind: 'bank', bankAccountId: to.bank_account_id },
      amount,
      description,
      entryDate: entry_date || new Date().toISOString().slice(0, 10),
      postedBy: req.user?.userId ?? null,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    console.error('[transfers/create]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record transfer' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const from = (req.query.from as string | undefined) || undefined;
  const to = (req.query.to as string | undefined) || undefined;

  const cashQ = db('cash_ledger').where({ dealer_id: dealerId, type: 'transfer', reference_type: 'transfer' });
  const bankQ = db('bank_ledger').where({ dealer_id: dealerId, type: 'transfer', reference_type: 'transfer' });
  if (from) { cashQ.andWhere('entry_date', '>=', from); bankQ.andWhere('entry_date', '>=', from); }
  if (to) { cashQ.andWhere('entry_date', '<=', to); bankQ.andWhere('entry_date', '<=', to); }

  const [cashRows, bankRows] = await Promise.all([
    cashQ.select('id', 'amount', 'description', 'entry_date', 'reference_id', 'created_at', db.raw("'cash' as leg_kind")),
    bankQ.select('id', 'amount', 'description', 'entry_date', 'reference_id', 'created_at', 'bank_account_id', db.raw("'bank' as leg_kind")),
  ]);

  const legs = [...cashRows, ...bankRows];
  const seen = new Set<string>();
  const pairs: Array<{ outLeg: any; inLeg: any }> = [];
  for (const leg of legs) {
    if (seen.has(leg.id)) continue;
    if (Number(leg.amount) >= 0) continue; // start from the outgoing leg
    const inLeg = legs.find((l) => l.id === leg.reference_id);
    if (!inLeg) continue;
    seen.add(leg.id); seen.add(inLeg.id);
    pairs.push({ outLeg: leg, inLeg });
  }
  pairs.sort((a, b) => String(b.outLeg.entry_date).localeCompare(String(a.outLeg.entry_date)));

  res.json({ rows: pairs });
});

export default router;
