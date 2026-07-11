/**
 * Manual Journal Entries — double-entry bookkeeping.
 * Extended V2 Sprint 6A per the approved docs/ACCOUNTING_V2_ARCHITECTURE.md
 * Rev 2 §2.4 with a Draft -> Approve -> Post -> Reverse workflow, on top of
 * the existing, unmodified balance/line validation.
 *
 *   GET    /api/journal?from=&to=&limit=&offset=&status=  list with totals
 *   GET    /api/journal/:id                                header + lines
 *   POST   /api/journal                                    create + immediately post (unchanged, backward-compatible)
 *   POST   /api/journal/draft                               create as draft (new)
 *   POST   /api/journal/:id/approve                         draft -> approved (new)
 *   POST   /api/journal/:id/post                             draft/approved -> posted (new; enforces period lock)
 *   POST   /api/journal/:id/reverse                          posted -> creates a new, mirrored, posted reversing entry (new)
 *   DELETE /api/journal/:id                                  void (draft only, per Immutable Journal — was previously unrestricted)
 *
 * Immutability: once an entry reaches status='posted', its own row and
 * lines are never edited or voided again — DELETE now only works for
 * status='draft'. Correcting a posted entry is done via /reverse, which
 * creates a NEW posted entry (mirroring `posting_batches.reverses_batch_id`'s
 * already-established pattern exactly) rather than touching the original.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { restrictSuperAdminOnFinancials } from '../middleware/roles';
import { assertPeriodOpen, PeriodClosedError } from '../services/accounting/periodLock';

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

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'];
const DRAFT_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'senior_accountant', 'finance_manager'];
const POST_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'];

function requireAnyRole(req: Request, res: Response, roles: string[]): boolean {
  const userRoles = (req.user?.roles ?? []) as string[];
  if (!roles.some((r) => userRoles.includes(r))) {
    res.status(403).json({ error: `Requires one of: ${roles.join(', ')}` });
    return false;
  }
  return true;
}

const lineSchema = z.object({
  account: z.string().min(1).max(100),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  line_narration: z.string().optional().nullable(),
  // V2 Sprint 6D — optional per-line Cost Center assignment.
  cost_center_id: z.string().uuid().optional().nullable(),
});

const createSchema = z.object({
  entry_date: z.string().min(1),
  narration: z.string().optional().nullable(),
  voucher_no: z.string().optional(),
  lines: z.array(lineSchema).min(2),
});

export function validateBalance(lines: z.infer<typeof lineSchema>[]): { ok: true } | { ok: false; error: string } {
  let totalDebit = 0, totalCredit = 0;
  for (const l of lines) {
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      return { ok: false, error: 'Each line must have either debit OR credit > 0' };
    }
    totalDebit += l.debit;
    totalCredit += l.credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return { ok: false, error: `Unbalanced entry: debit ${totalDebit} ≠ credit ${totalCredit}` };
  }
  return { ok: true };
}

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

async function auditLog(trx: any, req: Request, dealerId: string, action: string, recordId: string, oldData: any, newData: any) {
  await trx('audit_logs').insert({
    dealer_id: dealerId,
    user_id: req.user?.userId ?? null,
    action,
    table_name: 'journal_entries',
    record_id: recordId,
    old_data: oldData ? JSON.stringify(oldData) : null,
    new_data: newData ? JSON.stringify(newData) : null,
    ip_address: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  });
}

// ── LIST ──
router.get('/', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, VIEW_ROLES)) return;

  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const offset = parseInt((req.query.offset as string) || '0', 10);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const status = req.query.status as string | undefined;

  const baseQ = db('journal_entries as je')
    .where('je.dealer_id', dealerId)
    .whereNull('je.voided_at');
  if (from) baseQ.where('je.entry_date', '>=', from);
  if (to) baseQ.where('je.entry_date', '<=', to);
  if (status) baseQ.where('je.status', status);

  const totalRow = await baseQ.clone().count<{ count: string }[]>({ count: '*' }).first();
  const total = parseInt(totalRow?.count ?? '0', 10);

  const rows = await baseQ.clone()
    .leftJoin('journal_entry_lines as jel', 'jel.journal_entry_id', 'je.id')
    .groupBy('je.id')
    .select(
      'je.id', 'je.voucher_no', 'je.entry_date', 'je.narration', 'je.status',
      'je.created_at', 'je.posted_at', 'je.approved_at', 'je.reverses_journal_entry_id',
    )
    .sum({ total_debit: 'jel.debit' })
    .sum({ total_credit: 'jel.credit' })
    .orderBy('je.entry_date', 'desc')
    .orderBy('je.voucher_no', 'desc')
    .limit(limit).offset(offset);

  // Flag entries that have themselves been reversed by a later entry, so the
  // list can show "reversed" without ever mutating the original's own status
  // (immutability — see file header).
  const ids = rows.map((r: any) => r.id);
  const reversalMap = new Map<string, string>();
  if (ids.length) {
    const reversals = await db('journal_entries')
      .whereIn('reverses_journal_entry_id', ids)
      .whereNull('voided_at')
      .select('id', 'reverses_journal_entry_id');
    for (const r of reversals) reversalMap.set(r.reverses_journal_entry_id as string, r.id as string);
  }
  const withReversalFlag = rows.map((r: any) => ({ ...r, reversed_by_journal_entry_id: reversalMap.get(r.id) ?? null }));

  res.json({ rows: withReversalFlag, total });
});

// ── GET ONE ──
router.get('/:id', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, VIEW_ROLES)) return;
  const header = await db('journal_entries')
    .where({ id: req.params.id, dealer_id: dealerId })
    .whereNull('voided_at')
    .first();
  if (!header) return res.status(404).json({ error: 'Not found' });
  const lines = await db('journal_entry_lines')
    .where({ journal_entry_id: header.id })
    .orderBy('line_order', 'asc')
    .select('*');
  const reversal = await db('journal_entries')
    .where({ reverses_journal_entry_id: header.id })
    .whereNull('voided_at')
    .first('id', 'voucher_no');
  res.json({ ...header, lines, reversed_by: reversal ?? null });
});

// ── CREATE (immediate post — unchanged for backward compatibility) ──
router.post('/', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, POST_ROLES)) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  const { entry_date, narration, lines } = parsed.data;

  const balance = validateBalance(lines);
  if (!balance.ok) return res.status(400).json({ error: balance.error });

  const voucher_no = parsed.data.voucher_no || (await nextVoucherNo(dealerId, entry_date));

  try {
    const result = await db.transaction(async (trx) => {
      await assertPeriodOpen(trx, dealerId, entry_date);
      const userId = req.user?.userId ?? null;
      const [hdr] = await trx('journal_entries')
        .insert({
          dealer_id: dealerId,
          voucher_no,
          entry_date,
          narration: narration ?? null,
          created_by: userId,
          status: 'posted',
          posted_by: userId,
          posted_at: trx.fn.now(),
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
        cost_center_id: l.cost_center_id ?? null,
      }));
      await trx('journal_entry_lines').insert(lineRows);
      await auditLog(trx, req, dealerId, 'journal_create_posted', hdr.id, null, { voucher_no: hdr.voucher_no, entry_date, lines });

      return hdr;
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e instanceof PeriodClosedError) return res.status(409).json({ error: e.message });
    if (e?.code === '23505') return res.status(409).json({ error: 'Voucher number already exists' });
    console.error('journal create failed', e);
    res.status(500).json({ error: 'Failed to create journal entry' });
  }
});

// ── CREATE DRAFT ──
router.post('/draft', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, DRAFT_ROLES)) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  const { entry_date, narration, lines } = parsed.data;

  const balance = validateBalance(lines);
  if (!balance.ok) return res.status(400).json({ error: balance.error });

  const voucher_no = parsed.data.voucher_no || (await nextVoucherNo(dealerId, entry_date));

  try {
    const result = await db.transaction(async (trx) => {
      const userId = req.user?.userId ?? null;
      const [hdr] = await trx('journal_entries')
        .insert({
          dealer_id: dealerId,
          voucher_no,
          entry_date,
          narration: narration ?? null,
          created_by: userId,
          status: 'draft',
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
        cost_center_id: l.cost_center_id ?? null,
      }));
      await trx('journal_entry_lines').insert(lineRows);
      await auditLog(trx, req, dealerId, 'journal_draft_create', hdr.id, null, { voucher_no: hdr.voucher_no, entry_date, lines });
      return hdr;
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Voucher number already exists' });
    console.error('journal draft create failed', e);
    res.status(500).json({ error: 'Failed to create draft journal entry' });
  }
});

// ── APPROVE (draft -> approved) ──
router.post('/:id/approve', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, POST_ROLES)) return;

  try {
    const row = await db.transaction(async (trx) => {
      const entry = await trx('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).whereNull('voided_at').first();
      if (!entry) return null;
      if (entry.status !== 'draft') {
        throw Object.assign(new Error('Only a draft entry can be approved.'), { status: 409 });
      }
      const [updated] = await trx('journal_entries')
        .where({ id: entry.id })
        .update({ status: 'approved', approved_by: req.user?.userId ?? null, approved_at: trx.fn.now() })
        .returning('*');
      await auditLog(trx, req, dealerId, 'journal_approve', entry.id, { status: 'draft' }, { status: 'approved' });
      return updated;
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e: any) {
    console.error('journal approve failed', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to approve journal entry' });
  }
});

// ── POST (draft/approved -> posted) ──
router.post('/:id/post', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, POST_ROLES)) return;

  try {
    const row = await db.transaction(async (trx) => {
      const entry = await trx('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).whereNull('voided_at').first();
      if (!entry) return null;
      if (entry.status !== 'draft' && entry.status !== 'approved') {
        throw Object.assign(new Error('Only a draft or approved entry can be posted.'), { status: 409 });
      }
      await assertPeriodOpen(trx, dealerId, entry.entry_date);

      const lines = await trx('journal_entry_lines').where({ journal_entry_id: entry.id });
      const balance = validateBalance(lines.map((l: any) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit), line_narration: l.line_narration })));
      if (!balance.ok) {
        throw Object.assign(new Error(balance.error), { status: 409 });
      }

      const userId = req.user?.userId ?? null;
      const [updated] = await trx('journal_entries')
        .where({ id: entry.id })
        .update({ status: 'posted', posted_by: userId, posted_at: trx.fn.now() })
        .returning('*');
      await auditLog(trx, req, dealerId, 'journal_post', entry.id, { status: entry.status }, { status: 'posted' });
      return updated;
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e: any) {
    if (e instanceof PeriodClosedError) return res.status(409).json({ error: e.message });
    console.error('journal post failed', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to post journal entry' });
  }
});

const reverseSchema = z.object({
  entry_date: z.string().optional(),
  narration: z.string().optional().nullable(),
});

// ── REVERSE (posted -> creates a new, mirrored, posted reversing entry) ──
router.post('/:id/reverse', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, POST_ROLES)) return;

  const parsed = reverseSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  try {
    const result = await db.transaction(async (trx) => {
      const original = await trx('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).whereNull('voided_at').first();
      if (!original) return null;
      if (original.status !== 'posted') {
        throw Object.assign(new Error('Only a posted entry can be reversed.'), { status: 409 });
      }
      const alreadyReversed = await trx('journal_entries').where({ reverses_journal_entry_id: original.id }).whereNull('voided_at').first('id');
      if (alreadyReversed) {
        throw Object.assign(new Error('This entry has already been reversed.'), { status: 409 });
      }

      const originalLines = await trx('journal_entry_lines').where({ journal_entry_id: original.id }).orderBy('line_order', 'asc');
      const entryDate = parsed.data.entry_date || new Date().toISOString().slice(0, 10);
      await assertPeriodOpen(trx, dealerId, entryDate);

      const userId = req.user?.userId ?? null;
      const voucher_no = await nextVoucherNo(dealerId, entryDate);
      const [reversal] = await trx('journal_entries')
        .insert({
          dealer_id: dealerId,
          voucher_no,
          entry_date: entryDate,
          narration: parsed.data.narration || `Reversal of ${original.voucher_no}`,
          created_by: userId,
          status: 'posted',
          posted_by: userId,
          posted_at: trx.fn.now(),
          reverses_journal_entry_id: original.id,
        })
        .returning(['id', 'voucher_no']);

      const mirroredLines = originalLines.map((l: any, i: number) => ({
        journal_entry_id: reversal.id,
        dealer_id: dealerId,
        account: l.account,
        debit: Number(l.credit), // swap debit/credit — exact mirror
        credit: Number(l.debit),
        line_narration: l.line_narration,
        line_order: i,
        cost_center_id: l.cost_center_id ?? null,
      }));
      await trx('journal_entry_lines').insert(mirroredLines);
      await auditLog(trx, req, dealerId, 'journal_reverse', original.id, { status: 'posted' }, { reversed_by: reversal.id });

      return { original_id: original.id, reversal };
    });
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(result);
  } catch (e: any) {
    if (e instanceof PeriodClosedError) return res.status(409).json({ error: e.message });
    console.error('journal reverse failed', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to reverse journal entry' });
  }
});

// ── VOID (soft delete — draft only, per Immutable Journal) ──
// A draft that was never posted may be discarded freely. Once an entry is
// posted, it is immutable — use /reverse instead, which creates a new entry
// rather than editing or hiding this one.
router.delete('/:id', restrictSuperAdminOnFinancials(), async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAnyRole(req, res, DRAFT_ROLES)) return;
  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : null;

  try {
    const voided = await db.transaction(async (trx) => {
      const entry = await trx('journal_entries').where({ id: req.params.id, dealer_id: dealerId }).whereNull('voided_at').first();
      if (!entry) return false;
      if (entry.status !== 'draft') {
        throw Object.assign(new Error('Only a draft entry can be voided. A posted entry is immutable — use /reverse instead.'), { status: 409 });
      }
      await trx('journal_entries')
        .where({ id: entry.id })
        .update({ voided_at: trx.fn.now(), voided_by: req.user?.userId ?? null, void_reason: reason });
      await auditLog(trx, req, dealerId, 'journal_void_draft', entry.id, { status: 'draft' }, { voided: true, reason });
      return true;
    });
    if (!voided) return res.status(404).json({ error: 'Not found or already voided' });
    res.json({ ok: true, voided: true });
  } catch (e: any) {
    console.error('journal void failed', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to void journal entry' });
  }
});

export default router;
