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
import {
  sumCustomerOutstandingFromReadModel,
  sumInventoryValuationWac,
  sumSupplierPayable,
} from '../services/reportQueryService';
import { detectCogsDataQualityWarnings } from '../lib/pnlMath';
import {
  buildFinancialsTrialBalanceFromGl,
  shouldUseGlTrialBalance,
} from '../services/gl/glFinancialsBridge';

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
        .whereNot('document_status', 'reversed')
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'total_amount' })
        .first();
      return num(row?.total);
    },
  );

  // ── Output tax split (Mushak): VAT + SD are liabilities collected on behalf
  // of the government, NOT income. Surfaced so profit can be computed on the
  // ex-tax taxable base and the balance/TB can carry a VAT-payable liability.
  // For VAT-disabled dealers vat_amount/sd_amount are 0, so these are no-ops. ──
  const taxable_revenue = await safeSum(
    { route: 'financials.pnl.taxable_revenue', label: 'Taxable Revenue', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .whereNot('document_status', 'reversed')
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'taxable_amount' })
        .first();
      return num(row?.total);
    },
  );
  const output_vat = await safeSum(
    { route: 'financials.pnl.output_vat', label: 'Output VAT', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .whereNot('document_status', 'reversed')
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'vat_amount' })
        .first();
      return num(row?.total);
    },
  );
  const output_sd = await safeSum(
    { route: 'financials.pnl.output_sd', label: 'Output SD', warnings, context: ctx },
    async () => {
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .whereNot('document_status', 'reversed')
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'sd_amount' })
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
        .whereNot('document_status', 'reversed')
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
        .whereNot('document_status', 'reversed')
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

  // ── V2 Sprint 6E — Other Income / Other Expenses ──
  // Asset disposal gains/losses and bad debt write-offs (Sprint 6D+) have no
  // home in the legacy subledgers this file otherwise reads — they only
  // exist as GL Spine postings (accounts 4100/6200/6100). Sourced from the
  // GL Spine specifically for that reason, not because the rest of this
  // report is being migrated off subledgers.
  const other_income = await safeSum(
    { route: 'financials.pnl.other_income', label: 'Other Income (Gain on Disposal)', warnings, context: ctx },
    async () => {
      const row = await db('gl_journal_lines as jl')
        .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
        .join('gl_accounts as a', 'a.id', 'jl.account_id')
        .where('je.dealer_id', dealerId)
        .andWhere('a.code', '4100')
        .modify(qb => { if (from) qb.where('je.entry_date', '>=', from); if (to) qb.where('je.entry_date', '<=', to); })
        .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' }).first();
      return num((row as any)?.credit) - num((row as any)?.debit);
    },
  );
  const other_expenses = await safeSum(
    { route: 'financials.pnl.other_expenses', label: 'Other Expenses (Loss on Disposal + Bad Debt)', warnings, context: ctx },
    async () => {
      const row = await db('gl_journal_lines as jl')
        .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
        .join('gl_accounts as a', 'a.id', 'jl.account_id')
        .where('je.dealer_id', dealerId)
        .whereIn('a.code', ['6200', '6100'])
        .modify(qb => { if (from) qb.where('je.entry_date', '>=', from); if (to) qb.where('je.entry_date', '<=', to); })
        .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' }).first();
      return num((row as any)?.debit) - num((row as any)?.credit);
    },
  );

  // Profit must be computed on the ex-tax taxable base — output VAT/SD in
  // `revenue` (gross) are liabilities, not earnings. `taxable_revenue` already
  // excludes them. Returns are stored gross (refund_amount); subtracting them
  // from the net base slightly understates profit by the VAT portion of
  // returns — conservative, and surfaced in a warning below.
  const net_output_tax = output_vat + output_sd;
  const cost_of_sales = net_cogs;
  const gross_profit = taxable_revenue - sales_returns - cost_of_sales;
  const operating_expenses = total_expenses;
  const operating_profit = gross_profit - operating_expenses;
  const net_profit = operating_profit + other_income - other_expenses;
  if (net_output_tax > 0.005) {
    warnings.push(
      'Revenue is shown gross (VAT/SD-inclusive); profit is computed on the ex-tax taxable base. Output VAT/SD are liabilities (see output_vat/output_sd), not income. Sales returns are netted at their gross refund amount.',
    );
  }
  if (other_income > 0.005 || other_expenses > 0.005) {
    warnings.push(
      'V2 Sprint 6E: net_profit now nets Other Income/Other Expenses (asset disposal gains/losses, bad debt) sourced from the GL Spine — these were not included in prior sprints\' net_profit figure.',
    );
  }

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
    // Ex-tax income and the output-tax liabilities collected on top of it.
    taxable_revenue,
    output_vat,
    output_sd,
    net_output_tax,
    sales_returns,
    net_revenue: taxable_revenue - sales_returns,
    gross_sales: revenue,
    cogs,
    cogs_reversal,
    net_cogs,
    cost_of_sales,
    gross_profit,
    expenses_by_category,
    total_expenses,
    operating_expenses,
    operating_profit,
    other_income,
    other_expenses,
    net_profit,
    // ── Phase 1 transparency fields (additive, optional) ──
    data_source: 'sales.taxable_amount (ex-tax) + sales.cogs + sales_returns.refund_amount + sales_returns.cogs_reversal; reversed sales excluded; other_income/other_expenses from GL Spine (V2 Sprint 6E)',
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

  // ── Inventory valuation at WAC (P4-03) ──
  const inventory = await safeSum(
    { route: 'financials.bs.inventory', label: 'Inventory valuation (WAC)', warnings, context: ctx },
    () => sumInventoryValuationWac(dealerId),
  );

  // ── Accounts receivable: read model (current) or sales snapshot (asOf) ──
  const receivable = await safeSum(
    { route: 'financials.bs.ar', label: 'Accounts Receivable', warnings, context: ctx },
    async () => {
      if (!asOf) {
        return sumCustomerOutstandingFromReadModel(dealerId);
      }
      const row = await db('sales')
        .where({ dealer_id: dealerId })
        .whereNot('document_status', 'reversed')
        .where('sale_date', '<=', asOf)
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

  // ── V2 Sprint 6E — Fixed Assets (net of Accumulated Depreciation), the
  // Non-current Asset the Balance Sheet was missing entirely (Sprint 6D
  // introduced Fixed Assets but nothing sourced them into this report). ──
  const fixed_assets_net = await safeSum(
    { route: 'financials.bs.fixed_assets', label: 'Fixed Assets (net)', warnings, context: ctx },
    async () => {
      if (!asOf) {
        const row = await db('assets')
          .where({ dealer_id: dealerId })
          .whereNotNull('purchase_posting_batch_id')
          .whereNot('status', 'disposed')
          .sum({ cost: 'purchase_cost' }).sum({ dep: 'accumulated_depreciation' }).first();
        return num((row as any)?.cost) - num((row as any)?.dep);
      }
      const rows = await db('assets')
        .where({ dealer_id: dealerId })
        .whereNotNull('purchase_posting_batch_id')
        .where('purchase_date', '<=', asOf)
        .andWhere(qb => qb.whereNull('disposed_at').orWhere('disposed_at', '>', asOf))
        .select('id', 'purchase_cost');
      let total = 0;
      for (const r of rows as any[]) {
        const dep = await db('asset_depreciation_schedule')
          .where({ dealer_id: dealerId, asset_id: r.id })
          .andWhere('period_end', '<=', asOf)
          .sum({ total: 'depreciation_amount' }).first();
        total += num(r.purchase_cost) - num((dep as any)?.total);
      }
      return total;
    },
  );

  // ── V2 Sprint 6E — VAT Payable (cumulative GL balance), the current
  // liability every sale already credits (glLineMapper.ts) but which this
  // report never surfaced. ──
  const vat_payable = await safeSum(
    { route: 'financials.bs.vat_payable', label: 'VAT Payable', warnings, context: ctx },
    async () => {
      const row = await db('gl_journal_lines as jl')
        .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
        .join('gl_accounts as a', 'a.id', 'jl.account_id')
        .where('je.dealer_id', dealerId)
        .andWhere('a.code', '2100')
        .modify(qb => { if (asOf) qb.where('je.entry_date', '<=', asOf); })
        .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' }).first();
      return num((row as any)?.credit) - num((row as any)?.debit);
    },
  );

  // ── V2 Sprint 6E — Retained Earnings actually posted by Fiscal Year
  // Closing (journal_entry_lines, account='Retained Earnings' by the exact
  // convention the closing-journal generator uses). Additive alongside the
  // pre-existing `retained_earnings` plug below — 0 until a dealer has
  // closed at least one fiscal year. ──
  const retained_earnings_from_closing = await safeSum(
    { route: 'financials.bs.retained_earnings_closed', label: 'Retained Earnings (from Fiscal Year Closing)', warnings, context: ctx },
    async () => {
      const row = await db('journal_entry_lines as jel')
        .join('journal_entries as je', 'je.id', 'jel.journal_entry_id')
        .where('je.dealer_id', dealerId)
        .andWhere('je.status', 'posted')
        .whereNull('je.voided_at')
        .andWhereRaw("TRIM(jel.account) = 'Retained Earnings'")
        .modify(qb => { if (asOf) qb.where('je.entry_date', '<=', asOf); })
        .sum({ debit: 'jel.debit' }).sum({ credit: 'jel.credit' }).first();
      return num((row as any)?.credit) - num((row as any)?.debit);
    },
  );

  const current_assets = cash + bank_total + inventory + receivable;
  const non_current_assets = fixed_assets_net;
  const total_assets = current_assets + non_current_assets;
  const current_liabilities = payable + vat_payable;
  const long_term_liabilities = 0;
  const total_liabilities = current_liabilities + long_term_liabilities;
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
      fixed_assets_net,
      current_assets,
      non_current_assets,
      total: total_assets,
    },
    liabilities: {
      accounts_payable: payable,
      vat_payable,
      current_liabilities,
      long_term_liabilities,
      total: total_liabilities,
    },
    equity: {
      director_capital,
      retained_earnings,
      retained_earnings_from_closing,
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
  const source = (req.query.source as string | undefined) || 'auto';

  if (await shouldUseGlTrialBalance(dealerId, source)) {
    const payload = await buildFinancialsTrialBalanceFromGl(dealerId, asOf);
    res.json(payload);
    return;
  }

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
    { route: 'financials.tb.inventory', label: 'Inventory valuation (WAC)', warnings, context: ctx },
    () => sumInventoryValuationWac(dealerId),
  );
  push('Inventory', inventoryTotal);

  const arTotal = await safeSum(
    { route: 'financials.tb.ar', label: 'Accounts Receivable', warnings, context: ctx },
    async () => {
      if (!asOf) {
        return sumCustomerOutstandingFromReadModel(dealerId);
      }
      const row = await db('sales').where({ dealer_id: dealerId })
        .where('sale_date', '<=', asOf)
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
  // Revenue is booked at the ex-tax taxable value; output VAT/SD are split out
  // as liability credits so they aren't misclassified as income. The three
  // credits still sum to gross total_amount, so the trial balance stays
  // balanced against the gross AR/cash debits. Reversed sales are excluded.
  const taxRow = await safeQuery<{ taxable: unknown; vat: unknown; sd: unknown }[]>(
    { route: 'financials.tb.revenue_split', label: 'Sales Revenue (ex-tax) + output tax', warnings, context: ctx },
    async () =>
      db('sales').where({ dealer_id: dealerId })
        .whereNot('document_status', 'reversed')
        .modify(qb => { if (asOf) qb.where('sale_date', '<=', asOf); })
        .sum({ taxable: 'taxable_amount' })
        .sum({ vat: 'vat_amount' })
        .sum({ sd: 'sd_amount' }) as unknown as Promise<{ taxable: unknown; vat: unknown; sd: unknown }[]>,
    [],
  );
  const revTaxable = num(taxRow?.[0]?.taxable);
  const outVat = num(taxRow?.[0]?.vat);
  const outSd = num(taxRow?.[0]?.sd);
  if (revTaxable > 0) push('Sales Revenue', -revTaxable);
  if (outVat > 0.005) push('VAT Payable', -outVat);
  if (outSd > 0.005) push('SD Payable', -outSd);
  if (outVat > 0.005 || outSd > 0.005) {
    warnings.push(
      'VAT/SD Payable shown here is gross output tax collected on sales. Netting of input VAT (on purchases) and any VAT settlement payments is not yet reflected — treat as the upper bound of the tax liability.',
    );
  }

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
        .whereNot('document_status', 'reversed')
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
        .whereNot('document_status', 'reversed')
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
        .whereNull('je.voided_at')
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
    data_source: 'legacy_subledgers',
    // ── Phase 1 transparency fields (additive, optional) ──
    warnings,
  });
});

