/**
 * Manual Journal Entries — double-entry bookkeeping.
 *
 *   GET    /api/journal?from=&to=&limit=&offset=        list with totals
 *   GET    /api/journal/:id                              header + lines
 *   POST   /api/journal                                  create (auto voucher_no)
 *   DELETE /api/journal/:id                              delete
 *
 * Lines must balance: SUM(debit) === SUM(credit). dealer_admin only.
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
    res.status(403).json({ error: 'Only dealer_admin can manage journal entries' });
    return false;
  }
  return true;
}

const lineSchema = z.object({
  account: z.string().min(1).max(100),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  line_narration: z.string().optional().nullable(),
});

const createSchema = z.object({
  entry_date: z.string().min(1),
  narration: z.string().optional().nullable(),
  voucher_no: z.string().optional(),
  lines: z.array(lineSchema).min(2),
});

async function nextVoucherNo(dealerId: string, entryDate: string): Promise<string> {
  const ym = entryDate.slice(0, 7).replace('-', ''); // YYYYMM
  const prefix = `JV-${ym}-`;
  const row = await db('journal_entries')
    .where({ dealer_id: dealerId })
    .andWhere('voucher_no', 'like', `${prefix}%`)
    .max({ max: 'voucher_no' })
    .first();
  const last = (row?.max as string | undefined) ?? null;
  const lastNum = last ? parseInt(last.slice(prefix.length), 10) : 0;
  const next = String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(4, '0');
  return `${prefix}${next}`;
}

// ── LIST ──
router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const offset = parseInt((req.query.offset as string) || '0', 10);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const baseQ = db('journal_entries as je').where('je.dealer_id', dealerId);
  if (from) baseQ.where('je.entry_date', '>=', from);
  if (to) baseQ.where('je.entry_date', '<=', to);

  const totalRow = await baseQ.clone().count<{ count: string }[]>({ count: '*' }).first();
  const total = parseInt(totalRow?.count ?? '0', 10);

  const rows = await baseQ.clone()
    .leftJoin('journal_entry_lines as jel', 'jel.journal_entry_id', 'je.id')
    .groupBy('je.id')
    .select(
      'je.id', 'je.voucher_no', 'je.entry_date', 'je.narration', 'je.created_at',
    )
    .sum({ total_debit: 'jel.debit' })
    .sum({ total_credit: 'jel.credit' })
    .orderBy('je.entry_date', 'desc')
    .orderBy('je.voucher_no', 'desc')
    .limit(limit).offset(offset);

  res.json({ rows, total });
});

// ── GET ONE ──
router.get('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const header = await db('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!header) return res.status(404).json({ error: 'Not found' });
  const lines = await db('journal_entry_lines')
    .where({ journal_entry_id: header.id })
    .orderBy('line_order', 'asc')
    .select('*');
  res.json({ ...header, lines });
});

// ── CREATE ──
router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  const { entry_date, narration, lines } = parsed.data;

  // Validation: each line must have exactly one of debit/credit > 0, totals must match.
  let totalDebit = 0, totalCredit = 0;
  for (const l of lines) {
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      return res.status(400).json({ error: 'Each line must have either debit OR credit > 0' });
    }
    totalDebit += l.debit;
    totalCredit += l.credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: `Unbalanced entry: debit ${totalDebit} ≠ credit ${totalCredit}` });
  }

  const voucher_no = parsed.data.voucher_no || (await nextVoucherNo(dealerId, entry_date));

  try {
    const result = await db.transaction(async (trx) => {
      const [hdr] = await trx('journal_entries')
        .insert({
          dealer_id: dealerId,
          voucher_no,
          entry_date,
          narration: narration ?? null,
          created_by: req.user?.userId ?? null,
        })
        .returning(['id', 'voucher_no']);

      const lineRows = lines.map((l, i) => ({
        journal_entry_id: hdr.id,
        dealer_id: dealerId,
        account: l.account,
        debit: l.debit,
        credit: l.credit,
        line_narration: l.line_narration ?? null,
        line_order: i,
      }));
      await trx('journal_entry_lines').insert(lineRows);

      return hdr;
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Voucher number already exists' });
    console.error('journal create failed', e);
    res.status(500).json({ error: 'Failed to create journal entry' });
  }
});

// ── DELETE ──
router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const n = await db('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!n) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
