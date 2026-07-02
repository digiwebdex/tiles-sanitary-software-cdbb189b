/**
 * Employee Loan & EMI Tracker — Phase 19
 *
 *   GET    /api/employee-loans                          ?employee_id=&status=
 *   GET    /api/employee-loans/:id                      (with schedule + employee info)
 *   POST   /api/employee-loans                          disburse (auto-generates schedule)
 *   POST   /api/employee-loans/:id/cancel               soft cancel (only if no payments)
 *   POST   /api/employee-loans/:id/close                manual close (waives remaining)
 *
 *   POST   /api/employee-loans/emis/:emiId/pay          { amount, paid_date, payment_source, reference?, notes? }
 *   POST   /api/employee-loans/emis/:emiId/waive
 *
 *   GET    /api/employee-loans/summary                  KPI block: outstanding, due-this-month, overdue
 *   GET    /api/employee-loans/employee/:employeeId/outstanding  total outstanding for one employee
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

// Express 4 does not forward rejected promises from async handlers to the
// router-level error middleware below, so an unhandled business/DB error (or a
// throwing schema.parse) would hang the request. Wrap async handlers so their
// rejections reach the error handler (which maps err.status → HTTP status).
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

/* ─────────────────────── helpers ─────────────────────── */

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
  return target.toISOString().slice(0, 10);
}

