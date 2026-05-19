/**
 * Phase 9 — Employee Leave Management.
 *
 *   GET    /api/leaves/types
 *   POST   /api/leaves/types
 *   PUT    /api/leaves/types/:id
 *   DELETE /api/leaves/types/:id
 *
 *   GET    /api/leaves/balances?employeeId=&year=
 *   POST   /api/leaves/balances           upsert allocation
 *
 *   GET    /api/leaves/requests?status=&employeeId=&from=&to=
 *   POST   /api/leaves/requests
 *   POST   /api/leaves/requests/:id/decide    body: { decision: approved|rejected, note }
 *   POST   /api/leaves/requests/:id/cancel
 *
 * dealer_admin manages types/balances and decides requests.
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
    res.status(403).json({ error: 'Only dealer_admin can manage leaves' });
    return false;
  }
  return true;
}

function diffDaysInclusive(from: string, to: string): number {
  const f = new Date(from + 'T00:00:00Z').getTime();
  const t = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((t - f) / 86400000) + 1);
}

// ── Leave types ──────────────────────────────────────────────────────────
const LeaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(100),
  annual_quota: z.coerce.number().int().min(0).default(0),
  is_paid: z.coerce.boolean().default(true),
  color: z.string().max(16).optional().nullable(),
  is_active: z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().optional(),
});

router.get('/types', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('leave_types').where({ dealer_id: dealerId }).orderBy([{ column: 'sort_order' }, { column: 'name' }]);
  res.json(rows);
});

router.post('/types', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = LeaveTypeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db('leave_types').insert({ dealer_id: dealerId, ...parsed.data }).returning('*');
  res.status(201).json(row);
});

router.put('/types/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = LeaveTypeSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const [row] = await db('leave_types').where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() }).returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/types/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('leave_types').where({ id: req.params.id, dealer_id: dealerId }).del();
  res.json({ success: true });
});

// ── Balances ─────────────────────────────────────────────────────────────
router.get('/balances', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const year = Number(req.query.year ?? new Date().getFullYear());
  const employeeId = req.query.employeeId as string | undefined;
  const q = db('leave_balances as lb')
    .leftJoin('leave_types as lt', 'lt.id', 'lb.leave_type_id')
    .leftJoin('employees as e', 'e.id', 'lb.employee_id')
    .where({ 'lb.dealer_id': dealerId, 'lb.year': year })
    .select(
      'lb.*',
      'lt.name as leave_type_name',
      'lt.code as leave_type_code',
      'lt.color as leave_type_color',
      'e.name as employee_name',
      'e.employee_code',
    );
  if (employeeId) q.where('lb.employee_id', employeeId);
  res.json(await q);
});

const BalanceSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  year: z.coerce.number().int(),
  allocated: z.coerce.number().min(0),
});

router.post('/balances', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = BalanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { employee_id, leave_type_id, year, allocated } = parsed.data;
  const existing = await db('leave_balances')
    .where({ dealer_id: dealerId, employee_id, leave_type_id, year }).first();
  if (existing) {
    const [row] = await db('leave_balances').where({ id: existing.id })
      .update({ allocated, updated_at: db.fn.now() }).returning('*');
    return res.json(row);
  }
  const [row] = await db('leave_balances')
    .insert({ dealer_id: dealerId, employee_id, leave_type_id, year, allocated, used: 0 })
    .returning('*');
  res.status(201).json(row);
});

// ── Requests ─────────────────────────────────────────────────────────────
router.get('/requests', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const { status, employeeId, from, to } = req.query as Record<string, string>;
  const q = db('leave_requests as r')
    .leftJoin('employees as e', 'e.id', 'r.employee_id')
    .leftJoin('leave_types as lt', 'lt.id', 'r.leave_type_id')
    .where('r.dealer_id', dealerId)
    .select(
      'r.*',
      'e.name as employee_name',
      'e.employee_code',
      'lt.name as leave_type_name',
      'lt.code as leave_type_code',
      'lt.color as leave_type_color',
    )
    .orderBy('r.created_at', 'desc');
  if (status) q.where('r.status', status);
  if (employeeId) q.where('r.employee_id', employeeId);
  if (from) q.where('r.start_date', '>=', from);
  if (to) q.where('r.end_date', '<=', to);
  res.json(await q);
});

const RequestSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(1000).optional().nullable(),
});

router.post('/requests', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { employee_id, leave_type_id, start_date, end_date, reason } = parsed.data;
  if (end_date < start_date) return res.status(400).json({ error: 'end_date before start_date' });
  const days = diffDaysInclusive(start_date, end_date);
  const [row] = await db('leave_requests').insert({
    dealer_id: dealerId,
    employee_id, leave_type_id, start_date, end_date, days,
    reason: reason ?? null,
    status: 'pending',
    created_by: req.user?.userId ?? null,
  }).returning('*');
  res.status(201).json(row);
});

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional().nullable(),
});

router.post('/requests/:id/decide', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = DecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { decision, note } = parsed.data;

  const result = await db.transaction(async (trx) => {
    const lr = await trx('leave_requests').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!lr) throw Object.assign(new Error('Not found'), { status: 404 });
    if (lr.status !== 'pending') throw Object.assign(new Error('Already decided'), { status: 400 });

    if (decision === 'approved') {
      const year = Number(String(lr.start_date).slice(0, 4));
      const days = Number(lr.days);
      let bal = await trx('leave_balances')
        .where({ dealer_id: dealerId, employee_id: lr.employee_id, leave_type_id: lr.leave_type_id, year }).first();
      if (!bal) {
        const lt = await trx('leave_types').where({ id: lr.leave_type_id, dealer_id: dealerId }).first();
        const [created] = await trx('leave_balances').insert({
          dealer_id: dealerId, employee_id: lr.employee_id, leave_type_id: lr.leave_type_id,
          year, allocated: lt?.annual_quota ?? 0, used: 0,
        }).returning('*');
        bal = created;
      }
      const remaining = Number(bal.allocated) - Number(bal.used);
      if (days > remaining) throw Object.assign(new Error(`Insufficient balance (${remaining} remaining)`), { status: 400 });
      await trx('leave_balances').where({ id: bal.id })
        .update({ used: Number(bal.used) + days, updated_at: trx.fn.now() });
    }

    const [updated] = await trx('leave_requests').where({ id: lr.id }).update({
      status: decision,
      decided_by: req.user?.userId ?? null,
      decided_at: trx.fn.now(),
      decision_note: note ?? null,
      updated_at: trx.fn.now(),
    }).returning('*');
    return updated;
  }).catch((err) => {
    res.status(err.status ?? 500).json({ error: err.message });
    return null;
  });
  if (result) res.json(result);
});

router.post('/requests/:id/cancel', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const result = await db.transaction(async (trx) => {
    const lr = await trx('leave_requests').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!lr) throw Object.assign(new Error('Not found'), { status: 404 });
    if (lr.status === 'cancelled') return lr;
    if (lr.status === 'approved') {
      const year = Number(String(lr.start_date).slice(0, 4));
      await trx('leave_balances')
        .where({ dealer_id: dealerId, employee_id: lr.employee_id, leave_type_id: lr.leave_type_id, year })
        .decrement('used', Number(lr.days));
    }
    const [updated] = await trx('leave_requests').where({ id: lr.id })
      .update({ status: 'cancelled', updated_at: trx.fn.now() }).returning('*');
    return updated;
  }).catch((err) => {
    res.status(err.status ?? 500).json({ error: err.message });
    return null;
  });
  if (result) res.json(result);
});

export default router;