// ── GET /cash-flow — period cash movement summary (from the cash ledger) ──
// Opening cash + inflows/outflows grouped by type → closing cash. Complements
// the "Cash in Hand" dashboard KPI (same cash_ledger source).
router.get('/cash-flow', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;
  try {
    const r2 = (v: unknown) => Math.round(num(v) * 100) / 100;
    const openingRow = from
      ? await db('cash_ledger').where({ dealer_id: dealerId }).where('entry_date', '<', from).sum({ s: 'amount' }).first()
      : null;
    const opening_cash = r2((openingRow as any)?.s);

    const rows = await db('cash_ledger')
      .where({ dealer_id: dealerId })
      .modify((qb) => { if (from) qb.where('entry_date', '>=', from); if (to) qb.where('entry_date', '<=', to); })
      .select('type')
      .sum({ inflow: db.raw('CASE WHEN amount >= 0 THEN amount ELSE 0 END') })
      .sum({ outflow: db.raw('CASE WHEN amount < 0 THEN -amount ELSE 0 END') })
      .groupBy('type');

    const inflows: { label: string; amount: number }[] = [];
    const outflows: { label: string; amount: number }[] = [];
    for (const r of rows as any[]) {
      const inflow = num(r.inflow);
      const outflow = num(r.outflow);
      const label = String(r.type || 'other');
      if (inflow > 0.005) inflows.push({ label, amount: r2(inflow) });
      if (outflow > 0.005) outflows.push({ label, amount: r2(outflow) });
    }
    inflows.sort((a, b) => b.amount - a.amount);
    outflows.sort((a, b) => b.amount - a.amount);
    const total_in = r2(inflows.reduce((s, r) => s + r.amount, 0));
    const total_out = r2(outflows.reduce((s, r) => s + r.amount, 0));
    const net_cash_flow = r2(total_in - total_out);
    const closing_cash = r2(opening_cash + net_cash_flow);

    // ── V2 Sprint 6E — Operating / Investing / Financing classification ──
    // `cash_ledger.type` distinguishes receipt/payment/expense (Operating)
    // from transfer (internal cash<->bank movement, not real economic
    // activity — excluded from all three buckets, reported separately).
    const operating_in = r2(inflows.filter(r => r.label !== 'transfer').reduce((s, r) => s + r.amount, 0));
    const operating_out = r2(outflows.filter(r => r.label !== 'transfer').reduce((s, r) => s + r.amount, 0));
    const internal_transfers = r2(
      inflows.filter(r => r.label === 'transfer').reduce((s, r) => s + r.amount, 0)
      - outflows.filter(r => r.label === 'transfer').reduce((s, r) => s + r.amount, 0),
    );

    // Investing: Fixed Asset purchase/disposal cash-side effect. This does
    // NOT appear in cash_ledger at all — assetPosting.ts (Sprint 6D) mirrors
    // straight into the GL Spine, never cash_ledger — so it must be sourced
    // from gl_journal_lines specifically, the same pattern already used for
    // P&L's other_income/other_expenses and the Balance Sheet's fixed_assets_net.
    const investingRow = await db('gl_journal_lines as jl')
      .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
      .join('gl_accounts as a', 'a.id', 'jl.account_id')
      .where('je.dealer_id', dealerId)
      .whereIn('je.document_type', ['fixed_asset_purchase', 'fixed_asset_disposal'])
      .whereIn('a.code', ['1000', '1010'])
      .modify(qb => { if (from) qb.where('je.entry_date', '>=', from); if (to) qb.where('je.entry_date', '<=', to); })
      .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' }).first();
    const investing_in = r2(num((investingRow as any)?.debit));
    const investing_out = r2(num((investingRow as any)?.credit));

    // Financing: director capital movements (director_transactions, not cash_ledger).
    const financingRows = await db('director_transactions')
      .where({ dealer_id: dealerId })
      .modify(qb => { if (from) qb.where('entry_date', '>=', from); if (to) qb.where('entry_date', '<=', to); })
      .select('type').sum({ total: 'amount' }).groupBy('type');
    let financing_in = 0, financing_out = 0;
    for (const r of financingRows as any[]) {
      const amt = num(r.total);
      if (r.type === 'deposit') financing_in = r2(financing_in + amt);
      else if (r.type === 'withdrawal' || r.type === 'dividend') financing_out = r2(financing_out + amt);
    }

    const operating_activities = { inflow: operating_in, outflow: operating_out, net: r2(operating_in - operating_out) };
    const investing_activities = { inflow: investing_in, outflow: investing_out, net: r2(investing_in - investing_out) };
    const financing_activities = { inflow: financing_in, outflow: financing_out, net: r2(financing_in - financing_out) };
    const net_cash_flow_classified = r2(operating_activities.net + investing_activities.net + financing_activities.net);

    res.json({
      period: { from, to },
      opening_cash, inflows, outflows,
      total_in, total_out, net_cash_flow, closing_cash,
      operating_activities,
      investing_activities,
      financing_activities,
      internal_transfers,
      net_cash_flow_classified,
      source: 'cash_ledger',
    });
  } catch (err: any) {
    console.error('[financials.cash-flow]', err?.message);
    res.status(500).json({ error: 'Failed to compute cash flow' });
  }
});

export default router;
