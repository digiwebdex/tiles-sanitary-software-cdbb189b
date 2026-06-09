/**
 * Financial Statements.
 *
 *   GET /api/financials/p-and-l?dealerId=&from=&to=
 *   GET /api/financials/balance-sheet?dealerId=&asOf=
 *   GET /api/financials/trial-balance?dealerId=&asOf=
 *
 * dealer_admin / super_admin only.
 *
 * ─── Track 1 Phase 1 hotfix (2026-06) ──────────────────────────────────────
 *
 * Previously this file referenced two columns that do not exist in the
 * schema (one for line-level cost, one for return unit price). The failed
 * queries were swallowed by silent catch blocks, so the
 * API silently returned 0 for both COGS and Sales Returns. As a result,
 * gross / net profit on the P&L endpoint and the matching Trial Balance
 * lines were materially overstated for every dealer using
 * /api/financials/*.
 *
 * Corrected sources (canonical columns, already populated atomically by
 * the write paths):
 *
 *   - COGS           → SUM of the cogs column on the sales header
 *                      (set by routes/sales.ts at create/update time).
 *   - Sales returns  → SUM of the refund_amount column on sales_returns
 *                      (set by routes/returns.ts).
 *
 * Every aggregation now flows through the `safeSum` / `safeQuery` helpers
 * in ../lib/safeSum which:
 *   • return 0 on failure (no crash, preserves existing response shape),
 *   • emit a single structured stderr log line via ../lib/logger, and
 *   • append a human-readable string to a per-request `warnings[]` array
 *     that the API returns so the dashboard can surface data-quality
 *     issues to the dealer.
 *
 * This is the structural defense against the next silent-zero bug. See
 * docs/FINANCIAL_REPORTING.md for the column-by-column source map.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { safeSum, safeQuery } from '../lib/safeSum';
import { logRouteWarn } from '../lib/logger';
import { sumSupplierPayable } from '../services/reportQueryService';
import { detectCogsDataQualityWarnings } from '../lib/pnlMath';

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
    res.status(403).json({ error: 'Only dealer_admin can view financial statements' });
    return false;
  }
  return true;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

// ── Profit & Loss ──
router.get('/p-and-l', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;

  const warnings: string[] = [];
  const ctx = { dealerId, from, to };

  // ── Revenue: SUM(sales.total_amount) over sale_date range ──
  const revenue = await safeSum(
    { route: 'financials.pnl.revenue', label: 'Revenue', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'total_amount' })
        .first();
      return num(row?.total);
    },
  );

  // ── Sales returns: SUM(refund_amount) on sales_returns ──
  // Replaces a query that multiplied qty by a non-existent unit-price column.
  const sales_returns = await safeSum(
    { route: 'financials.pnl.sales_returns', label: 'Sales Returns', warnings, context: ctx },
    async () => {
      const row = await db('sales_returns')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('return_date', '>=', from); if (to) qb.where('return_date', '<=', to); })
        .sum({ total: 'refund_amount' })
        .first();
      return num(row?.total);
    },
  );

  // ── COGS: SUM(cogs) on sales ──
  // Replaces a join into sale_items that multiplied quantity by a
  // non-existent line-level cost column, which silently returned zero.
  const cogs = await safeSum(
    { route: 'financials.pnl.cogs', label: 'COGS', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'cogs' })
        .first();
      return num(row?.total);
    },
  );

  const cogs_reversal = await safeSum(
    { route: 'financials.pnl.cogs_reversal', label: 'COGS Reversal', warnings, context: ctx },
    async () => {
      const row = await db('sales_returns')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('return_date', '>=', from); if (to) qb.where('return_date', '<=', to); })
        .sum({ total: 'cogs_reversal' })
        .first();
      return num(row?.total);
    },
  );

  const net_cogs = cogs - cogs_reversal;

  // ── Phase 1A — legacy_pre_fix detection ──
  // Sales rows created BEFORE the Phase 1A tile-COGS unit fix have
  // `cogs_method = 'legacy_pre_fix'`. For tile products their stored
  // `cogs` is understated by a factor of `per_box_sft`. Surface the
  // count so the dealer is not silently shown inflated profit for the
  // legacy portion of the period.
  //
  // (The earlier `WHERE cogs IS NULL` detector was effectively dead code
  // because sales.cogs is NOT NULL DEFAULT 0 — the real legacy signal
  // is the new cogs_method column.)
  const legacyCogsCount = await safeSum(
    { route: 'financials.pnl.legacy_pre_fix_check', label: 'Legacy-COGS check', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId, cogs_method: 'legacy_pre_fix' })
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .count<{ count: string }[]>('id as count')
        .first();
      return Number(row?.count ?? 0);
    },
  );
  if (legacyCogsCount > 0) {
    const msg = `${legacyCogsCount} sale(s) in this period were recorded before the tile cost-of-goods correction (Phase 1A). Their stored cost is approximate (understated for tile products). Profit shown for these rows is conservative-high. Phase 1B will offer an opt-in recompute tool.`;
    warnings.push(msg);
    logRouteWarn('financials.pnl.legacy_pre_fix', msg, { ...ctx, legacyCogsCount });
  }

  // ── Expenses ──
  const expenseRows = await safeQuery<{ category: string | null; total: unknown }[]>(
    { route: 'financials.pnl.expenses', label: 'Expenses', warnings, context: ctx },
    async () =>
      db('expenses')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('expense_date', '>=', from); if (to) qb.where('expense_date', '<=', to); })
        .select('category')
        .sum({ total: 'amount' })
        .groupBy('category') as unknown as Promise<{ category: string | null; total: unknown }[]>,
    [],
  );
  const expenses_by_category = expenseRows.map(r => ({
    category: r.category || 'Uncategorized',
    amount: num(r.total),
  }));
  const total_expenses = expenses_by_category.reduce((s, r) => s + r.amount, 0);

  const gross_profit = revenue - sales_returns - net_cogs;
  const net_profit = gross_profit - total_expenses;

  for (const w of detectCogsDataQualityWarnings({
    revenue,
    sales_returns,
    cogs,
    cogs_reversal,
    legacyPreFixCount: legacyCogsCount,
  })) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  res.json({
    period: { from, to },
    revenue,
    sales_returns,
    net_revenue: revenue - sales_returns,
    cogs,
    cogs_reversal,
    net_cogs,
    gross_profit,
    expenses_by_category,
    total_expenses,
    net_profit,
    // ── Phase 1 transparency fields (additive, optional) ──
    data_source: 'sales.cogs + sales_returns.refund_amount + sales_returns.cogs_reversal',
    warnings,
  });
});

// ── Balance Sheet ──
router.get('/balance-sheet', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const asOf = (req.query.asOf as string | undefined) || null;

  const warnings: string[] = [];
  const ctx = { dealerId, asOf };

  // ── Cash on hand ──
  const cash = await safeSum(
    { route: 'financials.bs.cash', label: 'Cash on hand', warnings, context: ctx },
    async () => {
      const q = db('cash_ledger').where({ dealer_id: dealerId });
      if (asOf) q.where('entry_date', '<=', asOf);
      const row = await q.sum({ total: 'amount' }).first();
      return num(row?.total);
    },
  );

  // ── Bank balances (per-account + total) ──
  const bankList = (await safeQuery<{ bank_account_id: string; bank_name: string; account_number: string; balance: unknown }[]>(
    { route: 'financials.bs.banks', label: 'Bank balances', warnings, context: ctx },
    async () => {
      const q = db('bank_ledger as bl')
        .join('bank_accounts as ba', 'ba.id', 'bl.bank_account_id')
        .where('bl.dealer_id', dealerId);
      if (asOf) q.where('bl.entry_date', '<=', asOf);
      const rows = await q
        .groupBy('ba.id', 'ba.bank_name', 'ba.account_number')
        .select('ba.id as bank_account_id', 'ba.bank_name', 'ba.account_number')
        .sum({ balance: 'bl.amount' });
      return rows as unknown as { bank_account_id: string; bank_name: string; account_number: string; balance: unknown }[];
    },
    [],
  )).map(b => ({ ...b, balance: num(b.balance) }));
  const bank_total = bankList.reduce((s, b) => s + b.balance, 0);

  // ── Inventory valuation at average cost (falls back to product cost_price) ──
  const inventory = await safeSum(
    { route: 'financials.bs.inventory', label: 'Inventory valuation', warnings, context: ctx },
    async () => {
      const row = await db('stock as s')
        .join('products as p', 'p.id', 's.product_id')
        .where('s.dealer_id', dealerId)
        .sum({
          total: db.raw(`
            CASE
              WHEN p.unit_type = 'box_sft' THEN COALESCE(s.box_qty, 0) * COALESCE(p.cost_price, 0) * COALESCE(p.per_box_sft, 1)
              ELSE COALESCE(s.piece_qty, 0) * COALESCE(p.cost_price, 0)
            END
          `),
        }).first();
      return num(row?.total);
    },
  );

  // ── Accounts receivable: unpaid sales (clamped at zero per sale) ──
  const receivable = await safeSum(
    { route: 'financials.bs.ar', label: 'Accounts Receivable', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .sum({ total: db.raw('GREATEST(0, COALESCE(total_amount,0) - COALESCE(paid_amount,0))') })
        .first();
      return num(row?.total);
    },
  );

  // ── Accounts payable: per-supplier balance via computeSupplierOutstanding ──
  const payable = await safeSum(
    { route: 'financials.bs.ap', label: 'Accounts Payable', warnings, context: ctx },
    () => sumSupplierPayable(dealerId, asOf),
  );

  // ── Director capital = deposits − withdrawals − dividends ──
  const directorRows = await safeQuery<{ type: string; total: unknown }[]>(
    { route: 'financials.bs.director_capital', label: 'Director Capital', warnings, context: ctx },
    async () =>
      db('director_transactions')
        .where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('entry_date', '<=', asOf); })
        .select('type')
        .sum({ total: 'amount' })
        .groupBy('type') as unknown as Promise<{ type: string; total: unknown }[]>,
    [],
  );
  let director_capital = 0;
  for (const r of directorRows) {
    const amt = num(r.total);
    if (r.type === 'deposit') director_capital += amt;
    else if (r.type === 'withdrawal' || r.type === 'dividend') director_capital -= amt;
  }

  const total_assets = cash + bank_total + inventory + receivable;
  const total_liabilities = payable;
  const total_equity = total_assets - total_liabilities;
  const retained_earnings = total_equity - director_capital;

  res.json({
    as_of: asOf,
    assets: {
      cash,
      bank_total,
      bank_accounts: bankList,
      inventory,
      accounts_receivable: receivable,
      total: total_assets,
    },
    liabilities: {
      accounts_payable: payable,
      total: total_liabilities,
    },
    equity: {
      director_capital,
      retained_earnings,
      owner_equity: total_equity,
      total: total_equity,
    },
    // ── Phase 1 transparency fields (additive, optional) ──
    warnings,
  });
});

// ── Trial Balance ──
// Aggregates account balances as of a date. Each row carries debit OR credit.
router.get('/trial-balance', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const asOf = (req.query.asOf as string | undefined) || null;
  const accounts: { account: string; debit: number; credit: number }[] = [];
  const push = (account: string, value: number) => {
    if (Math.abs(value) < 0.005) return;
    if (value >= 0) accounts.push({ account, debit: value, credit: 0 });
    else accounts.push({ account, debit: 0, credit: -value });
  };

  const warnings: string[] = [];
  const ctx = { dealerId, asOf };

  // ─ Asset accounts (normal balance: Debit) ─
  const cashTotal = await safeSum(
    { route: 'financials.tb.cash', label: 'Cash on hand', warnings, context: ctx },
    async () => {
      const row = await db('cash_ledger').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('entry_date', '<=', asOf); })
        .sum({ total: 'amount' }).first();
      return num(row?.total);
    },
  );
  push('Cash on Hand', cashTotal);

  const banks = await safeQuery<{ bank_name: string; account_number: string; balance: unknown }[]>(
    { route: 'financials.tb.banks', label: 'Bank balances', warnings, context: ctx },
    async () =>
      db('bank_ledger as bl')
        .join('bank_accounts as ba', 'ba.id', 'bl.bank_account_id')
        .where('bl.dealer_id', dealerId)
        .modify(qb => { if (asOf) qb.where('bl.entry_date', '<=', asOf); })
        .groupBy('ba.id', 'ba.bank_name', 'ba.account_number')
        .select('ba.bank_name', 'ba.account_number')
        .sum({ balance: 'bl.amount' }) as unknown as Promise<{ bank_name: string; account_number: string; balance: unknown }[]>,
    [],
  );
  for (const b of banks) push(`Bank — ${b.bank_name} (${b.account_number})`, num(b.balance));

  const inventoryTotal = await safeSum(
    { route: 'financials.tb.inventory', label: 'Inventory valuation', warnings, context: ctx },
    async () => {
      const row = await db('stock as s')
        .join('products as p', 'p.id', 's.product_id')
        .where('s.dealer_id', dealerId)
        .sum({
          total: db.raw(`
            CASE
              WHEN p.unit_type = 'box_sft' THEN COALESCE(s.box_qty, 0) * COALESCE(p.cost_price, 0) * COALESCE(p.per_box_sft, 1)
              ELSE COALESCE(s.piece_qty, 0) * COALESCE(p.cost_price, 0)
            END
          `),
        }).first();
      return num(row?.total);
    },
  );
  push('Inventory', inventoryTotal);

  const arTotal = await safeSum(
    { route: 'financials.tb.ar', label: 'Accounts Receivable', warnings, context: ctx },
    async () => {
      const row = await db('sales').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .sum({ total: db.raw('GREATEST(0, COALESCE(total_amount,0) - COALESCE(paid_amount,0))') })
        .first();
      return num(row?.total);
    },
  );
  push('Accounts Receivable', arTotal);

  // ─ Liability accounts (Credit → negative debit) ─
  const apTotal = await safeSum(
    { route: 'financials.tb.ap', label: 'Accounts Payable', warnings, context: ctx },
    () => sumSupplierPayable(dealerId, asOf),
  );
  if (apTotal > 0) push('Accounts Payable', -apTotal);

  // ─ Equity ─
  const directorRows = await safeQuery<{ type: string; total: unknown }[]>(
    { route: 'financials.tb.director_capital', label: 'Director Capital', warnings, context: ctx },
    async () =>
      db('director_transactions').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('entry_date', '<=', asOf); })
        .select('type').sum({ total: 'amount' }).groupBy('type') as unknown as Promise<{ type: string; total: unknown }[]>,
    [],
  );
  let dc = 0;
  for (const r of directorRows) {
    const amt = num(r.total);
    if (r.type === 'deposit') dc += amt;
    else if (r.type === 'withdrawal' || r.type === 'dividend') dc -= amt;
  }
  if (Math.abs(dc) > 0.005) push('Director Capital', -dc);

  // ─ Income accounts (Credit) ─
  const revTotal = await safeSum(
    { route: 'financials.tb.revenue', label: 'Sales Revenue', warnings, context: ctx },
    async () => {
      const row = await db('sales').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .sum({ total: 'total_amount' }).first();
      return num(row?.total);
    },
  );
  if (revTotal > 0) push('Sales Revenue', -revTotal);

  // ── Sales Returns: SUM(refund_amount) — see header comment for details ──
  const srTotal = await safeSum(
    { route: 'financials.tb.sales_returns', label: 'Sales Returns', warnings, context: ctx },
    async () => {
      const row = await db('sales_returns').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('return_date', '<=', asOf); })
        .sum({ total: 'refund_amount' }).first();
      return num(row?.total);
    },
  );
  if (srTotal > 0) push('Sales Returns', srTotal); // contra-revenue (Debit)

  // ─ Expense accounts (Debit) ─
  // COGS: SUM(cogs) on sales — see header comment for the prior-bug history.
  const cogsTotal = await safeSum(
    { route: 'financials.tb.cogs', label: 'COGS', warnings, context: ctx },
    async () => {
      const row = await db('sales').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .sum({ total: 'cogs' }).first();
      return num(row?.total);
    },
  );
  push('Cost of Goods Sold', cogsTotal);

  const cogsReversalTotal = await safeSum(
    { route: 'financials.tb.cogs_reversal', label: 'COGS Reversal', warnings, context: ctx },
    async () => {
      const row = await db('sales_returns').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('return_date', '<=', asOf); })
        .sum({ total: 'cogs_reversal' }).first();
      return num(row?.total);
    },
  );
  if (cogsReversalTotal > 0) push('COGS Reversal (returns)', -cogsReversalTotal);

  // Phase 1A — legacy_pre_fix detection (same intent as P&L).
  const legacyCogsCount = await safeSum(
    { route: 'financials.tb.legacy_pre_fix_check', label: 'Legacy-COGS check', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId, cogs_method: 'legacy_pre_fix' })
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .count<{ count: string }[]>('id as count')
        .first();
      return Number(row?.count ?? 0);
    },
  );
  if (legacyCogsCount > 0) {
    const msg = `${legacyCogsCount} sale(s) were recorded before the Phase 1A tile-COGS correction; their stored cost is approximate (understated for tile products).`;
    warnings.push(msg);
    logRouteWarn('financials.tb.legacy_pre_fix', msg, { ...ctx, legacyCogsCount });
  }

  const expRows = await safeQuery<{ category: string | null; total: unknown }[]>(
    { route: 'financials.tb.expenses', label: 'Expenses', warnings, context: ctx },
    async () =>
      db('expenses').where({ dealer_id: dealerId })
        .modify(qb => { if (asOf) qb.where('expense_date', '<=', asOf); })
        .select('category').sum({ total: 'amount' }).groupBy('category') as unknown as Promise<{ category: string | null; total: unknown }[]>,
    [],
  );
  for (const r of expRows) push(`Expense — ${r.category || 'Uncategorized'}`, num(r.total));

  // ─ Manual journal lines (added on top, per-account net) ─
  const jRows = await safeQuery<{ account: string; debit: unknown; credit: unknown }[]>(
    { route: 'financials.tb.journal', label: 'Manual Journal Entries', warnings, context: ctx },
    async () =>
      db('journal_entry_lines as jel')
        .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
        .where('jel.dealer_id', dealerId)
        .modify(qb => { if (asOf) qb.where('je.entry_date', '<=', asOf); })
        .select('jel.account')
        .sum({ debit: 'jel.debit' })
        .sum({ credit: 'jel.credit' })
        .groupBy('jel.account') as unknown as Promise<{ account: string; debit: unknown; credit: unknown }[]>,
    [],
  );
  for (const r of jRows) {
    const net = num(r.debit) - num(r.credit);
    push(`Journal — ${r.account}`, net);
  }

  accounts.sort((a, b) => a.account.localeCompare(b.account));
  const total_debit = accounts.reduce((s, r) => s + r.debit, 0);
  const total_credit = accounts.reduce((s, r) => s + r.credit, 0);

  res.json({
    as_of: asOf,
    accounts,
    total_debit,
    total_credit,
    difference: +(total_debit - total_credit).toFixed(2),
    // ── Phase 1 transparency fields (additive, optional) ──
    warnings,
  });
});

export default router;
