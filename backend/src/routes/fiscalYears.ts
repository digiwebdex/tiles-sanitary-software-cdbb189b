/**
 * Fiscal Year / Accounting Period / Opening Balance — V2 Sprint 6A.
 *
 *   GET  /api/fiscal-years?dealerId=
 *   GET  /api/fiscal-years/current?dealerId=
 *   POST /api/fiscal-years?dealerId=                        (auto-creates monthly periods)
 *   POST /api/fiscal-years/:id/set-current?dealerId=
 *   POST /api/fiscal-years/:id/set-opening-balance-journal?dealerId=
 *   GET  /api/fiscal-years/:id/periods?dealerId=
 *   POST /api/fiscal-years/:fiscalYearId/periods/:periodId/close?dealerId=
 *   POST /api/fiscal-years/:fiscalYearId/periods/:periodId/reopen?dealerId=
 *
 * Per the approved docs/ACCOUNTING_V2_ARCHITECTURE.md §2.2/§2.3: Opening
 * Balance is modeled as ONE ordinary manual Journal entry (the existing
 * `journal_entries` mechanism, reused unmodified) — this file only links a
 * fiscal year to its designated entry, it does not introduce a second
 * opening-balance posting mechanism.
 *
 * "Close the whole fiscal year" (with the Income/Expense-to-Retained-
 * Earnings rollover) is explicitly Sprint 6E's "Financial Closing" scope,
 * not this sprint's — only per-PERIOD close/reopen (the Period Lock
 * requirement) is implemented here.
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
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;
const MANAGE_ROLES = ['dealer_admin', 'super_admin', 'finance_manager'] as const;

async function auditLog(trx: any, req: Request, dealerId: string, action: string, tableName: string, recordId: string, oldData: any, newData: any) {
  await trx('audit_logs').insert({
    dealer_id: dealerId,
    user_id: req.user?.userId ?? null,
    action,
    table_name: tableName,
    record_id: recordId,
    old_data: oldData ? JSON.stringify(oldData) : null,
    new_data: newData ? JSON.stringify(newData) : null,
    ip_address: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  });
}

/** Split [start_date, end_date] into consecutive calendar-month periods. */
export function buildMonthlyPeriods(startDate: string, endDate: string): Array<{ period_no: number; start_date: string; end_date: string }> {
  const periods: Array<{ period_no: number; start_date: string; end_date: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let periodNo = 1;
  while (cursor <= end) {
    const periodStart = new Date(cursor);
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const periodEndCandidate = new Date(nextMonth.getTime() - 86400000); // last day of this month
    const periodEnd = periodEndCandidate > end ? end : periodEndCandidate;
    periods.push({
      period_no: periodNo,
      start_date: periodStart.toISOString().slice(0, 10),
      end_date: periodEnd.toISOString().slice(0, 10),
    });
    periodNo += 1;
    cursor = nextMonth;
  }
  return periods;
}

// ── GET /api/fiscal-years ─────────────────────────────────────────────────
router.get('/', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('fiscal_years').where({ dealer_id: dealerId }).orderBy('start_date', 'desc');
    res.json({ rows });
  } catch (err: any) {
    console.error('[fiscal-years/list]', err.message);
    res.status(500).json({ error: 'Failed to list fiscal years' });
  }
});

// ── GET /api/fiscal-years/current ─────────────────────────────────────────
router.get('/current', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('fiscal_years').where({ dealer_id: dealerId, is_current: true }).first();
    res.json({ row: row ?? null });
  } catch (err: any) {
    console.error('[fiscal-years/current]', err.message);
    res.status(500).json({ error: 'Failed to load current fiscal year' });
  }
});

const createFiscalYearSchema = z.object({
  name: z.string().trim().min(1).max(50),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  set_as_current: z.boolean().default(false),
});

// ── POST /api/fiscal-years — create (+ auto-create monthly periods) ─────
router.post('/', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = createFiscalYearSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { name, start_date, end_date, set_as_current } = parsed.data;
    if (new Date(end_date) <= new Date(start_date)) {
      res.status(400).json({ error: 'end_date must be after start_date' });
      return;
    }

    const row = await db.transaction(async (trx) => {
      if (set_as_current) {
        await trx('fiscal_years').where({ dealer_id: dealerId, is_current: true }).update({ is_current: false });
      }
      const [created] = await trx('fiscal_years')
        .insert({
          dealer_id: dealerId,
          name,
          start_date,
          end_date,
          is_current: set_as_current,
          created_by: req.user?.userId ?? null,
        })
        .returning('*');

      const periods = buildMonthlyPeriods(start_date, end_date).map((p) => ({
        dealer_id: dealerId,
        fiscal_year_id: created.id,
        period_no: p.period_no,
        start_date: p.start_date,
        end_date: p.end_date,
      }));
      if (periods.length) await trx('accounting_periods').insert(periods);

      await auditLog(trx, req, dealerId, 'fiscal_year_create', 'fiscal_years', created.id, null, created);
      return created;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A fiscal year with this name already exists.' });
      return;
    }
    console.error('[fiscal-years/create]', err.message);
    res.status(500).json({ error: 'Failed to create fiscal year' });
  }
});

