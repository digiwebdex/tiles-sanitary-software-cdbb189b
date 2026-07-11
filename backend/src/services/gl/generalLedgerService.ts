/**
 * V2 Sprint 6E — General Ledger / Trial Balance shared query layer.
 *
 * Two existing, genuinely separate ledgers feed every account-level report
 * in this system, and neither is complete on its own:
 *   - `gl_journal_lines` (the GL Spine) — structured, `gl_accounts.code`-keyed,
 *     written automatically by the Posting Engine for every sale/purchase/
 *     payment/expense/asset/cost-center event (Sprints 6A-6D).
 *   - `journal_entry_lines` (manual Journal, Sprint 6A's Draft/Approve/Post
 *     workflow) — free-text `account` column (confirmed via journal.ts's
 *     schema AND JournalPage.tsx's plain `<Input>`, not a Chart-of-Accounts
 *     picker), never mirrored into the Posting Engine.
 *
 * Rather than attempt to fuzzy-match free-text journal account names onto
 * `gl_accounts.code` (a real risk of silently merging two different
 * accounts), this service reads BOTH sources and keeps them as two
 * separately-keyed groups — GL rows keyed by `gl_accounts.code`, Journal
 * rows keyed by their own trimmed free-text label — so every report is
 * complete (nothing hidden) without ever guessing at an identity match.
 */
import type { Knex } from 'knex';
import { db } from '../../db/connection';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface LedgerFilters {
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
}

