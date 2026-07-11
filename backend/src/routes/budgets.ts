/**
 * Budget Management — V2 Sprint 6D.
 *
 *   GET  /api/budgets?dealerId=&fiscalYearId=&scopeType=&departmentId=&costCenterId=&projectId=&activeOnly=
 *   GET  /api/budgets/:id
 *   POST /api/budgets                    Budget Allocation (fiscal-year/department/cost-center/project/account)
 *   POST /api/budgets/:id/revise         Budget Revision — supersedes the old row, keeps history via revision_no/supersedes_id
 *   GET  /api/budgets/:id/variance       Budget vs Actual for one budget row
 *   GET  /api/budgets/variance-report?fiscalYearId=&scopeType=   Variance Analysis across every active budget
 *
 * "Actual" is sourced entirely from data other Sprint 6D pieces already
 * write — no new posting logic (per the sprint's explicit "reuse Posting
 * Engine... do NOT duplicate posting logic" rule):
 *   - cost_center / project: abs(sum(posting_lines.amount)) for that
 *     cost_center_id/project_id within the budget's period — the same
 *     posting_lines aggregation costCenters.ts's own /:id/report already
 *     uses, absolute-valued because expense/cost lines are stored negative
 *     by this codebase's sign convention (see glLineMapper.ts) and a budget
 *     figure is a positive "how much was spent" comparison.
 *   - department: same aggregation, widened to every cost center whose
 *     department_id matches (a department has no direct posting_lines
 *     column of its own — cost centers are the only org unit tagged there).
 *   - account: normal-balance-aware net movement on gl_journal_lines for
 *     that GL account code within the period (debit-credit for asset/
 *     expense accounts, credit-debit otherwise).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';

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

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;
const MANAGE_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const budgetSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  scope_type: z.enum(['department', 'cost_center', 'project', 'account']),
  department_id: z.string().uuid().nullable().optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  account_code: z.string().trim().max(20).nullable().optional(),
  period_type: z.enum(['annual', 'monthly']).optional(),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  amount: z.coerce.number().positive(),
  notes: z.string().nullable().optional(),
});

function scopeKeyFor(scopeType: string): 'department_id' | 'cost_center_id' | 'project_id' | 'account_code' {
  if (scopeType === 'department') return 'department_id';
  if (scopeType === 'cost_center') return 'cost_center_id';
  if (scopeType === 'project') return 'project_id';
  return 'account_code';
}

function validateScope(data: z.infer<typeof budgetSchema>): string | null {
  const key = scopeKeyFor(data.scope_type);
  if (!data[key]) return `scope_type '${data.scope_type}' requires ${key}`;
  const others = (['department_id', 'cost_center_id', 'project_id', 'account_code'] as const).filter((k) => k !== key);
  for (const other of others) {
    if (data[other]) return `${other} must be empty when scope_type is '${data.scope_type}'`;
  }
  return null;
}

router.get('/', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const { fiscalYearId, scopeType, departmentId, costCenterId, projectId } = req.query as Record<string, string | undefined>;
  const activeOnly = req.query.activeOnly !== 'false';
  const q = db('budgets as b')
    .leftJoin('departments as d', 'd.id', 'b.department_id')
    .leftJoin('cost_centers as cc', 'cc.id', 'b.cost_center_id')
    .leftJoin('projects as p', 'p.id', 'b.project_id')
    .where('b.dealer_id', dealerId);
  if (fiscalYearId) q.andWhere('b.fiscal_year_id', fiscalYearId);
  if (scopeType) q.andWhere('b.scope_type', scopeType);
  if (departmentId) q.andWhere('b.department_id', departmentId);
  if (costCenterId) q.andWhere('b.cost_center_id', costCenterId);
  if (projectId) q.andWhere('b.project_id', projectId);
  if (activeOnly) q.andWhere('b.is_active', true);
  const rows = await q
    .select('b.*', 'd.name as department_name', 'cc.name as cost_center_name', 'p.project_name')
    .orderBy('b.period_start', 'desc');
  res.json({ rows });
});

router.post('/', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = budgetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const data = parsed.data;
  const scopeError = validateScope(data);
  if (scopeError) { res.status(400).json({ error: scopeError }); return; }

  try {
    const fy = await db('fiscal_years').where({ id: data.fiscal_year_id, dealer_id: dealerId }).first('id');
    if (!fy) { res.status(400).json({ error: 'Fiscal year not found' }); return; }
    if (data.department_id) {
      const d = await db('departments').where({ id: data.department_id, dealer_id: dealerId }).first('id');
      if (!d) { res.status(400).json({ error: 'Department not found' }); return; }
    }
    if (data.cost_center_id) {
      const cc = await db('cost_centers').where({ id: data.cost_center_id, dealer_id: dealerId }).first('id');
      if (!cc) { res.status(400).json({ error: 'Cost center not found' }); return; }
    }
    if (data.project_id) {
      const p = await db('projects').where({ id: data.project_id, dealer_id: dealerId }).first('id');
      if (!p) { res.status(400).json({ error: 'Project not found' }); return; }
    }

    const [row] = await db('budgets')
      .insert({
        dealer_id: dealerId,
        fiscal_year_id: data.fiscal_year_id,
        scope_type: data.scope_type,
        department_id: data.department_id ?? null,
        cost_center_id: data.cost_center_id ?? null,
        project_id: data.project_id ?? null,
        account_code: data.account_code ?? null,
        period_type: data.period_type ?? 'annual',
        period_start: data.period_start,
        period_end: data.period_end,
        amount: data.amount,
        revision_no: 1,
        supersedes_id: null,
        is_active: true,
        notes: data.notes ?? null,
        created_by: req.user?.userId ?? null,
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[budgets/create]', err.message);
    res.status(500).json({ error: err.message || 'Failed to create budget' });
  }
});

const reviseSchema = z.object({
  amount: z.coerce.number().positive(),
  period_start: z.string().optional(),
  period_end: z.string().optional(),
  notes: z.string().nullable().optional(),
});

router.post('/:id/revise', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = reviseSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const data = parsed.data;

  try {
    const result = await db.transaction(async (trx) => {
      const old = await trx('budgets').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!old) throw Object.assign(new Error('Budget not found'), { status: 404 });
      if (!old.is_active) throw Object.assign(new Error('Cannot revise a superseded or inactive budget'), { status: 400 });

      await trx('budgets').where({ id: old.id }).update({ is_active: false });

      const [row] = await trx('budgets')
        .insert({
          dealer_id: dealerId,
          fiscal_year_id: old.fiscal_year_id,
          scope_type: old.scope_type,
          department_id: old.department_id,
          cost_center_id: old.cost_center_id,
          project_id: old.project_id,
          account_code: old.account_code,
          period_type: old.period_type,
          period_start: data.period_start ?? old.period_start,
          period_end: data.period_end ?? old.period_end,
          amount: data.amount,
          revision_no: old.revision_no + 1,
          supersedes_id: old.id,
          is_active: true,
          notes: data.notes ?? old.notes,
          created_by: req.user?.userId ?? null,
        })
        .returning('*');
      return row;
    });
    res.status(201).json({ row: result });
  } catch (err: any) {
    const status = err?.status ?? 500;
    if (status === 500) console.error('[budgets/revise]', err.message);
    res.status(status).json({ error: err?.message || 'Failed to revise budget' });
  }
});

/* ============================ Budget vs Actual ============================ */

