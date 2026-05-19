/**
 * EMI Plans + Schedule
 *
 *   GET    /api/emi                            list plans w/ progress
 *   GET    /api/emi/overdue                    list overdue installments (alerts)
 *   GET    /api/emi/:id                        plan + schedule
 *   POST   /api/emi                            create plan (auto-generates schedule)
 *   POST   /api/emi/:id/installments/:iid/pay  mark installment paid
 *   DELETE /api/emi/:id                        cancel plan
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
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
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
    res.status(403).json({ error: 'Only dealer_admin can manage EMI plans' });
    return false;
  }
  return true;
}

async function nextPlanNo(dealerId: string, startDate: string): Promise<string> {
  const ym = startDate.slice(0, 7).replace('-', '');
  const prefix = `EMI-${ym}-`;
  const row = await db('emi_plans')
    .where({ dealer_id: dealerId })
    .andWhere('plan_no', 'like', `${prefix}%`)
    .max({ max: 'plan_no' })
    .first();
  const last = (row?.max as string | undefined) ?? null;
  const lastNum = last ? parseInt(last.slice(prefix.length), 10) : 0;
  const next = String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(4, '0');
  return `${prefix}${next}`;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

const createSchema = z.object({
  customer_id: z.string().uuid(),
  sale_id: z.string().uuid().nullable().optional(),
  principal: z.coerce.number().positive(),
  tenure_months: z.coerce.number().int().min(1).max(120),
  start_date: z.string().min(1),
  narration: z.string().optional().nullable(),
});

// ── LIST PLANS ──
router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const offset = parseInt((req.query.offset as string) || '0', 10);
  const status = req.query.status as string | undefined;

  const baseQ = db('emi_plans as p').where('p.dealer_id', dealerId);
  if (status) baseQ.where('p.status', status);

  const totalRow = await baseQ.clone().count<{ count: string }[]>({ count: '*' }).first();
  const total = parseInt(totalRow?.count ?? '0', 10);

  const rows = await baseQ.clone()
    .leftJoin('emi_schedule as s', 's.plan_id', 'p.id')
    .leftJoin('customers as c', 'c.id', 'p.customer_id')
    .groupBy('p.id', 'c.name')
    .select(
      'p.id', 'p.plan_no', 'p.customer_id', 'p.sale_id',
      'p.principal', 'p.tenure_months', 'p.installment_amount',
      'p.start_date', 'p.status', 'p.created_at',
      db.raw('c.name as customer_name'),
    )
    .sum({ paid_total: 's.paid_amount' })
    .sum({ scheduled_total: 's.amount' })
    .count({ paid_count: db.raw("CASE WHEN s.status = 'paid' THEN 1 END") })
    .orderBy('p.created_at', 'desc')
    .limit(limit).offset(offset);

  res.json({ rows, total });
});

// ── OVERDUE INSTALLMENTS ──
router.get('/overdue', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db('emi_schedule as s')
    .innerJoin('emi_plans as p', 'p.id', 's.plan_id')
    .leftJoin('customers as c', 'c.id', 'p.customer_id')
    .where('s.dealer_id', dealerId)
    .where('p.status', 'active')
    .whereIn('s.status', ['pending', 'partial', 'overdue'])
    .where('s.due_date', '<', today)
    .select(
      's.id', 's.plan_id', 's.installment_no', 's.due_date',
      's.amount', 's.paid_amount', 's.status',
      'p.plan_no', 'p.customer_id',
      db.raw('c.name as customer_name'),
      db.raw('c.phone as customer_phone'),
      db.raw("(CURRENT_DATE - s.due_date) as days_overdue"),
    )
    .orderBy('s.due_date', 'asc');

  res.json({ rows });
});

// ── GET ONE ──
router.get('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const header = await db('emi_plans as p')
    .leftJoin('customers as c', 'c.id', 'p.customer_id')
    .where({ 'p.id': req.params.id, 'p.dealer_id': dealerId })
    .select('p.*', db.raw('c.name as customer_name'), db.raw('c.phone as customer_phone'))
    .first();
  if (!header) return res.status(404).json({ error: 'Not found' });
  const schedule = await db('emi_schedule')
    .where({ plan_id: header.id })
    .orderBy('installment_no', 'asc')
    .select('*');
  res.json({ ...header, schedule });
});

// ── CREATE ──
router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  const { customer_id, sale_id, principal, tenure_months, start_date, narration } = parsed.data;

  const installment_amount = Math.round((principal / tenure_months) * 100) / 100;
  const plan_no = await nextPlanNo(dealerId, start_date);

  try {
    const result = await db.transaction(async (trx) => {
      const [hdr] = await trx('emi_plans')
        .insert({
          dealer_id: dealerId,
          plan_no,
          customer_id,
          sale_id: sale_id ?? null,
          principal,
          tenure_months,
          installment_amount,
          start_date,
          narration: narration ?? null,
          created_by: req.user?.userId ?? null,
        })
        .returning(['id', 'plan_no']);

      // Generate schedule. Last installment absorbs rounding remainder.
      const rows: any[] = [];
      let runningSum = 0;
      for (let i = 1; i <= tenure_months; i++) {
        const amt = i === tenure_months
          ? Math.round((principal - runningSum) * 100) / 100
          : installment_amount;
        runningSum += amt;
        rows.push({
          plan_id: hdr.id,
          dealer_id: dealerId,
          installment_no: i,
          due_date: addMonths(start_date, i - 1),
          amount: amt,
        });
      }
      await trx('emi_schedule').insert(rows);
      return hdr;
    });
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Plan number already exists' });
    console.error('emi create failed', e);
    res.status(500).json({ error: 'Failed to create EMI plan' });
  }
});

// ── MARK PAID ──
const paySchema = z.object({
  paid_amount: z.coerce.number().positive(),
  paid_date: z.string().min(1),
});
router.post('/:id/installments/:iid/pay', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  const { paid_amount, paid_date } = parsed.data;

  const inst = await db('emi_schedule')
    .where({ id: req.params.iid, plan_id: req.params.id, dealer_id: dealerId })
    .first();
  if (!inst) return res.status(404).json({ error: 'Installment not found' });

  const newPaid = Number(inst.paid_amount) + paid_amount;
  const status = newPaid + 0.01 >= Number(inst.amount) ? 'paid' : 'partial';

  await db.transaction(async (trx) => {
    await trx('emi_schedule')
      .where({ id: inst.id })
      .update({ paid_amount: newPaid, paid_date, status });

    // If all paid, close the plan.
    const remaining = await trx('emi_schedule')
      .where({ plan_id: req.params.id })
      .whereNot('status', 'paid')
      .count<{ count: string }[]>({ count: '*' }).first();
    if (parseInt(remaining?.count ?? '0', 10) === 0) {
      await trx('emi_plans').where({ id: req.params.id }).update({ status: 'closed' });
    }
  });

  res.json({ ok: true });
});

// ── CANCEL PLAN ──
router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const n = await db('emi_plans')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ status: 'cancelled' });
  if (!n) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
