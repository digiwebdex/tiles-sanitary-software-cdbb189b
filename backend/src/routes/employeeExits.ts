/**
 * Employee Exit / Offboarding — Phase 20
 *
 *   GET    /api/employee-exits                       list (?status=&employee_id=&q=)
 *   GET    /api/employee-exits/summary               dashboard KPIs
 *   GET    /api/employee-exits/:id                   detail (with clearance rows)
 *   POST   /api/employee-exits                       initiate (auto-seeds default clearance checklist)
 *   PUT    /api/employee-exits/:id                   update header + recompute net
 *   DELETE /api/employee-exits/:id                   cancel (only when not yet settled)
 *
 *   POST   /api/employee-exits/:id/clearance         add a clearance item
 *   PUT    /api/employee-exits/clearances/:cid       update clearance item (status, remarks)
 *   DELETE /api/employee-exits/clearances/:cid       remove clearance item
 *
 *   GET    /api/employee-exits/:id/settlement-preview  computes outstanding loans/advances + suggested net
 *   POST   /api/employee-exits/:id/settle              mark settled (requires all clearances done/na)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const exitSchema = z.object({
  employee_id: z.string().uuid(),
  exit_type: z.enum(['resignation', 'termination', 'retirement', 'absconding', 'end_of_contract']).optional(),
  resignation_date: z.string(),
  last_working_date: z.string(),
  notice_period_days: z.coerce.number().int().min(0).optional(),
  reason: z.string().nullable().optional(),
  bonus: z.coerce.number().min(0).optional(),
  gratuity: z.coerce.number().min(0).optional(),
  leave_encashment: z.coerce.number().min(0).optional(),
  other_additions: z.coerce.number().min(0).optional(),
  other_deductions: z.coerce.number().min(0).optional(),
  unpaid_salary: z.coerce.number().min(0).optional(),
  rehire_eligible: z.boolean().optional(),
  rehire_eligible_notes: z.string().nullable().optional(),
  exit_interview_notes: z.string().nullable().optional(),
  payment_method: z.enum(['cash', 'bank']).nullable().optional(),
  bank_account_id: z.string().uuid().nullable().optional(),
});

const DEFAULT_CHECKLIST: Array<{ department: string; item: string }> = [
  { department: 'HR', item: 'Resignation letter received' },
  { department: 'HR', item: 'Exit interview completed' },
  { department: 'IT', item: 'Email & system access revoked' },
  { department: 'IT', item: 'Devices returned (laptop, phone, sim)' },
  { department: 'Admin', item: 'ID card & access cards returned' },
  { department: 'Admin', item: 'Office keys returned' },
  { department: 'Accounts', item: 'Outstanding advances cleared' },
  { department: 'Accounts', item: 'Outstanding loans settled / adjusted' },
  { department: 'Accounts', item: 'Final settlement processed' },
  { department: 'Sales', item: 'Customer accounts handed over' },
  { department: 'Warehouse', item: 'Assigned stock / samples returned' },
];

/* ============================ helpers ============================ */

async function nextExitCode(dealerId: string): Promise<string> {
  const row = await db('employee_exits')
    .where('dealer_id', dealerId)
    .count<{ count: string }[]>('id as count')
    .first();
  const n = Number(row?.count ?? 0) + 1;
  return `EXIT-${String(n).padStart(5, '0')}`;
}

async function computeOutstandings(dealerId: string, employeeId: string) {
  const loanRow = await db('employee_loan_emis as e')
    .join('employee_loans as l', 'l.id', 'e.loan_id')
    .where('l.dealer_id', dealerId)
    .where('l.employee_id', employeeId)
    .where('l.status', 'active')
    .whereIn('e.status', ['pending', 'partial', 'overdue'])
    .sum<{ s: string }[]>(db.raw('e.amount_due - COALESCE(e.amount_paid,0) as s'))
    .first();

  const advRow = await db('salary_advances')
    .where('dealer_id', dealerId)
    .where('employee_id', employeeId)
    .where('status', 'open')
    .sum<{ s: string }[]>('amount as s')
    .first();

  return {
    outstanding_loans: Number(loanRow?.s ?? 0) || 0,
    outstanding_advances: Number(advRow?.s ?? 0) || 0,
  };
}

function computeNet(e: any): number {
  const add = Number(e.unpaid_salary || 0) + Number(e.leave_encashment || 0) +
              Number(e.bonus || 0) + Number(e.gratuity || 0) + Number(e.other_additions || 0);
  const ded = Number(e.outstanding_loans || 0) + Number(e.outstanding_advances || 0) + Number(e.other_deductions || 0);
  return Math.round((add - ded) * 100) / 100;
}

/* ============================ summary ============================ */

router.get('/summary', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('employee_exits')
    .where('dealer_id', dealerId)
    .select('status')
    .count<{ status: string; count: string }[]>('id as count')
    .sum<{ status: string; net: string }[]>('net_payable as net')
    .groupBy('status');

  const summary: Record<string, { count: number; net: number }> = {
    initiated: { count: 0, net: 0 },
    clearance: { count: 0, net: 0 },
    settled: { count: 0, net: 0 },
    cancelled: { count: 0, net: 0 },
  };
  rows.forEach((r: any) => {
    summary[r.status] = { count: Number(r.count) || 0, net: Number(r.net) || 0 };
  });
  res.json(summary);
});

