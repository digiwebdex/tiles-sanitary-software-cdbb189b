/**
 * Financial Closing — V2 Sprint 6E.
 *
 *   GET  /api/financial-closing/fiscal-years/:id/readiness   which periods (if any) block closing
 *   POST /api/financial-closing/fiscal-years/:id/close        Fiscal Year Closing (see financialClosingService.ts)
 *   GET  /api/financial-closing/fiscal-years/:id/closing-journal   view the generated closing entry
 *
 * Period Closing itself is unchanged — reuse fiscalYears.ts's existing
 * POST /:fiscalYearId/periods/:periodId/close and /reopen.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';
import { closeFiscalYear, FiscalYearCloseError } from '../services/accounting/financialClosingService';

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
const CLOSE_ROLES = ['dealer_admin', 'super_admin', 'finance_manager'] as const;

router.get('/fiscal-years/:id/readiness', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const fy = await db('fiscal_years').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!fy) { res.status(404).json({ error: 'Fiscal year not found' }); return; }

  const openPeriods = await db('accounting_periods')
    .where({ fiscal_year_id: fy.id })
    .andWhereNot('status', 'closed')
    .orderBy('period_no')
    .select('id', 'period_no', 'start_date', 'end_date');

  const earlierOpenFy = await db('fiscal_years')
    .where({ dealer_id: dealerId })
    .andWhere('start_date', '<', fy.start_date)
    .andWhere('status', 'open')
    .first('id', 'name');

  res.json({
    fiscal_year: { id: fy.id, name: fy.name, status: fy.status, start_date: fy.start_date, end_date: fy.end_date },
    ready: fy.status === 'open' && openPeriods.length === 0 && !earlierOpenFy,
    open_periods: openPeriods,
    blocking_earlier_fiscal_year: earlierOpenFy ? { id: earlierOpenFy.id, name: earlierOpenFy.name } : null,
  });
});

router.post('/fiscal-years/:id/close', requireRole(...CLOSE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  try {
    const result = await closeFiscalYear({ dealerId, fiscalYearId: req.params.id, userId: req.user?.userId ?? null });
    res.json(result);
  } catch (err: any) {
    if (err instanceof FiscalYearCloseError) { res.status(409).json({ error: err.message }); return; }
    console.error('[financial-closing/close]', err.message);
    res.status(500).json({ error: 'Failed to close fiscal year' });
  }
});

router.get('/fiscal-years/:id/closing-journal', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const fy = await db('fiscal_years').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!fy) { res.status(404).json({ error: 'Fiscal year not found' }); return; }
  if (!fy.closing_journal_entry_id) { res.json({ journal: null, lines: [] }); return; }

  const [journal, lines] = await Promise.all([
    db('journal_entries').where({ id: fy.closing_journal_entry_id, dealer_id: dealerId }).first(),
    db('journal_entry_lines').where({ journal_entry_id: fy.closing_journal_entry_id }).orderBy('line_order'),
  ]);
  res.json({ journal, lines });
});

export default router;