export interface AccountBalanceRow {
  source: 'gl' | 'journal';
  /** gl_accounts.code for GL rows; the trimmed free-text label for Journal rows. */
  accountKey: string;
  accountLabel: string;
  accountType: string | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

/**
 * Apply the Sprint 6D cost-center → branch join to a gl_journal_lines query.
 * Coverage limitation (documented, not a bug): only lines whose originating
 * posting_lines row carries a cost_center_id are branch-filterable — most
 * Sales/Purchase postings don't tag one (only Journal/Expenses/Assets do,
 * per Sprint 6D's own scope), so a branch filter narrows to that subset.
 */
function applyGlBranchFilter(q: Knex.QueryBuilder, branchId: string | null | undefined): Knex.QueryBuilder {
  if (!branchId) return q;
  return q
    .leftJoin('posting_lines as pl', 'pl.id', 'jl.posting_line_id')
    .leftJoin('cost_centers as cc', 'cc.id', 'pl.cost_center_id')
    .where('cc.branch_id', branchId);
}

function applyJournalBranchFilter(q: Knex.QueryBuilder, branchId: string | null | undefined): Knex.QueryBuilder {
  if (!branchId) return q;
  return q
    .leftJoin('cost_centers as cc', 'cc.id', 'jel.cost_center_id')
    .where('cc.branch_id', branchId);
}

/** Per-GL-account opening/period/closing balances (structured GL Spine side). */
export async function fetchGlAccountBalances(
  dealerId: string,
  filters: LedgerFilters,
): Promise<AccountBalanceRow[]> {
  const { from, to, branchId } = filters;

  let q = db('gl_journal_lines as jl')
    .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
    .join('gl_accounts as a', 'a.id', 'jl.account_id')
    .where('je.dealer_id', dealerId);

  q = applyGlBranchFilter(q, branchId);
  if (to) q = q.andWhere('je.entry_date', '<=', to);

  q = q
    .groupBy('a.id', 'a.code', 'a.name', 'a.account_type')
    .select(
      'a.code',
      'a.name',
      'a.account_type',
      db.raw(from ? "COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jl.debit ELSE 0 END), 0) as opening_debit" : '0 as opening_debit', from ? [from] : []),
      db.raw(from ? "COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jl.credit ELSE 0 END), 0) as opening_credit" : '0 as opening_credit', from ? [from] : []),
      db.raw(
        from
          ? "COALESCE(SUM(CASE WHEN je.entry_date >= ? THEN jl.debit ELSE 0 END), 0) as period_debit"
          : 'COALESCE(SUM(jl.debit), 0) as period_debit',
        from ? [from] : [],
      ),
      db.raw(
        from
          ? "COALESCE(SUM(CASE WHEN je.entry_date >= ? THEN jl.credit ELSE 0 END), 0) as period_credit"
          : 'COALESCE(SUM(jl.credit), 0) as period_credit',
        from ? [from] : [],
      ),
    );

  const rows = await q;
  return (rows as any[]).map((r) => {
    const openingBalance = round2(Number(r.opening_debit) - Number(r.opening_credit));
    const periodDebit = round2(r.period_debit);
    const periodCredit = round2(r.period_credit);
    return {
      source: 'gl' as const,
      accountKey: r.code as string,
      accountLabel: `${r.code} — ${r.name}`,
      accountType: r.account_type as string,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance: round2(openingBalance + periodDebit - periodCredit),
    };
  });
}

/** Per-free-text-account opening/period/closing balances (manual Journal side). */
export async function fetchJournalAccountBalances(
  dealerId: string,
  filters: LedgerFilters,
): Promise<AccountBalanceRow[]> {
  const { from, to, branchId } = filters;

  let q = db('journal_entry_lines as jel')
    .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .where('je.dealer_id', dealerId)
    .andWhere('je.status', 'posted')
    .whereNull('je.voided_at');

  q = applyJournalBranchFilter(q, branchId);
  if (to) q = q.andWhere('je.entry_date', '<=', to);

  q = q
    .groupBy('jel.account')
    .select(
      'jel.account',
      db.raw(from ? "COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jel.debit ELSE 0 END), 0) as opening_debit" : '0 as opening_debit', from ? [from] : []),
      db.raw(from ? "COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jel.credit ELSE 0 END), 0) as opening_credit" : '0 as opening_credit', from ? [from] : []),
      db.raw(
        from
          ? "COALESCE(SUM(CASE WHEN je.entry_date >= ? THEN jel.debit ELSE 0 END), 0) as period_debit"
          : 'COALESCE(SUM(jel.debit), 0) as period_debit',
        from ? [from] : [],
      ),
      db.raw(
        from
          ? "COALESCE(SUM(CASE WHEN je.entry_date >= ? THEN jel.credit ELSE 0 END), 0) as period_credit"
          : 'COALESCE(SUM(jel.credit), 0) as period_credit',
        from ? [from] : [],
      ),
    );

  const rows = await q;
  return (rows as any[]).map((r) => {
    const openingBalance = round2(Number(r.opening_debit) - Number(r.opening_credit));
    const periodDebit = round2(r.period_debit);
    const periodCredit = round2(r.period_credit);
    return {
      source: 'journal' as const,
      accountKey: String(r.account).trim(),
      accountLabel: String(r.account).trim(),
      accountType: null,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance: round2(openingBalance + periodDebit - periodCredit),
    };
  });
}

export interface CombinedTrialBalance {
  gl_accounts: AccountBalanceRow[];
  journal_accounts: AccountBalanceRow[];
  totals: { opening_debit: number; opening_credit: number; period_debit: number; period_credit: number; closing_debit: number; closing_credit: number };
}

export async function computeTrialBalance(dealerId: string, filters: LedgerFilters): Promise<CombinedTrialBalance> {
  const [glRows, journalRows] = await Promise.all([
    fetchGlAccountBalances(dealerId, filters),
    fetchJournalAccountBalances(dealerId, filters),
  ]);

  const all = [...glRows, ...journalRows];
  const sumSide = (rows: AccountBalanceRow[], pick: (r: AccountBalanceRow) => number, positive: boolean) =>
    rows.reduce((s, r) => {
      const v = pick(r);
      if (positive ? v > 0 : v < 0) return round2(s + Math.abs(v));
      return s;
    }, 0);

  return {
    gl_accounts: glRows.filter((r) => Math.abs(r.openingBalance) > 0.005 || Math.abs(r.periodDebit) > 0.005 || Math.abs(r.periodCredit) > 0.005),
    journal_accounts: journalRows.filter((r) => Math.abs(r.openingBalance) > 0.005 || Math.abs(r.periodDebit) > 0.005 || Math.abs(r.periodCredit) > 0.005),
    totals: {
      opening_debit: sumSide(all, (r) => r.openingBalance, true),
      opening_credit: sumSide(all, (r) => r.openingBalance, false),
      period_debit: round2(all.reduce((s, r) => s + r.periodDebit, 0)),
      period_credit: round2(all.reduce((s, r) => s + r.periodCredit, 0)),
      closing_debit: sumSide(all, (r) => r.closingBalance, true),
      closing_credit: sumSide(all, (r) => r.closingBalance, false),
    },
  };
}

export interface LedgerTransaction {
  source: 'gl' | 'journal';
  date: string;
  debit: number;
  credit: number;
  description: string | null;
  documentType: string | null;
  documentId: string | null;
  journalEntryId: string | null;
  voucherNo: string | null;
  postingBatchId: string | null;
}

/** Every transaction line for ONE GL account code, chronological, for drill-down. */
export async function fetchGlAccountTransactions(
  dealerId: string,
  accountCode: string,
  filters: LedgerFilters,
): Promise<LedgerTransaction[]> {
  const { from, to, branchId } = filters;
  let q = db('gl_journal_lines as jl')
    .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
    .join('gl_accounts as a', 'a.id', 'jl.account_id')
    .leftJoin('posting_batches as pb', 'pb.id', 'je.posting_batch_id')
    .where('je.dealer_id', dealerId)
    .andWhere('a.code', accountCode);
  q = applyGlBranchFilter(q, branchId);
  if (from) q = q.andWhere('je.entry_date', '>=', from);
  if (to) q = q.andWhere('je.entry_date', '<=', to);

  const rows = await q
    .orderBy('je.entry_date', 'asc')
    .select(
      'je.entry_date', 'jl.debit', 'jl.credit', 'je.description',
      'je.document_type', 'je.document_id', 'je.id as journal_id', 'je.posting_batch_id',
      'pb.event_type',
    );

  return (rows as any[]).map((r) => ({
    source: 'gl' as const,
    date: String(r.entry_date).slice(0, 10),
    debit: round2(r.debit),
    credit: round2(r.credit),
    description: r.description ?? null,
    documentType: r.document_type ?? null,
    documentId: r.document_id ?? null,
    journalEntryId: r.journal_id ?? null,
    voucherNo: null,
    postingBatchId: r.posting_batch_id ?? null,
  }));
}

/** Every transaction line for ONE free-text manual-Journal account, chronological. */
export async function fetchJournalAccountTransactions(
  dealerId: string,
  accountLabel: string,
  filters: LedgerFilters,
): Promise<LedgerTransaction[]> {
  const { from, to, branchId } = filters;
  let q = db('journal_entry_lines as jel')
    .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .where('je.dealer_id', dealerId)
    .andWhere('je.status', 'posted')
    .whereNull('je.voided_at')
    .andWhereRaw('TRIM(jel.account) = ?', [accountLabel]);
  q = applyJournalBranchFilter(q, branchId);
  if (from) q = q.andWhere('je.entry_date', '>=', from);
  if (to) q = q.andWhere('je.entry_date', '<=', to);

  const rows = await q
    .orderBy('je.entry_date', 'asc')
    .select('je.entry_date', 'jel.debit', 'jel.credit', 'jel.line_narration', 'je.narration', 'je.id as journal_id', 'je.voucher_no');

  return (rows as any[]).map((r) => ({
    source: 'journal' as const,
    date: String(r.entry_date).slice(0, 10),
    debit: round2(r.debit),
    credit: round2(r.credit),
    description: r.line_narration ?? r.narration ?? null,
    documentType: 'manual_journal',
    documentId: r.journal_id ?? null,
    journalEntryId: r.journal_id ?? null,
    voucherNo: r.voucher_no ?? null,
    postingBatchId: null,
  }));
}

export interface AccountLedgerResult {
  accountKey: string;
  accountLabel: string;
  openingBalance: number;
  transactions: (LedgerTransaction & { runningBalance: number })[];
  closingBalance: number;
}

/** Full drill-down for one account: opening balance + running-balance transaction list. */
export async function buildAccountLedger(
  dealerId: string,
  source: 'gl' | 'journal',
  accountKey: string,
  filters: LedgerFilters,
): Promise<AccountLedgerResult> {
  const openingFilters: LedgerFilters = { to: filters.from ? dayBefore(filters.from) : null, branchId: filters.branchId };
  const [openingRows, transactions] = await Promise.all([
    source === 'gl' ? fetchGlAccountBalances(dealerId, { ...openingFilters, from: null }) : fetchJournalAccountBalances(dealerId, { ...openingFilters, from: null }),
    source === 'gl'
      ? fetchGlAccountTransactions(dealerId, accountKey, { from: filters.from, to: filters.to, branchId: filters.branchId })
      : fetchJournalAccountTransactions(dealerId, accountKey, { from: filters.from, to: filters.to, branchId: filters.branchId }),
  ]);

  const openingRow = openingRows.find((r) => r.accountKey === accountKey);
  const openingBalance = openingRow ? openingRow.closingBalance : 0;

  let running = openingBalance;
  const withRunning = transactions.map((t) => {
    running = round2(running + t.debit - t.credit);
    return { ...t, runningBalance: running };
  });

  let accountLabel = accountKey;
  if (source === 'gl') {
    const account = await db('gl_accounts').where({ dealer_id: dealerId, code: accountKey }).first('code', 'name');
    if (account) accountLabel = `${account.code} — ${account.name}`;
  }

  return {
    accountKey,
    accountLabel,
    openingBalance,
    transactions: withRunning,
    closingBalance: running,
  };
}

function dayBefore(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}
