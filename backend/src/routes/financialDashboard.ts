/**
 * Financial Dashboard — V2 Sprint 6E.
 *
 *   GET /api/financial-dashboard?from=&to=
 *
 * Reuses the same helpers `financials.ts`'s Balance Sheet already uses
 * (reportQueryService.ts's sumCustomerOutstandingFromReadModel /
 * sumSupplierPayable / sumInventoryValuationWac) rather than re-deriving
 * receivable/payable/inventory a third way. Adds the two genuinely-missing
 * computed ratios: Current Ratio and Working Capital.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import {
  sumCustomerOutstandingFromReadModel,
  sumInventoryValuationWac,
  sumSupplierPayable,
} from '../services/reportQueryService';

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

function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin') || hasRole(req, 'finance_manager') || hasRole(req, 'senior_accountant') || hasRole(req, 'accountant')) return true;
  res.status(403).json({ error: 'Financial dashboard requires an accounting role' });
  return false;
}

function num(v: unknown): number {
  return Number(v) || 0;
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const from = (req.query.from as string | undefined) || null;
  const to = (req.query.to as string | undefined) || null;

  try {
    const [
      revenueRow, expenseRow, cashRow, bankRow,
      receivable, payable, inventory_value, vatPayableRow,
    ] = await Promise.all([
      db('sales').where({ dealer_id: dealerId }).whereNot('document_status', 'reversed')
        .modify(qb => { if (from) qb.where('sale_date', '>=', from); if (to) qb.where('sale_date', '<=', to); })
        .sum({ total: 'taxable_amount' }).first(),
      db('expenses').where({ dealer_id: dealerId })
        .modify(qb => { if (from) qb.where('expense_date', '>=', from); if (to) qb.where('expense_date', '<=', to); })
        .sum({ total: 'amount' }).first(),
      db('cash_ledger').where({ dealer_id: dealerId }).modify(qb => { if (to) qb.where('entry_date', '<=', to); }).sum({ total: 'amount' }).first(),
      db('bank_ledger').where({ dealer_id: dealerId }).modify(qb => { if (to) qb.where('entry_date', '<=', to); }).sum({ total: 'amount' }).first(),
      sumCustomerOutstandingFromReadModel(dealerId),
      sumSupplierPayable(dealerId, to),
      sumInventoryValuationWac(dealerId),
      db('gl_journal_lines as jl')
        .join('gl_journal_entries as je', 'je.id', 'jl.journal_entry_id')
        .join('gl_accounts as a', 'a.id', 'jl.account_id')
        .where('je.dealer_id', dealerId).andWhere('a.code', '2100')
        .modify(qb => { if (to) qb.where('je.entry_date', '<=', to); })
        .sum({ debit: 'jl.debit' }).sum({ credit: 'jl.credit' }).first(),
    ]);

    const revenue = round2(num((revenueRow as any)?.total));
    const expenses = round2(num((expenseRow as any)?.total));
    const profit = round2(revenue - expenses);
    const cash = round2(num((cashRow as any)?.total));
    const bank = round2(num((bankRow as any)?.total));
    const cash_position = round2(cash + bank);
    const vat_payable = round2(num((vatPayableRow as any)?.credit) - num((vatPayableRow as any)?.debit));

    const current_assets = round2(cash_position + round2(inventory_value) + round2(receivable));
    const current_liabilities = round2(round2(payable) + vat_payable);
    const current_ratio = current_liabilities > 0.005 ? round2(current_assets / current_liabilities) : null;
    const working_capital = round2(current_assets - current_liabilities);

    res.json({
      period: { from, to },
      revenue,
      expenses,
      profit,
      cash_position,
      receivable: round2(receivable),
      payable: round2(payable),
      inventory_value: round2(inventory_value),
      current_ratio,
      working_capital,
      current_assets,
      current_liabilities,
      data_source: 'sales.taxable_amount (ex-tax) + expenses.amount; cash/bank ledgers; read-model receivable/payable; WAC inventory; VAT Payable from GL Spine',
    });
  } catch (err: any) {
    console.error('[financial-dashboard]', err.message);
    res.status(500).json({ error: 'Failed to load financial dashboard' });
  }
});

export default router;
