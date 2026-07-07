/**
 * Bank Reconciliation — V2 Sprint 6C.
 *
 *   POST /api/bank-reconciliation/:bankAccountId/import        ({ csvText })
 *   POST /api/bank-reconciliation/:bankAccountId/manual-line   ({ entry_date, description, amount, reference? })
 *   GET  /api/bank-reconciliation/:bankAccountId                (unmatched statement lines + unmatched ledger rows, for matching)
 *   POST /api/bank-reconciliation/match                         ({ statement_line_id, bank_ledger_id })
 *   POST /api/bank-reconciliation/unmatch                       ({ statement_line_id })
 *   GET  /api/bank-reconciliation/:bankAccountId/summary?asOf=
 *
 * No "reconciliation session" table — Cleared/Outstanding Deposits/
 * Outstanding Cheques/Summary are all computed on demand from `bank_ledger`
 * (the book side) and `bank_statement_lines` (the bank's side), matching
 * migration 100's own design note. CSV is accepted as raw text in the JSON
 * body (not a multipart upload) — the frontend reads the File client-side
 * via FileReader and posts its text content; avoids adding a second file-
 * upload code path (multer/disk storage) for what's simple delimited text.
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
    res.status(403).json({ error: 'Only dealer_admin can manage bank reconciliation' });
    return false;
  }
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function assertBankAccount(dealerId: string, bankAccountId: string): Promise<boolean> {
  const acct = await db('bank_accounts').where({ id: bankAccountId, dealer_id: dealerId }).first('id');
  return !!acct;
}

/** Minimal CSV line splitter: comma-separated, double-quoted fields with "" escaping. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

interface ParsedCsvRow { entry_date: string; description: string; amount: number; reference: string | null }

/** Expects columns date,description,amount[,reference] — header row optional (auto-detected). */
export function parseStatementCsv(csvText: string): { rows: ParsedCsvRow[]; skipped: number } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: ParsedCsvRow[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    if (fields.length < 3) { skipped++; continue; }
    const [dateRaw, description, amountRaw, referenceRaw] = fields;
    const amount = Number(amountRaw);
    const date = new Date(dateRaw);
    // Header row detection: only the first line, and only when NEITHER the
    // date NOR the amount column parses — a genuinely malformed first DATA
    // row (bad amount, valid date) must still count as skipped, not be
    // silently swallowed as if it were a header.
    if (i === 0 && !Number.isFinite(amount) && Number.isNaN(date.getTime())) continue;
    if (!Number.isFinite(amount) || Number.isNaN(date.getTime())) { skipped++; continue; }
    rows.push({
      entry_date: date.toISOString().slice(0, 10),
      description: description || '(no description)',
      amount: round2(amount),
      reference: referenceRaw || null,
    });
  }
  return { rows, skipped };
}

router.post('/:bankAccountId/import', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  if (!(await assertBankAccount(dealerId, req.params.bankAccountId))) { res.status(404).json({ error: 'Bank account not found' }); return; }

  const csvText = req.body?.csvText;
  if (typeof csvText !== 'string' || !csvText.trim()) { res.status(400).json({ error: 'csvText is required' }); return; }

  const { rows, skipped } = parseStatementCsv(csvText);
  if (!rows.length) { res.status(400).json({ error: 'No valid rows found in the CSV (expected: date,description,amount[,reference])' }); return; }

  const inserted = await db('bank_statement_lines')
    .insert(rows.map((r) => ({
      dealer_id: dealerId,
      bank_account_id: req.params.bankAccountId,
      entry_date: r.entry_date,
      description: r.description,
      amount: r.amount,
      reference: r.reference,
      source: 'csv',
      created_by: req.user?.userId ?? null,
    })))
    .returning('id');

  res.status(201).json({ imported: inserted.length, skipped });
});

const ManualLineSchema = z.object({
  entry_date: z.string().min(1),
  description: z.string().trim().min(1).max(500),
  amount: z.coerce.number().refine((v) => v !== 0, 'Amount must not be zero'),
  reference: z.string().trim().max(100).optional().nullable(),
});

router.post('/:bankAccountId/manual-line', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  if (!(await assertBankAccount(dealerId, req.params.bankAccountId))) { res.status(404).json({ error: 'Bank account not found' }); return; }

  const parsed = ManualLineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

  const [row] = await db('bank_statement_lines')
    .insert({
      dealer_id: dealerId,
      bank_account_id: req.params.bankAccountId,
      entry_date: parsed.data.entry_date,
      description: parsed.data.description,
      amount: round2(parsed.data.amount),
      reference: parsed.data.reference ?? null,
      source: 'manual',
      created_by: req.user?.userId ?? null,
    })
    .returning('*');
  res.status(201).json({ row });
});

router.get('/:bankAccountId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  if (!(await assertBankAccount(dealerId, req.params.bankAccountId))) { res.status(404).json({ error: 'Bank account not found' }); return; }

  const [unmatchedStatementLines, unmatchedLedgerRows, matchedStatementLines] = await Promise.all([
    db('bank_statement_lines')
      .where({ dealer_id: dealerId, bank_account_id: req.params.bankAccountId, status: 'unmatched' })
      .orderBy('entry_date', 'desc'),
    db('bank_ledger')
      .where({ dealer_id: dealerId, bank_account_id: req.params.bankAccountId, is_cleared: false })
      .orderBy('entry_date', 'desc'),
    db('bank_statement_lines as sl')
      .leftJoin('bank_ledger as bl', 'bl.id', 'sl.matched_bank_ledger_id')
      .where({ 'sl.dealer_id': dealerId, 'sl.bank_account_id': req.params.bankAccountId, 'sl.status': 'matched' })
      .orderBy('sl.entry_date', 'desc')
      .select('sl.*', 'bl.description as ledger_description', 'bl.amount as ledger_amount', 'bl.entry_date as ledger_entry_date'),
  ]);

  res.json({
    unmatched_statement_lines: unmatchedStatementLines.map((r: any) => ({ ...r, amount: Number(r.amount) })),
    unmatched_ledger_rows: unmatchedLedgerRows.map((r: any) => ({ ...r, amount: Number(r.amount) })),
    matched: matchedStatementLines.map((r: any) => ({ ...r, amount: Number(r.amount), ledger_amount: r.ledger_amount != null ? Number(r.ledger_amount) : null })),
  });
});

