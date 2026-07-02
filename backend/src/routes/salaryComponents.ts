/**
 * Salary Structure routes — Phase 10.
 *
 *   GET    /api/salary-components?dealerId=&active=
 *   POST   /api/salary-components                       body: { dealerId, data }
 *   PATCH  /api/salary-components/:id                   body: { dealerId, data }
 *   DELETE /api/salary-components/:id?dealerId=
 *
 *   GET    /api/salary-components/employee/:employeeId?dealerId=
 *   POST   /api/salary-components/employee/:employeeId  body: { dealerId, component_id, amount_override?, percent_override? }
 *   PATCH  /api/salary-components/employee-assign/:id   body: { dealerId, data }
 *   DELETE /api/salary-components/employee-assign/:id?dealerId=
 *
 *   GET    /api/salary-components/preview/:employeeId?dealerId=&basic=  → breakdown calc
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();

// Payroll structure changes drive net-salary computation — restrict all
// writes to admin/manager. Previously these were tenant-scoped only, letting
// any authenticated user (e.g. a salesman) alter salary components.
const requirePayrollAdmin = requireRole('dealer_admin', 'manager');

const COMPONENT_WRITABLE = new Set([
  'code', 'name', 'kind', 'calc', 'default_amount', 'default_percent', 'is_taxable', 'active', 'notes',
]);

const componentSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['allowance', 'deduction']).optional(),
  calc: z.enum(['fixed', 'percent_basic']).optional(),
  default_amount: z.coerce.number().min(0).optional(),
  default_percent: z.coerce.number().min(0).max(100).optional(),
  is_taxable: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const assignSchema = z.object({
  component_id: z.string().uuid().optional(),
  amount_override: z.coerce.number().min(0).nullable().optional(),
  percent_override: z.coerce.number().min(0).max(100).nullable().optional(),
  active: z.coerce.boolean().optional(),
});

function resolveDealerScope(req: Request, res: Response): string | null {
  const isSuperAdmin = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuperAdmin) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

router.use(authenticate, tenantGuard);

// ───────────────────────── Components Library ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    let q = db('salary_components').where({ dealer_id: dealerId });
    if (req.query.active === 'true') q = q.andWhere({ active: true });
    const rows = await q.select('*').orderBy([{ column: 'kind' }, { column: 'name' }]);
    res.json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('[salary-components/list]', err.message);
    res.status(500).json({ error: 'Failed to list salary components' });
  }
});

router.post('/', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = componentSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    if (!parsed.data.code || !parsed.data.name || !parsed.data.kind) {
      res.status(400).json({ error: 'code, name and kind are required' });
      return;
    }
    const payload: Record<string, unknown> = { dealer_id: dealerId, created_by: req.user?.userId ?? null };
    for (const k of Object.keys(parsed.data)) {
      if (COMPONENT_WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    const [row] = await db('salary_components').insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Component code already exists' }); return; }
    console.error('[salary-components/create]', err.message);
    res.status(500).json({ error: 'Failed to create component' });
  }
});

router.patch('/:id', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = componentSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(parsed.data)) {
      if (COMPONENT_WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    if (Object.keys(payload).length === 0) { res.status(400).json({ error: 'No editable fields' }); return; }
    payload.updated_at = db.fn.now();
    const [row] = await db('salary_components')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update(payload).returning('*');
    if (!row) { res.status(404).json({ error: 'Component not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[salary-components/update]', err.message);
    res.status(500).json({ error: 'Failed to update component' });
  }
});

router.delete('/:id', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('salary_components').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Component not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[salary-components/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete component' });
  }
});

// ───────────────────────── Employee Assignments ─────────────────────────
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db('employee_salary_components as esc')
      .join('salary_components as sc', 'sc.id', 'esc.component_id')
      .where({ 'esc.dealer_id': dealerId, 'esc.employee_id': req.params.employeeId })
      .select(
        'esc.id', 'esc.employee_id', 'esc.component_id',
        'esc.amount_override', 'esc.percent_override', 'esc.active',
        'sc.code as component_code', 'sc.name as component_name',
        'sc.kind', 'sc.calc', 'sc.default_amount', 'sc.default_percent', 'sc.is_taxable',
      )
      .orderBy(['sc.kind', 'sc.name']);
    res.json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('[salary-components/employee/list]', err.message);
    res.status(500).json({ error: 'Failed to list assignments' });
  }
});

router.post('/employee/:employeeId', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    if (!parsed.data.component_id) { res.status(400).json({ error: 'component_id is required' }); return; }
    const comp = await db('salary_components')
      .where({ id: parsed.data.component_id, dealer_id: dealerId }).first();
    if (!comp) { res.status(404).json({ error: 'Component not found in this dealer' }); return; }
    const emp = await db('employees').where({ id: req.params.employeeId, dealer_id: dealerId }).first();
    if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

    const [row] = await db('employee_salary_components').insert({
      dealer_id: dealerId,
      employee_id: req.params.employeeId,
      component_id: parsed.data.component_id,
      amount_override: parsed.data.amount_override ?? null,
      percent_override: parsed.data.percent_override ?? null,
      active: parsed.data.active ?? true,
    }).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err.code === '23505') { res.status(409).json({ error: 'Component already assigned to employee' }); return; }
    console.error('[salary-components/employee/create]', err.message);
    res.status(500).json({ error: 'Failed to assign component' });
  }
});

router.patch('/employee-assign/:id', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = assignSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    const payload: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.amount_override !== undefined) payload.amount_override = parsed.data.amount_override;
    if (parsed.data.percent_override !== undefined) payload.percent_override = parsed.data.percent_override;
    if (parsed.data.active !== undefined) payload.active = parsed.data.active;
    const [row] = await db('employee_salary_components')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update(payload).returning('*');
    if (!row) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[salary-components/employee/update]', err.message);
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

router.delete('/employee-assign/:id', requirePayrollAdmin, async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('employee_salary_components')
      .where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[salary-components/employee/delete]', err.message);
    res.status(500).json({ error: 'Failed to remove assignment' });
  }
});

// ───────────────────────── Preview / Breakdown ─────────────────────────
router.get('/preview/:employeeId', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const basic = Number(req.query.basic ?? 0) || 0;
    const rows = await db('employee_salary_components as esc')
      .join('salary_components as sc', 'sc.id', 'esc.component_id')
      .where({
        'esc.dealer_id': dealerId,
        'esc.employee_id': req.params.employeeId,
        'esc.active': true,
        'sc.active': true,
      })
      .select(
        'sc.code', 'sc.name', 'sc.kind', 'sc.calc',
        'sc.default_amount', 'sc.default_percent',
        'esc.amount_override', 'esc.percent_override',
      )
      .orderBy(['sc.kind', 'sc.name']);

    let allowances = 0;
    let deductions = 0;
    const lines = rows.map((r: any) => {
      const amt = r.amount_override !== null ? Number(r.amount_override) : Number(r.default_amount);
      const pct = r.percent_override !== null ? Number(r.percent_override) : Number(r.default_percent);
      const value = r.calc === 'percent_basic' ? +(basic * pct / 100).toFixed(2) : +amt.toFixed(2);
      if (r.kind === 'allowance') allowances += value; else deductions += value;
      return { code: r.code, name: r.name, kind: r.kind, calc: r.calc, value };
    });
    res.json({
      basic,
      allowances: +allowances.toFixed(2),
      deductions: +deductions.toFixed(2),
      gross: +(basic + allowances).toFixed(2),
      net: +(basic + allowances - deductions).toFixed(2),
      lines,
    });
  } catch (err: any) {
    console.error('[salary-components/preview]', err.message);
    res.status(500).json({ error: 'Failed to compute preview' });
  }
});

export default router;