async function nextLoanCode(trx: any, dealerId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LN-${year}-`;
  const last = await trx('employee_loans')
    .where({ dealer_id: dealerId })
    .andWhere('loan_code', 'like', `${prefix}%`)
    .orderBy('loan_code', 'desc')
    .first();
  const seq = last ? Number(String(last.loan_code).split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/* ─────────────────────── summary ─────────────────────── */

router.get('/summary', wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const monthEnd = addMonths(monthStart, 1);

  const [totals] = await db('employee_loan_emis')
    .where({ dealer_id: dealerId })
    .whereIn('status', ['pending', 'partial'])
    .select(db.raw('COALESCE(SUM(amount_due - amount_paid), 0) as outstanding'));

  const [dueThisMonth] = await db('employee_loan_emis')
    .where({ dealer_id: dealerId })
    .whereIn('status', ['pending', 'partial'])
    .andWhere('due_date', '>=', monthStart)
    .andWhere('due_date', '<', monthEnd)
    .select(db.raw('COALESCE(SUM(amount_due - amount_paid), 0) as amount'));

  const [overdue] = await db('employee_loan_emis')
    .where({ dealer_id: dealerId })
    .whereIn('status', ['pending', 'partial'])
    .andWhere('due_date', '<', today)
    .select(db.raw('COALESCE(SUM(amount_due - amount_paid), 0) as amount'), db.raw('COUNT(*)::int as count'));

  const activeLoans = await db('employee_loans').where({ dealer_id: dealerId, status: 'active' }).count<{ count: string }[]>('* as count');

  res.json({
    outstanding: Number(totals.outstanding),
    due_this_month: Number(dueThisMonth.amount),
    overdue_amount: Number(overdue.amount),
    overdue_count: Number(overdue.count),
    active_loans: Number(activeLoans[0].count),
  });
}));

/* ─────────────────────── per-employee outstanding ─────────────────────── */

router.get('/employee/:employeeId/outstanding', wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('employee_loans as l')
    .leftJoin('employee_loan_emis as e', 'e.loan_id', 'l.id')
    .where('l.dealer_id', dealerId)
    .andWhere('l.employee_id', req.params.employeeId)
    .andWhere('l.status', 'active')
    .select(
      db.raw('COALESCE(SUM(e.amount_due - e.amount_paid) FILTER (WHERE e.status IN (?, ?)), 0) as outstanding', ['pending', 'partial']),
      db.raw('COUNT(DISTINCT l.id)::int as active_loans'),
    );
  res.json({ outstanding: Number(rows[0].outstanding), active_loans: Number(rows[0].active_loans) });
}));

/* ─────────────────────── list ─────────────────────── */

router.get('/', wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { employee_id, status } = req.query as Record<string, string | undefined>;
  let qb = db('employee_loans as l')
    .leftJoin('employees as e', 'e.id', 'l.employee_id')
    .where('l.dealer_id', dealerId)
    .leftJoin(
      db('employee_loan_emis')
        .select('loan_id')
        .sum({ paid: 'amount_paid' })
        .sum({ due: 'amount_due' })
        .groupBy('loan_id').as('agg'),
      'agg.loan_id', 'l.id',
    )
    .select(
      'l.*',
      'e.name as employee_name',
      'e.employee_code',
      db.raw('COALESCE(agg.paid, 0) as paid_total'),
      db.raw('COALESCE(agg.due, l.principal) - COALESCE(agg.paid, 0) as balance'),
    )
    .orderBy('l.created_at', 'desc');
  if (employee_id) qb = qb.andWhere('l.employee_id', employee_id);
  if (status) qb = qb.andWhere('l.status', status);
  res.json(await qb);
}));

/* ─────────────────────── detail ─────────────────────── */

router.get('/:id', wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const loan = await db('employee_loans as l')
    .leftJoin('employees as e', 'e.id', 'l.employee_id')
    .leftJoin('bank_accounts as b', 'b.id', 'l.bank_account_id')
    .where('l.id', req.params.id)
    .andWhere('l.dealer_id', dealerId)
    .select('l.*', 'e.name as employee_name', 'e.employee_code', db.raw("COALESCE(b.bank_name || ' — ' || b.account_name, NULL) as bank_account_name"))
    .first();
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const emis = await db('employee_loan_emis')
    .where({ loan_id: loan.id, dealer_id: dealerId })
    .orderBy('installment_no');
  res.json({ ...loan, emis });
}));

/* ─────────────────────── create / disburse ─────────────────────── */

const createSchema = z.object({
  employee_id: z.string().uuid(),
  principal: z.coerce.number().positive(),
  tenure_months: z.coerce.number().int().min(1).max(120),
  issue_date: z.string(),
  first_emi_date: z.string().optional(),
  payment_method: z.enum(['cash', 'bank']).optional(),
  bank_account_id: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post('/', requireRole('dealer_admin', 'super_admin'), wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const body = createSchema.parse(req.body);

  const result = await db.transaction(async (trx: any) => {
    const emp = await trx('employees').where({ id: body.employee_id, dealer_id: dealerId }).first();
    if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
    if (emp.status !== 'active') throw Object.assign(new Error('Cannot issue loan to inactive employee'), { status: 400 });

    if (body.payment_method === 'bank' && !body.bank_account_id) {
      throw Object.assign(new Error('Bank account required for bank disbursement'), { status: 400 });
    }

    const emi = Number((body.principal / body.tenure_months).toFixed(2));
    const firstDue = body.first_emi_date ?? addMonths(body.issue_date, 1);
    const loanCode = await nextLoanCode(trx, dealerId as string);

    const [loan] = await trx('employee_loans').insert({
      dealer_id: dealerId,
      employee_id: body.employee_id,
      loan_code: loanCode,
      principal: body.principal,
      tenure_months: body.tenure_months,
      emi_amount: emi,
      issue_date: body.issue_date,
      first_emi_date: firstDue,
      payment_method: body.payment_method ?? 'cash',
      bank_account_id: body.bank_account_id ?? null,
      reason: body.reason ?? null,
      notes: body.notes ?? null,
      created_by: req.user!.userId,
    }).returning('*');

    // Schedule generation: rounded EMIs with final installment absorbing the remainder
    const schedule: any[] = [];
    let outstanding = Number(body.principal);
    for (let i = 1; i <= body.tenure_months; i++) {
      const amt = i === body.tenure_months ? Number(outstanding.toFixed(2)) : emi;
      schedule.push({
        dealer_id: dealerId,
        loan_id: loan.id,
        installment_no: i,
        due_date: addMonths(firstDue, i - 1),
        amount_due: amt,
      });
      outstanding -= amt;
    }
    await trx('employee_loan_emis').insert(schedule);

    return loan;
  });

  res.status(201).json(result);
}));

/* ─────────────────────── cancel ─────────────────────── */

router.post('/:id/cancel', requireRole('dealer_admin', 'super_admin'), wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const result = await db.transaction(async (trx: any) => {
    const loan = await trx('employee_loans').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
    if (!loan) throw Object.assign(new Error('Loan not found'), { status: 404 });
    if (loan.status !== 'active') throw Object.assign(new Error(`Loan already ${loan.status}`), { status: 400 });

    const paid = await trx('employee_loan_emis')
      .where({ loan_id: loan.id })
      .whereIn('status', ['paid', 'partial'])
      .first();
    if (paid) throw Object.assign(new Error('Cannot cancel — payments already received. Use Close instead.'), { status: 400 });

    const [updated] = await trx('employee_loans')
      .where({ id: loan.id })
      .update({ status: 'cancelled', updated_at: trx.fn.now() })
      .returning('*');
    await trx('employee_loan_emis').where({ loan_id: loan.id }).update({ status: 'waived', updated_at: trx.fn.now() });
    return updated;
  });
  res.json(result);
}));

/* ─────────────────────── close (waive remaining) ─────────────────────── */

router.post('/:id/close', requireRole('dealer_admin', 'super_admin'), wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const result = await db.transaction(async (trx: any) => {
    const loan = await trx('employee_loans').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
    if (!loan) throw Object.assign(new Error('Loan not found'), { status: 404 });
    if (loan.status !== 'active') throw Object.assign(new Error(`Loan already ${loan.status}`), { status: 400 });

    await trx('employee_loan_emis')
      .where({ loan_id: loan.id })
      .whereIn('status', ['pending', 'partial'])
      .update({ status: 'waived', updated_at: trx.fn.now() });

    const [updated] = await trx('employee_loans')
      .where({ id: loan.id })
      .update({ status: 'closed', updated_at: trx.fn.now() })
      .returning('*');
    return updated;
  });
  res.json(result);
}));

/* ─────────────────────── pay an EMI ─────────────────────── */

const paySchema = z.object({
  amount: z.coerce.number().positive(),
  paid_date: z.string(),
  payment_source: z.enum(['salary_deduction', 'manual', 'cash', 'bank']),
  reference: z.string().max(80).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post('/emis/:emiId/pay', requireRole('dealer_admin', 'super_admin'), wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const body = paySchema.parse(req.body);

  const result = await db.transaction(async (trx: any) => {
    const emi = await trx('employee_loan_emis').where({ id: req.params.emiId, dealer_id: dealerId }).forUpdate().first();
    if (!emi) throw Object.assign(new Error('EMI not found'), { status: 404 });
    if (emi.status === 'paid' || emi.status === 'waived') {
      throw Object.assign(new Error(`EMI already ${emi.status}`), { status: 400 });
    }
    const remaining = Number(emi.amount_due) - Number(emi.amount_paid);
    if (body.amount > remaining + 0.005) {
      throw Object.assign(new Error(`Amount exceeds remaining ${remaining.toFixed(2)}`), { status: 400 });
    }
    const newPaid = Number(emi.amount_paid) + body.amount;
    const fullyPaid = Math.abs(newPaid - Number(emi.amount_due)) < 0.005;

    const [updated] = await trx('employee_loan_emis')
      .where({ id: emi.id })
      .update({
        amount_paid: newPaid,
        paid_date: fullyPaid ? body.paid_date : emi.paid_date,
        status: fullyPaid ? 'paid' : 'partial',
        payment_source: body.payment_source,
        reference: body.reference ?? emi.reference,
        notes: body.notes ?? emi.notes,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Auto-close loan when all installments are paid or waived
    const pending = await trx('employee_loan_emis')
      .where({ loan_id: emi.loan_id })
      .whereIn('status', ['pending', 'partial'])
      .first();
    if (!pending) {
      await trx('employee_loans').where({ id: emi.loan_id }).update({ status: 'closed', updated_at: trx.fn.now() });
    }

    return updated;
  });

  res.json(result);
}));

/* ─────────────────────── waive an EMI ─────────────────────── */

router.post('/emis/:emiId/waive', requireRole('dealer_admin', 'super_admin'), wrap(async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const result = await db.transaction(async (trx: any) => {
    const emi = await trx('employee_loan_emis').where({ id: req.params.emiId, dealer_id: dealerId }).forUpdate().first();
    if (!emi) throw Object.assign(new Error('EMI not found'), { status: 404 });
    if (emi.status === 'paid' || emi.status === 'waived') {
      throw Object.assign(new Error(`EMI already ${emi.status}`), { status: 400 });
    }
    const [updated] = await trx('employee_loan_emis')
      .where({ id: emi.id })
      .update({ status: 'waived', notes: req.body?.notes ?? emi.notes, updated_at: trx.fn.now() })
      .returning('*');

    const pending = await trx('employee_loan_emis')
      .where({ loan_id: emi.loan_id })
      .whereIn('status', ['pending', 'partial'])
      .first();
    if (!pending) {
      await trx('employee_loans').where({ id: emi.loan_id }).update({ status: 'closed', updated_at: trx.fn.now() });
    }
    return updated;
  });
  res.json(result);
}));

/* ─────────────────────── error handler ─────────────────────── */

router.use((err: any, _req: Request, res: Response, _next: any) => {
  // Invalid request bodies arrive here as ZodError (schema.parse) → 400.
  if (err?.name === 'ZodError') {
    res.status(400).json({ error: 'Invalid input', issues: err.flatten?.() ?? err.errors });
    return;
  }
  const status = Number(err?.status ?? err?.statusCode) || 500;
  res.status(status).json({ error: err?.message ?? 'Internal error' });
});

export default router;