const MatchSchema = z.object({
  statement_line_id: z.string().uuid(),
  bank_ledger_id: z.string().uuid(),
});

router.post('/match', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = MatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

  try {
    const result = await db.transaction(async (trx) => {
      const line = await trx('bank_statement_lines').where({ id: parsed.data.statement_line_id, dealer_id: dealerId }).first();
      if (!line) throw Object.assign(new Error('Statement line not found'), { status: 404 });
      if (line.status === 'matched') throw Object.assign(new Error('This statement line is already matched'), { status: 409 });

      const ledgerRow = await trx('bank_ledger').where({ id: parsed.data.bank_ledger_id, dealer_id: dealerId, bank_account_id: line.bank_account_id }).first();
      if (!ledgerRow) throw Object.assign(new Error('Ledger entry not found for this bank account'), { status: 404 });
      if (ledgerRow.is_cleared) throw Object.assign(new Error('This ledger entry is already cleared'), { status: 409 });

      const [updatedLine] = await trx('bank_statement_lines')
        .where({ id: line.id })
        .update({ status: 'matched', matched_bank_ledger_id: ledgerRow.id })
        .returning('*');
      const [updatedLedger] = await trx('bank_ledger')
        .where({ id: ledgerRow.id })
        .update({ is_cleared: true, cleared_at: trx.fn.now(), ...(ledgerRow.cheque_no && ledgerRow.cheque_status !== 'cleared' ? { cheque_status: 'cleared' } : {}) })
        .returning('*');

      return { statementLine: updatedLine, ledgerRow: updatedLedger };
    });
    res.json(result);
  } catch (err: any) {
    console.error('[bank-reconciliation/match]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to match' });
  }
});

const UnmatchSchema = z.object({ statement_line_id: z.string().uuid() });

router.post('/unmatch', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = UnmatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

  try {
    const result = await db.transaction(async (trx) => {
      const line = await trx('bank_statement_lines').where({ id: parsed.data.statement_line_id, dealer_id: dealerId }).first();
      if (!line) throw Object.assign(new Error('Statement line not found'), { status: 404 });
      if (line.status !== 'matched' || !line.matched_bank_ledger_id) throw Object.assign(new Error('This statement line is not matched'), { status: 409 });

      const [updatedLine] = await trx('bank_statement_lines')
        .where({ id: line.id })
        .update({ status: 'unmatched', matched_bank_ledger_id: null })
        .returning('*');
      await trx('bank_ledger').where({ id: line.matched_bank_ledger_id }).update({ is_cleared: false, cleared_at: null });

      return { statementLine: updatedLine };
    });
    res.json(result);
  } catch (err: any) {
    console.error('[bank-reconciliation/unmatch]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to unmatch' });
  }
});

router.get('/:bankAccountId/summary', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  if (!(await assertBankAccount(dealerId, req.params.bankAccountId))) { res.status(404).json({ error: 'Bank account not found' }); return; }

  const asOf = (req.query.asOf as string | undefined) || undefined;

  const ledgerQ = db('bank_ledger').where({ dealer_id: dealerId, bank_account_id: req.params.bankAccountId });
  if (asOf) ledgerQ.andWhere('entry_date', '<=', asOf);

  const [bookBalanceRow, clearedBalanceRow, outstandingDepositsRow, outstandingWithdrawalsRow, statementLinesRow] = await Promise.all([
    ledgerQ.clone().sum({ total: 'amount' }).first(),
    ledgerQ.clone().where({ is_cleared: true }).sum({ total: 'amount' }).first(),
    ledgerQ.clone().where({ is_cleared: false }).andWhere('amount', '>', 0).sum({ total: 'amount' }).first(),
    ledgerQ.clone().where({ is_cleared: false }).andWhere('amount', '<', 0).sum({ total: 'amount' }).first(),
    db('bank_statement_lines').where({ dealer_id: dealerId, bank_account_id: req.params.bankAccountId, status: 'unmatched' }).count<{ count: string }[]>('id as count').first(),
  ]);

  const bookBalance = round2(Number(bookBalanceRow?.total) || 0);
  const clearedBalance = round2(Number(clearedBalanceRow?.total) || 0);
  const outstandingDeposits = round2(Number(outstandingDepositsRow?.total) || 0);
  const outstandingWithdrawals = round2(Math.abs(Number(outstandingWithdrawalsRow?.total) || 0));

  res.json({
    as_of: asOf ?? null,
    book_balance: bookBalance,
    cleared_balance: clearedBalance,
    outstanding_deposits: outstandingDeposits,
    outstanding_cheques: outstandingWithdrawals,
    unmatched_statement_line_count: Number(statementLinesRow?.count ?? 0),
    // cleared_balance + outstanding_deposits - outstanding_withdrawals should equal book_balance —
    // exposed so the UI/tests can assert this identity rather than trusting it silently.
    difference: round2(bookBalance - (clearedBalance + outstandingDeposits - outstandingWithdrawals)),
  });
});

export default router;
