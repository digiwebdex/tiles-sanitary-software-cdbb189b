/**
 * HRM — employees, salary structures, monthly salary payments.
 *
 *   GET    /api/employees                        list
 *   POST   /api/employees                        create
 *   PUT    /api/employees/:id                    update
 *   DELETE /api/employees/:id                    soft delete (status=inactive)
 *   GET    /api/employees/:id/structure          current effective structure
 *   POST   /api/employees/:id/structure          add new structure (effective)
 *   GET    /api/employees/salary-payments?period=YYYY-MM
 *   POST   /api/employees/:id/salary-payments    disburse → cash/bank ledger
 *
 * dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealer_id as string | undefined);
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
    res.status(403).json({ error: 'Only dealer_admin can manage HRM' });
    return false;
  }
  return true;
}

const EmployeeSchema = z.object({
  employee_code: z.string().max(30).optional().nullable(),
  name: z.string().min(1).max(120),
  designation: z.string().max(80).optional().nullable(),
  department: z.string().max(80).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().max(120).optional().nullable(),
  nid: z.string().max(30).optional().nullable(),
  address: z.string().optional().nullable(),
  joining_date: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive', 'terminated']).default('active'),
  notes: z.string().optional().nullable(),
  shift_id: z.string().uuid().nullable().optional(),
});

const StructureSchema = z.object({
  basic: z.coerce.number().min(0).default(0),
  house_rent_pct: z.coerce.number().min(0).max(100).default(0),
  medical_pct: z.coerce.number().min(0).max(100).default(0),
  transport_pct: z.coerce.number().min(0).max(100).default(0),
  other_allowance: z.coerce.number().min(0).default(0),
  deduction: z.coerce.number().min(0).default(0),
  effective_from: z.string().optional(),
});

const PaymentSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  payment_method: z.enum(['cash', 'bank']).default('cash'),
  bank_account_id: z.string().uuid().optional().nullable(),
  payment_date: z.string().optional(),
  notes: z.string().optional().nullable(),
  // Optional snapshot overrides; if missing we derive from current structure
  basic: z.coerce.number().optional(),
  house_rent: z.coerce.number().optional(),
  medical: z.coerce.number().optional(),
  transport: z.coerce.number().optional(),
  other_allowance: z.coerce.number().optional(),
  deduction: z.coerce.number().optional(),
  // Phase 11: auto-apply assigned salary_components on top of structure breakdown
  apply_components: z.coerce.boolean().optional().default(true),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('employees').where({ dealer_id: dealerId }).orderBy([{ column: 'status' }, { column: 'name' }]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = EmployeeSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('employees').insert({ dealer_id: dealerId, ...p.data }).returning('*');
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = EmployeeSchema.partial().safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('employees')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...p.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('employees').where({ id: req.params.id, dealer_id: dealerId })
    .update({ status: 'inactive', updated_at: db.fn.now() });
  res.status(204).end();
});

router.get('/:id/structure', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const row = await db('salary_structures')
    .where({ dealer_id: dealerId, employee_id: req.params.id })
    .orderBy('effective_from', 'desc').first();
  res.json(row || null);
});

router.post('/:id/structure', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = StructureSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('salary_structures').insert({
    dealer_id: dealerId, employee_id: req.params.id, ...p.data,
  }).returning('*');
  res.status(201).json(row);
});

router.get('/salary-payments', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const period = req.query.period as string | undefined;
  const q = db('salary_payments as sp')
    .leftJoin('employees as e', 'e.id', 'sp.employee_id')
    .where('sp.dealer_id', dealerId)
    .select('sp.*', 'e.name as employee_name', 'e.designation')
    .orderBy('sp.payment_date', 'desc');
  if (period) q.where('sp.period', period);
  const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 5000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await q.limit(limit).offset(offset);
  res.json(rows);
});

router.get('/salary-payments/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const row = await db('salary_payments as sp')
    .leftJoin('employees as e', 'e.id', 'sp.employee_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'sp.bank_account_id')
    .where('sp.dealer_id', dealerId)
    .andWhere('sp.id', req.params.id)
    .select(
      'sp.*',
      'e.name as employee_name',
      'e.employee_code',
      'e.designation',
      'e.department',
      'e.phone as employee_phone',
      'ba.account_name as bank_account_name',
      'ba.bank_name'
    )
    .first();
  if (!row) { res.status(404).json({ error: 'Payment not found' }); return; }
  res.json(row);
});

router.post('/:id/salary-payments', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = PaymentSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  const employeeId = req.params.id;
  const struct = await db('salary_structures')
    .where({ dealer_id: dealerId, employee_id: employeeId })
    .orderBy('effective_from', 'desc').first();

  const basic = p.data.basic ?? Number(struct?.basic ?? 0);
  const house_rent = p.data.house_rent ?? (basic * Number(struct?.house_rent_pct ?? 0) / 100);
  const medical = p.data.medical ?? (basic * Number(struct?.medical_pct ?? 0) / 100);
  const transport = p.data.transport ?? (basic * Number(struct?.transport_pct ?? 0) / 100);
  const other_allowance = p.data.other_allowance ?? Number(struct?.other_allowance ?? 0);
  const baseDeduction = p.data.deduction ?? Number(struct?.deduction ?? 0);

  // Pull all open advances for this employee and add to deduction
  const openAdvances = await db('salary_advances')
    .where({ dealer_id: dealerId, employee_id: employeeId, status: 'open' });
  const advanceDue = openAdvances.reduce((s, a) => s + (Number(a.amount) - Number(a.settled_amount)), 0);

  // Phase 11: pull assigned salary components and compute allowance/deduction totals
  let componentsAllowance = 0;
  let componentsDeduction = 0;
  const componentsSnapshot: Array<{ component_id: string; code: string; name: string; kind: string; amount: number }> = [];
  if (p.data.apply_components) {
    const assigned = await db('employee_salary_components as esc')
      .join('salary_components as sc', 'sc.id', 'esc.component_id')
      .where('esc.dealer_id', dealerId)
      .andWhere('esc.employee_id', employeeId)
      .andWhere('esc.active', true)
      .andWhere('sc.active', true)
      .select('sc.id', 'sc.code', 'sc.name', 'sc.kind', 'sc.calc',
              'sc.default_amount', 'sc.default_percent',
              'esc.amount_override', 'esc.percent_override');
    for (const c of assigned) {
      let amt = 0;
      if (c.calc === 'fixed') {
        amt = Number(c.amount_override ?? c.default_amount ?? 0);
      } else {
        const pct = Number(c.percent_override ?? c.default_percent ?? 0);
        amt = +(basic * pct / 100).toFixed(2);
      }
      if (!amt) continue;
      componentsSnapshot.push({ component_id: c.id, code: c.code, name: c.name, kind: c.kind, amount: amt });
      if (c.kind === 'allowance') componentsAllowance += amt;
      else componentsDeduction += amt;
    }
    componentsAllowance = +componentsAllowance.toFixed(2);
    componentsDeduction = +componentsDeduction.toFixed(2);
  }

  const deduction = +(baseDeduction + advanceDue + componentsDeduction).toFixed(2);
  const net_payable = +(basic + house_rent + medical + transport + other_allowance + componentsAllowance - deduction).toFixed(2);

  if (net_payable <= 0) { res.status(400).json({ error: 'Net payable must be positive (deductions exceed gross)' }); return; }

  const trx = await db.transaction();
  try {
    const [row] = await trx('salary_payments').insert({
      dealer_id: dealerId, employee_id: employeeId,
      period: p.data.period,
      basic, house_rent, medical, transport, other_allowance, deduction, net_payable,
      components_allowance: componentsAllowance,
      components_deduction: componentsDeduction,
      components_snapshot: componentsSnapshot.length ? JSON.stringify(componentsSnapshot) : null,
      payment_method: p.data.payment_method,
      bank_account_id: p.data.payment_method === 'bank' ? (p.data.bank_account_id ?? null) : null,
      payment_date: p.data.payment_date ?? trx.fn.now(),
      notes: p.data.notes ?? null,
      created_by: req.user?.userId ?? null,
    }).returning('*');

    const emp = await trx('employees').where({ id: employeeId }).first();
    const desc = `Salary ${p.data.period} — ${emp?.name ?? 'Employee'}`;

    if (p.data.payment_method === 'bank') {
      if (!p.data.bank_account_id) throw new Error('bank_account_id required for bank payment');
      await trx('bank_ledger').insert({
        dealer_id: dealerId, bank_account_id: p.data.bank_account_id,
        type: 'salary', amount: -net_payable, description: desc,
        reference_type: 'salary_payment', reference_id: row.id,
        entry_date: row.payment_date, created_by: req.user?.userId ?? null,
      });
    } else {
      await trx('cash_ledger').insert({
        dealer_id: dealerId, type: 'salary', amount: -net_payable, description: desc,
        reference_type: 'salary_payment', reference_id: row.id,
        entry_date: row.payment_date, created_by: req.user?.userId ?? null,
      });
    }

    // Settle outstanding advances
    if (advanceDue > 0) {
      for (const adv of openAdvances) {
        await trx('salary_advances').where({ id: adv.id })
          .update({ settled_amount: adv.amount, status: 'settled' });
      }
    }
    await trx.commit();
    res.status(201).json(row);
  } catch (e: any) {
    await trx.rollback();
    if (String(e.message).includes('duplicate key')) {
      res.status(409).json({ error: 'Salary already paid for this period' });
      return;
    }
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────── Attendance ───────────────────────────
const AttendanceSchema = z.object({
  employee_id: z.string().uuid(),
  att_date: z.string(),
  status: z.enum(['present', 'absent', 'leave', 'half', 'late']),
  check_in: z.string().max(8).optional().nullable(),
  check_out: z.string().max(8).optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get('/attendance', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const { from, to, employee_id } = req.query as Record<string, string | undefined>;
  const q = db('employee_attendance as a')
    .leftJoin('employees as e', 'e.id', 'a.employee_id')
    .where('a.dealer_id', dealerId)
    .select('a.*', 'e.name as employee_name', 'e.designation')
    .orderBy([{ column: 'a.att_date', order: 'desc' }, { column: 'e.name' }]);
  if (from) q.where('a.att_date', '>=', from);
  if (to) q.where('a.att_date', '<=', to);
  if (employee_id) q.where('a.employee_id', employee_id);
  // Safety cap: attendance grows unbounded (employees × days). Honour optional
  // ?limit/?offset and never return more than 5000 rows in one response.
  const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 5000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(await q.limit(limit).offset(offset));
});

router.post('/attendance', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = AttendanceSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const [row] = await db('employee_attendance')
    .insert({ dealer_id: dealerId, ...p.data, created_by: req.user?.userId ?? null })
    .onConflict(['dealer_id', 'employee_id', 'att_date'])
    .merge({ status: p.data.status, check_in: p.data.check_in ?? null, check_out: p.data.check_out ?? null, notes: p.data.notes ?? null })
    .returning('*');
  res.status(201).json(row);
});

router.post('/attendance/bulk', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const Body = z.object({ att_date: z.string(), entries: z.array(AttendanceSchema.omit({ att_date: true })) });
  const p = Body.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const trx = await db.transaction();
  try {
    for (const e of p.data.entries) {
      await trx('employee_attendance')
        .insert({ dealer_id: dealerId, att_date: p.data.att_date, ...e, created_by: req.user?.userId ?? null })
        .onConflict(['dealer_id', 'employee_id', 'att_date'])
        .merge({ status: e.status, check_in: e.check_in ?? null, check_out: e.check_out ?? null, notes: e.notes ?? null });
    }
    await trx.commit();
    res.status(201).json({ saved: p.data.entries.length });
  } catch (err: any) { await trx.rollback(); res.status(500).json({ error: err.message }); }
});

router.delete('/attendance/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('employee_attendance').where({ id: req.params.id, dealer_id: dealerId }).delete();
  res.status(204).end();
});

router.get('/attendance/summary', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const period = (req.query.period as string) || new Date().toISOString().slice(0, 7);
  const rows = await db('employee_attendance as a')
    .leftJoin('employees as e', 'e.id', 'a.employee_id')
    .where('a.dealer_id', dealerId)
    .whereRaw(`to_char(a.att_date, 'YYYY-MM') = ?`, [period])
    .groupBy('a.employee_id', 'e.name', 'e.designation')
    .select(
      'a.employee_id',
      'e.name as employee_name',
      'e.designation',
      db.raw(`count(*) filter (where a.status='present') as present`),
      db.raw(`count(*) filter (where a.status='absent') as absent`),
      db.raw(`count(*) filter (where a.status='leave') as leave`),
      db.raw(`count(*) filter (where a.status='half') as half`),
      db.raw(`count(*) filter (where a.status='late') as late`),
      db.raw(`count(*) as total_days`),
    );
  res.json(rows);
});

// ─────────────────────────── Salary Advances ──────────────────────
const AdvanceSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z.enum(['cash', 'bank']).default('cash'),
  bank_account_id: z.string().uuid().optional().nullable(),
  issue_date: z.string().optional(),
  notes: z.string().optional().nullable(),
});

router.get('/advances', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const { employee_id, status } = req.query as Record<string, string | undefined>;
  const q = db('salary_advances as a')
    .leftJoin('employees as e', 'e.id', 'a.employee_id')
    .where('a.dealer_id', dealerId)
    .select('a.*', 'e.name as employee_name', 'e.designation')
    .orderBy('a.issue_date', 'desc');
  if (employee_id) q.where('a.employee_id', employee_id);
  if (status) q.where('a.status', status);
  const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 5000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  res.json(await q.limit(limit).offset(offset));
});

router.post('/:id/advances', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = AdvanceSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const employeeId = req.params.id;
  const trx = await db.transaction();
  try {
    const [row] = await trx('salary_advances').insert({
      dealer_id: dealerId, employee_id: employeeId,
      amount: p.data.amount,
      payment_method: p.data.payment_method,
      bank_account_id: p.data.payment_method === 'bank' ? (p.data.bank_account_id ?? null) : null,
      issue_date: p.data.issue_date ?? trx.fn.now(),
      notes: p.data.notes ?? null,
      created_by: req.user?.userId ?? null,
    }).returning('*');

    const emp = await trx('employees').where({ id: employeeId }).first();
    const desc = `Salary advance — ${emp?.name ?? 'Employee'}`;
    if (p.data.payment_method === 'bank') {
      if (!p.data.bank_account_id) throw new Error('bank_account_id required for bank payment');
      await trx('bank_ledger').insert({
        dealer_id: dealerId, bank_account_id: p.data.bank_account_id,
        type: 'advance', amount: -Number(p.data.amount), description: desc,
        reference_type: 'salary_advance', reference_id: row.id,
        entry_date: row.issue_date, created_by: req.user?.userId ?? null,
      });
    } else {
      await trx('cash_ledger').insert({
        dealer_id: dealerId, type: 'advance', amount: -Number(p.data.amount), description: desc,
        reference_type: 'salary_advance', reference_id: row.id,
        entry_date: row.issue_date, created_by: req.user?.userId ?? null,
      });
    }
    await trx.commit();
    res.status(201).json(row);
  } catch (e: any) { await trx.rollback(); res.status(500).json({ error: e.message }); }
});

router.delete('/advances/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('salary_advances').where({ id: req.params.id, dealer_id: dealerId, status: 'open' })
    .update({ status: 'cancelled' });
  res.status(204).end();
});

export default router;
