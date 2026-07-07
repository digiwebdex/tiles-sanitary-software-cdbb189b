/**
 * Project Accounting — V2 Sprint 6D.
 *
 *   GET /api/project-accounting/:projectId/summary        budget + revenue + expense + profitability
 *   GET /api/project-accounting/:projectId/expenses?from=&to=
 *   GET /api/project-accounting/:projectId/ledger?from=&to=   posting_lines tagged project_id=:projectId
 *   GET /api/project-accounting/:projectId/profitability?from=&to=
 *
 * Project Master / Project Status / Project Sites are entirely out of scope
 * here — fully covered by the existing `projects.ts` (Project Master CRUD)
 * and `projectReports.ts` (sales/delivery/quotation reporting), both
 * untouched. This route adds ONLY the accounting-specific views the existing
 * Project module never had: Budget (reads the shared `budgets` table —
 * scope_type='project' — written by budgets.ts), Expense (reads the
 * `expenses.project_id` column wired in this same sprint), and
 * Profitability/Ledger (derived from the two, plus posting_lines).
 *
 * "Project GL Posting" (the sprint's own scope item) needs no new code here:
 * expenses.ts and journal.ts already tag `project_id` on their posting_lines
 * mirror as of this sprint (see routes/expenses.ts, routes/journal.ts) — the
 * ledger endpoint below simply reads what those choke points already write.
 *
 * Profitability = Revenue (sales.total_amount where project_id) - Expense
 * (expenses.amount where project_id). COGS is NOT netted in (stock/sale_out
 * posting lines don't carry project_id — sales was intentionally left
 * unwired this sprint, see docs/SPRINT6D's Deferred Items) — this is a
 * revenue-vs-expense view, not a full gross-margin one.
 */
import { Router, Request, Response } from 'express';
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

function toNum(v: unknown): number {
  return Number(v ?? 0) || 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadProject(dealerId: string, projectId: string) {
  return db('projects').where({ id: projectId, dealer_id: dealerId }).first();
}

async function sumRevenue(dealerId: string, projectId: string, from?: string, to?: string): Promise<number> {
  const q = db('sales').where({ dealer_id: dealerId, project_id: projectId });
  if (from) q.andWhere('sale_date', '>=', from);
  if (to) q.andWhere('sale_date', '<=', to);
  const rows = await q.select('total_amount');
  return round2((rows as any[]).reduce((s, r) => s + toNum(r.total_amount), 0));
}

async function sumExpense(dealerId: string, projectId: string, from?: string, to?: string): Promise<number> {
  const q = db('expenses').where({ dealer_id: dealerId, project_id: projectId });
  if (from) q.andWhere('expense_date', '>=', from);
  if (to) q.andWhere('expense_date', '<=', to);
  const rows = await q.select('amount');
  return round2((rows as any[]).reduce((s, r) => s + toNum(r.amount), 0));
}

async function loadLatestBudget(dealerId: string, projectId: string) {
  return db('budgets')
    .where({ dealer_id: dealerId, project_id: projectId, scope_type: 'project', is_active: true })
    .orderBy('period_start', 'desc')
    .first();
}

router.get('/:projectId/summary', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const project = await loadProject(dealerId, req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const [revenue, expense, budget] = await Promise.all([
    sumRevenue(dealerId, project.id),
    sumExpense(dealerId, project.id),
    loadLatestBudget(dealerId, project.id),
  ]);
  const profit = round2(revenue - expense);

  res.json({
    project: { id: project.id, project_name: project.project_name, project_code: project.project_code, status: project.status },
    budget: budget ? { amount: Number(budget.amount), period_start: budget.period_start, period_end: budget.period_end, revision_no: budget.revision_no } : null,
    revenue,
    expense,
    profit,
    margin_percent: revenue > 0 ? round2((profit / revenue) * 100) : null,
    budget_variance: budget ? round2(Number(budget.amount) - expense) : null,
  });
});

router.get('/:projectId/profitability', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const project = await loadProject(dealerId, req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const [revenue, expense] = await Promise.all([
    sumRevenue(dealerId, project.id, from, to),
    sumExpense(dealerId, project.id, from, to),
  ]);
  const profit = round2(revenue - expense);
  res.json({
    project_id: project.id, from: from ?? null, to: to ?? null,
    revenue, expense, profit,
    margin_percent: revenue > 0 ? round2((profit / revenue) * 100) : null,
  });
});

router.get('/:projectId/expenses', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const project = await loadProject(dealerId, req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = db('expenses').where({ dealer_id: dealerId, project_id: project.id });
  if (from) q.andWhere('expense_date', '>=', from);
  if (to) q.andWhere('expense_date', '<=', to);
  const rows = await q.orderBy('expense_date', 'desc');
  res.json({ rows });
});

router.get('/:projectId/ledger', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const project = await loadProject(dealerId, req.params.projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = db('posting_lines').where({ dealer_id: dealerId, project_id: project.id });
  if (from) q.andWhere('entry_date', '>=', from);
  if (to) q.andWhere('entry_date', '<=', to);
  const rows = await q.select('line_domain', 'line_type', 'amount', 'entry_date', 'posting_batch_id');

  const byDomain: Record<string, number> = {};
  let total = 0;
  for (const r of rows as any[]) {
    const amt = toNum(r.amount);
    byDomain[r.line_domain] = round2((byDomain[r.line_domain] || 0) + amt);
    total = round2(total + amt);
  }

  res.json({
    project_id: project.id, from: from ?? null, to: to ?? null,
    total, by_domain: byDomain, line_count: rows.length, lines: rows,
  });
});

export default router;
