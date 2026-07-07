/**
 * General Ledger — V2 Sprint 6E.
 *
 *   GET /api/general-ledger/accounts?dealerId=&from=&to=&branchId=
 *   GET /api/general-ledger/ledger?dealerId=&source=gl|journal&account=&from=&to=&branchId=
 *   GET /api/general-ledger/ledger/export.csv?dealerId=&source=&account=&from=&to=&branchId=
 *
 * Reuses generalLedgerService.ts (GL Spine `gl_journal_lines` UNION manual
 * `journal_entry_lines`, per journal.ts's own free-text account column —
 * see that service's header comment for why they're kept as two separately
 * keyed groups rather than fuzzy-merged).
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';
import { computeTrialBalance, buildAccountLedger } from '../services/gl/generalLedgerService';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ── GET /accounts — account picker: every GL account + every distinct manual-journal account label ──
router.get('/accounts', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  try {
    const [glAccounts, journalAccounts] = await Promise.all([
      db('gl_accounts').where({ dealer_id: dealerId, is_active: true }).orderBy('code').select('code', 'name', 'account_type'),
      db('journal_entry_lines as jel')
        .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
        .where('je.dealer_id', dealerId)
        .andWhere('je.status', 'posted')
        .whereNull('je.voided_at')
        .distinct('jel.account')
        .orderBy('jel.account'),
    ]);
    res.json({
      gl_accounts: glAccounts.map((a: any) => ({ source: 'gl', accountKey: a.code, accountLabel: `${a.code} — ${a.name}`, accountType: a.account_type })),
      journal_accounts: (journalAccounts as any[]).map((r) => ({ source: 'journal', accountKey: String(r.account).trim(), accountLabel: String(r.account).trim(), accountType: null })),
    });
  } catch (err: any) {
    console.error('[general-ledger/accounts]', err.message);
    res.status(500).json({ error: 'Failed to load account list' });
  }
});

// ── GET /trial-balance-preview — same shape gl.ts's extended trial-balance uses, exposed here too for convenience ──
router.get('/summary', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;
  const branchId = (req.query.branchId as string | undefined) || null;
  try {
    const result = await computeTrialBalance(dealerId, { from, to, branchId });
    res.json(result);
  } catch (err: any) {
    console.error('[general-ledger/summary]', err.message);
    res.status(500).json({ error: 'Failed to load general ledger summary' });
  }
});

function parseLedgerQuery(req: Request, res: Response): { source: 'gl' | 'journal'; account: string; from: string | null; to: string | null; branchId: string | null } | null {
  const source = req.query.source as string | undefined;
  const account = req.query.account as string | undefined;
  if (source !== 'gl' && source !== 'journal') { res.status(400).json({ error: "source must be 'gl' or 'journal'" }); return null; }
  if (!account) { res.status(400).json({ error: 'account is required' }); return null; }
  return {
    source,
    account,
    from: (req.query.from as string | undefined) || null,
    to: (req.query.to as string | undefined) || null,
    branchId: (req.query.branchId as string | undefined) || null,
  };
}

// ── GET /ledger — per-account drill-down with running balance ──
router.get('/ledger', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = parseLedgerQuery(req, res);
  if (!parsed) return;
  try {
    const result = await buildAccountLedger(dealerId, parsed.source, parsed.account, { from: parsed.from, to: parsed.to, branchId: parsed.branchId });
    res.json(result);
  } catch (err: any) {
    console.error('[general-ledger/ledger]', err.message);
    res.status(500).json({ error: 'Failed to load account ledger' });
  }
});

// ── GET /ledger/export.csv — same drill-down as CSV ──
router.get('/ledger/export.csv', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = parseLedgerQuery(req, res);
  if (!parsed) return;
  try {
    const result = await buildAccountLedger(dealerId, parsed.source, parsed.account, { from: parsed.from, to: parsed.to, branchId: parsed.branchId });
    const headers = ['date', 'description', 'voucher_no', 'debit', 'credit', 'running_balance'];
    const lines = [headers.join(',')];
    lines.push(['Opening Balance', '', '', '', '', result.openingBalance].map(csvEscape).join(','));
    for (const t of result.transactions) {
      lines.push([t.date, t.description ?? '', t.voucherNo ?? '', t.debit, t.credit, t.runningBalance].map(csvEscape).join(','));
    }
    const csv = lines.join('\n') + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger_${parsed.source}_${parsed.account.replace(/[^a-zA-Z0-9]/g, '_')}.csv"`);
    res.send(csv);
  } catch (err: any) {
    console.error('[general-ledger/ledger/export]', err.message);
    res.status(500).json({ error: 'Failed to export ledger' });
  }
});

export default router;