// ── POST /api/fiscal-years/:id/set-current ───────────────────────────────
router.post('/:id/set-current', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db.transaction(async (trx) => {
      const existing = await trx('fiscal_years').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      await trx('fiscal_years').where({ dealer_id: dealerId, is_current: true }).update({ is_current: false });
      const [updated] = await trx('fiscal_years').where({ id: existing.id }).update({ is_current: true }).returning('*');
      await auditLog(trx, req, dealerId, 'fiscal_year_set_current', 'fiscal_years', existing.id, { is_current: existing.is_current }, { is_current: true });
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: 'Fiscal year not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[fiscal-years/set-current]', err.message);
    res.status(500).json({ error: 'Failed to set current fiscal year' });
  }
});

const setOpeningBalanceSchema = z.object({
  journal_entry_id: z.string().uuid(),
});

// ── POST /api/fiscal-years/:id/set-opening-balance-journal ───────────────
router.post('/:id/set-opening-balance-journal', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = setOpeningBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const row = await db.transaction(async (trx) => {
      const fiscalYear = await trx('fiscal_years').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!fiscalYear) throw Object.assign(new Error('Fiscal year not found'), { status: 404 });

      const entry = await trx('journal_entries')
        .where({ id: parsed.data.journal_entry_id, dealer_id: dealerId })
        .whereNull('voided_at')
        .first();
      if (!entry) throw Object.assign(new Error('Journal entry not found'), { status: 400 });
      if (entry.status !== 'posted') {
        throw Object.assign(new Error('Only a posted journal entry can be set as an Opening Balance.'), { status: 409 });
      }
      if (new Date(entry.entry_date) > new Date(fiscalYear.start_date)) {
        throw Object.assign(new Error('The Opening Balance entry must be dated on or before the fiscal year start date.'), { status: 409 });
      }

      const [updated] = await trx('fiscal_years')
        .where({ id: fiscalYear.id })
        .update({ opening_balance_journal_id: entry.id })
        .returning('*');
      await auditLog(trx, req, dealerId, 'fiscal_year_set_opening_balance', 'fiscal_years', fiscalYear.id, { opening_balance_journal_id: fiscalYear.opening_balance_journal_id }, { opening_balance_journal_id: entry.id });
      return updated;
    });

    res.json({ row });
  } catch (err: any) {
    console.error('[fiscal-years/set-opening-balance-journal]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to link opening balance journal entry' });
  }
});

// ── GET /api/fiscal-years/:id/periods ────────────────────────────────────
router.get('/:id/periods', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const fiscalYear = await db('fiscal_years').where({ id: req.params.id, dealer_id: dealerId }).first('id');
    if (!fiscalYear) {
      res.status(404).json({ error: 'Fiscal year not found' });
      return;
    }
    const rows = await db('accounting_periods').where({ fiscal_year_id: fiscalYear.id, dealer_id: dealerId }).orderBy('period_no');
    res.json({ rows });
  } catch (err: any) {
    console.error('[fiscal-years/periods]', err.message);
    res.status(500).json({ error: 'Failed to list accounting periods' });
  }
});

// ── POST /api/fiscal-years/:fiscalYearId/periods/:periodId/close ────────
router.post('/:fiscalYearId/periods/:periodId/close', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db.transaction(async (trx) => {
      const period = await trx('accounting_periods')
        .where({ id: req.params.periodId, fiscal_year_id: req.params.fiscalYearId, dealer_id: dealerId })
        .first();
      if (!period) return null;
      if (period.status === 'closed') {
        throw Object.assign(new Error('This period is already closed.'), { status: 409 });
      }
      const [updated] = await trx('accounting_periods')
        .where({ id: period.id })
        .update({ status: 'closed', closed_at: trx.fn.now(), closed_by: req.user?.userId ?? null })
        .returning('*');
      await auditLog(trx, req, dealerId, 'accounting_period_close', 'accounting_periods', period.id, { status: 'open' }, { status: 'closed' });
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: 'Accounting period not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[fiscal-years/periods/close]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to close accounting period' });
  }
});

const reopenPeriodSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required to reopen a closed period').max(500),
});

// ── POST /api/fiscal-years/:fiscalYearId/periods/:periodId/reopen ───────
router.post('/:fiscalYearId/periods/:periodId/reopen', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = reopenPeriodSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const row = await db.transaction(async (trx) => {
      // dealer_id is part of the WHERE clause on every query in this file —
      // this reopen action can never match a different dealer's period,
      // even if a caller supplied a period id belonging to another tenant.
      const period = await trx('accounting_periods')
        .where({ id: req.params.periodId, fiscal_year_id: req.params.fiscalYearId, dealer_id: dealerId })
        .first();
      if (!period) return null;
      if (period.status !== 'closed') {
        throw Object.assign(new Error('This period is not closed.'), { status: 409 });
      }
      const [updated] = await trx('accounting_periods')
        .where({ id: period.id })
        .update({ status: 'open', closed_at: null, closed_by: null })
        .returning('*');
      await auditLog(trx, req, dealerId, 'accounting_period_reopen', 'accounting_periods', period.id, { status: 'closed' }, { status: 'open', reason: parsed.data.reason });
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: 'Accounting period not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[fiscal-years/periods/reopen]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to reopen accounting period' });
  }
});

export default router;