/* ============================ list ============================ */

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const { status, employee_id, q } = req.query;

  const query = db('employee_exits as x')
    .leftJoin('employees as e', 'e.id', 'x.employee_id')
    .where('x.dealer_id', dealerId)
    .select(
      'x.*',
      'e.name as employee_name',
      'e.employee_code',
      'e.designation',
      'e.department',
    )
    .orderBy('x.resignation_date', 'desc');

  if (status) query.where('x.status', String(status));
  if (employee_id) query.where('x.employee_id', String(employee_id));
  if (q) {
    const s = `%${String(q).toLowerCase()}%`;
    query.where((b: any) => {
      b.whereRaw('LOWER(x.exit_code) LIKE ?', [s])
        .orWhereRaw('LOWER(e.name) LIKE ?', [s])
        .orWhereRaw('LOWER(e.employee_code) LIKE ?', [s]);
    });
  }

  res.json(await query);
});

/* ============================ detail ============================ */

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const header = await db('employee_exits as x')
    .leftJoin('employees as e', 'e.id', 'x.employee_id')
    .leftJoin('bank_accounts as b', 'b.id', 'x.bank_account_id')
    .where('x.dealer_id', dealerId)
    .where('x.id', req.params.id)
    .select(
      'x.*',
      'e.name as employee_name',
      'e.employee_code',
      'e.designation',
      'e.department',
      'e.joining_date',
      'b.account_name as bank_account_name',
    )
    .first();
  if (!header) return res.status(404).json({ error: 'Exit record not found' });

  const clearances = await db('employee_exit_clearances')
    .where('dealer_id', dealerId)
    .where('exit_id', req.params.id)
    .orderBy(['department', 'created_at']);

  res.json({ ...header, clearances });
});

/* ============================ settlement preview ============================ */

router.get('/:id/settlement-preview', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const ex = await db('employee_exits')
    .where('dealer_id', dealerId)
    .where('id', req.params.id)
    .first();
  if (!ex) return res.status(404).json({ error: 'Exit record not found' });

  const out = await computeOutstandings(dealerId as string, ex.employee_id);
  const merged = { ...ex, ...out };
  res.json({ ...out, suggested_net: computeNet(merged) });
});

/* ============================ create / update / cancel ============================ */

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = exitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  // ensure no active exit already
  const dup = await db('employee_exits')
    .where('dealer_id', dealerId)
    .where('employee_id', parsed.data.employee_id)
    .whereIn('status', ['initiated', 'clearance'])
    .first();
  if (dup) return res.status(409).json({ error: 'An active exit already exists for this employee' });

  const out = await computeOutstandings(dealerId as string, parsed.data.employee_id);
  const exitCode = await nextExitCode(dealerId as string);

  const trx = await db.transaction();
  try {
    const insertData = {
      dealer_id: dealerId,
      employee_id: parsed.data.employee_id,
      exit_code: exitCode,
      exit_type: parsed.data.exit_type ?? 'resignation',
      resignation_date: parsed.data.resignation_date,
      last_working_date: parsed.data.last_working_date,
      notice_period_days: parsed.data.notice_period_days ?? 0,
      reason: parsed.data.reason ?? null,
      status: 'clearance',
      unpaid_salary: parsed.data.unpaid_salary ?? 0,
      leave_encashment: parsed.data.leave_encashment ?? 0,
      bonus: parsed.data.bonus ?? 0,
      gratuity: parsed.data.gratuity ?? 0,
      other_additions: parsed.data.other_additions ?? 0,
      other_deductions: parsed.data.other_deductions ?? 0,
      outstanding_loans: out.outstanding_loans,
      outstanding_advances: out.outstanding_advances,
      rehire_eligible: parsed.data.rehire_eligible ?? true,
      rehire_eligible_notes: parsed.data.rehire_eligible_notes ?? null,
      exit_interview_notes: parsed.data.exit_interview_notes ?? null,
      payment_method: parsed.data.payment_method ?? null,
      bank_account_id: parsed.data.bank_account_id ?? null,
      created_by: req.user!.userId,
      net_payable: 0,
    };
    insertData.net_payable = computeNet(insertData);

    const [row] = await trx('employee_exits').insert(insertData).returning('*');

    // seed clearance checklist
    await trx('employee_exit_clearances').insert(
      DEFAULT_CHECKLIST.map((c) => ({
        dealer_id: dealerId,
        exit_id: row.id,
        department: c.department,
        item: c.item,
        status: 'pending',
      })),
    );

    await trx.commit();
    res.status(201).json(row);
  } catch (err) {
    await trx.rollback();
    throw err;
  }
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const existing = await db('employee_exits').where({ dealer_id: dealerId, id: req.params.id }).first();
  if (!existing) return res.status(404).json({ error: 'Exit record not found' });
  if (existing.status === 'settled') return res.status(409).json({ error: 'Cannot edit a settled exit' });
  if (existing.status === 'cancelled') return res.status(409).json({ error: 'Cannot edit a cancelled exit' });

  const parsed = exitSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const merged = { ...existing, ...parsed.data };
  // recompute outstandings live
  const out = await computeOutstandings(dealerId as string, merged.employee_id);
  merged.outstanding_loans = out.outstanding_loans;
  merged.outstanding_advances = out.outstanding_advances;
  merged.net_payable = computeNet(merged);

  const [row] = await db('employee_exits')
    .where({ dealer_id: dealerId, id: req.params.id })
    .update({
      ...parsed.data,
      outstanding_loans: merged.outstanding_loans,
      outstanding_advances: merged.outstanding_advances,
      net_payable: merged.net_payable,
      updated_at: db.fn.now(),
    })
    .returning('*');
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const existing = await db('employee_exits').where({ dealer_id: dealerId, id: req.params.id }).first();
  if (!existing) return res.status(404).json({ error: 'Exit record not found' });
  if (existing.status === 'settled') return res.status(409).json({ error: 'Cannot cancel a settled exit' });

  await db('employee_exits')
    .where({ dealer_id: dealerId, id: req.params.id })
    .update({ status: 'cancelled', updated_at: db.fn.now() });
  res.json({ ok: true });
});