async function computeActual(dealerId: string, budget: any): Promise<number> {
  if (budget.scope_type === 'cost_center' || budget.scope_type === 'project') {
    const col = budget.scope_type === 'cost_center' ? 'cost_center_id' : 'project_id';
    const q = db('posting_lines')
      .where({ dealer_id: dealerId, [col]: budget.scope_type === 'cost_center' ? budget.cost_center_id : budget.project_id })
      .andWhere('entry_date', '>=', budget.period_start)
      .andWhere('entry_date', '<=', budget.period_end);
    const rows = await q.select('amount');
    const total = (rows as any[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return Math.abs(round2(total));
  }

  if (budget.scope_type === 'department') {
    const centers = await db('cost_centers').where({ dealer_id: dealerId, department_id: budget.department_id }).select('id');
    const ids = centers.map((c: any) => c.id);
    if (!ids.length) return 0;
    const rows = await db('posting_lines')
      .where({ dealer_id: dealerId })
      .whereIn('cost_center_id', ids)
      .andWhere('entry_date', '>=', budget.period_start)
      .andWhere('entry_date', '<=', budget.period_end)
      .select('amount');
    const total = (rows as any[]).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return Math.abs(round2(total));
  }

  // 'account'
  const account = await db('gl_accounts').where({ dealer_id: dealerId, code: budget.account_code }).first();
  if (!account) return 0;
  const rows = await db('gl_journal_lines as l')
    .join('gl_journal_entries as e', 'e.id', 'l.journal_entry_id')
    .where('e.dealer_id', dealerId)
    .andWhere('l.account_id', account.id)
    .andWhere('e.entry_date', '>=', budget.period_start)
    .andWhere('e.entry_date', '<=', budget.period_end)
    .select('l.debit', 'l.credit');
  const debitNormal = account.account_type === 'asset' || account.account_type === 'expense';
  const total = (rows as any[]).reduce((s, r) => {
    const d = Number(r.debit) || 0;
    const c = Number(r.credit) || 0;
    return s + (debitNormal ? d - c : c - d);
  }, 0);
  return round2(total);
}

router.get('/:id/variance', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const budget = await db('budgets').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!budget) { res.status(404).json({ error: 'Budget not found' }); return; }

  const actual = await computeActual(dealerId, budget);
  const allocated = Number(budget.amount) || 0;
  const variance = round2(allocated - actual);
  res.json({
    budget,
    actual,
    variance,
    variance_percent: allocated > 0 ? round2((variance / allocated) * 100) : null,
  });
});

router.get('/variance-report', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const { fiscalYearId, scopeType } = req.query as Record<string, string | undefined>;
  const q = db('budgets').where({ dealer_id: dealerId, is_active: true });
  if (fiscalYearId) q.andWhere('fiscal_year_id', fiscalYearId);
  if (scopeType) q.andWhere('scope_type', scopeType);
  const budgetRows = await q;

  const rows = await Promise.all((budgetRows as any[]).map(async (budget) => {
    const actual = await computeActual(dealerId, budget);
    const allocated = Number(budget.amount) || 0;
    const variance = round2(allocated - actual);
    return {
      budget_id: budget.id,
      scope_type: budget.scope_type,
      department_id: budget.department_id,
      cost_center_id: budget.cost_center_id,
      project_id: budget.project_id,
      account_code: budget.account_code,
      period_start: budget.period_start,
      period_end: budget.period_end,
      allocated,
      actual,
      variance,
      variance_percent: allocated > 0 ? round2((variance / allocated) * 100) : null,
    };
  }));
  res.json({ rows });
});

router.get('/:id', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const row = await db('budgets').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!row) { res.status(404).json({ error: 'Budget not found' }); return; }
  res.json({ row });
});

export default router;