/* ============================ clearance items ============================ */

const clearanceSchema = z.object({
  department: z.string().min(1).max(40),
  item: z.string().min(1).max(200),
  status: z.enum(['pending', 'done', 'na']).optional(),
  remarks: z.string().nullable().optional(),
});

router.post('/:id/clearance', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = clearanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const ex = await db('employee_exits').where({ dealer_id: dealerId, id: req.params.id }).first();
  if (!ex) return res.status(404).json({ error: 'Exit record not found' });

  const [row] = await db('employee_exit_clearances')
    .insert({
      dealer_id: dealerId,
      exit_id: req.params.id,
      department: parsed.data.department,
      item: parsed.data.item,
      status: parsed.data.status ?? 'pending',
      remarks: parsed.data.remarks ?? null,
    })
    .returning('*');
  res.status(201).json(row);
});

router.put('/clearances/:cid', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = clearanceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const existing = await db('employee_exit_clearances')
    .where({ dealer_id: dealerId, id: req.params.cid })
    .first();
  if (!existing) return res.status(404).json({ error: 'Clearance item not found' });

  const update: any = { ...parsed.data };
  if (parsed.data.status && parsed.data.status !== 'pending') {
    update.cleared_by = req.user!.userId;
    update.cleared_at = db.fn.now();
  } else if (parsed.data.status === 'pending') {
    update.cleared_by = null;
    update.cleared_at = null;
  }

  const [row] = await db('employee_exit_clearances')
    .where({ dealer_id: dealerId, id: req.params.cid })
    .update(update)
    .returning('*');
  res.json(row);
});

router.delete('/clearances/:cid', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  await db('employee_exit_clearances').where({ dealer_id: dealerId, id: req.params.cid }).del();
  res.json({ ok: true });
});

/* ============================ settle ============================ */

router.post('/:id/settle', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const ex = await db('employee_exits').where({ dealer_id: dealerId, id: req.params.id }).first();
  if (!ex) return res.status(404).json({ error: 'Exit record not found' });
  if (ex.status === 'settled') return res.status(409).json({ error: 'Already settled' });
  if (ex.status === 'cancelled') return res.status(409).json({ error: 'Cannot settle a cancelled exit' });

  // gating: all clearance items must be done or na
  const pending = await db('employee_exit_clearances')
    .where({ dealer_id: dealerId, exit_id: req.params.id })
    .where('status', 'pending')
    .count<{ c: string }[]>('id as c')
    .first();
  if (Number(pending?.c ?? 0) > 0) {
    return res.status(409).json({ error: 'All clearance items must be marked Done or N/A before settlement' });
  }

  const settled_date = (req.body?.settled_date as string) || new Date().toISOString().slice(0, 10);
  const payment_method = (req.body?.payment_method as string) || ex.payment_method || 'cash';
  const bank_account_id = req.body?.bank_account_id ?? ex.bank_account_id ?? null;

  const trx = await db.transaction();
  try {
    const [row] = await trx('employee_exits')
      .where({ dealer_id: dealerId, id: req.params.id })
      .update({
        status: 'settled',
        settled_date,
        payment_method,
        bank_account_id,
        updated_at: trx.fn.now(),
      })
      .returning('*');

    // Mark employee inactive / terminated
    const empStatus = ex.exit_type === 'termination' ? 'terminated' : 'inactive';
    await trx('employees')
      .where({ dealer_id: dealerId, id: ex.employee_id })
      .update({ status: empStatus, updated_at: trx.fn.now() });

    await trx.commit();
    res.json(row);
  } catch (err) {
    await trx.rollback();
    throw err;
  }
});

export default router;
