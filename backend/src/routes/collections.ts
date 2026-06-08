/**
 * Collections aggregation route — VPS migration phase 3F.
 *
 *   GET /api/collections/outstanding?dealerId=<uuid>
 *     → { customers: [...] }  matches CustomerOutstanding[] shape used by
 *       src/modules/collections/CollectionTracker.tsx.
 *
 *   GET /api/collections/recent?dealerId=<uuid>&limit=20
 *     → { rows: [...] }  recent customer payment entries.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { recordCustomerPayment } from '../lib/customerPayment';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

function getAgingBucket(daysOverdue: number): string {
  if (daysOverdue <= 30) return 'current';
  if (daysOverdue <= 60) return '30+';
  if (daysOverdue <= 90) return '60+';
  return '90+';
}

router.get('/outstanding', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const [custs, ledger, sales, followups] = await Promise.all([
      db('customers')
        .select('id', 'name', 'phone', 'type', 'max_overdue_days')
        .where({ dealer_id: dealerId, status: 'active' })
        .orderBy('name'),
      db('customer_ledger')
        .select('customer_id', 'amount', 'type', 'entry_date')
        .where({ dealer_id: dealerId }),
      db('sales')
        .select('customer_id', 'invoice_number', 'sale_date', 'id', 'due_amount')
        .where({ dealer_id: dealerId })
        .orderBy('sale_date', 'desc'),
      db('customer_followups')
        .select('customer_id', 'followup_date', 'status', 'created_at')
        .where({ dealer_id: dealerId })
        .orderBy('created_at', 'desc')
        .catch(() => [] as any[]),
    ]);

    const followupMap = new Map<string, { date: string; status: string }>();
    for (const f of followups as any[]) {
      if (!followupMap.has(f.customer_id)) {
        followupMap.set(f.customer_id, { date: f.followup_date, status: f.status });
      }
    }

    const invoiceMap = new Map<string, { invoice_number: string; sale_id: string; sale_date: string }[]>();
    for (const s of sales) {
      if (!s.invoice_number) continue;
      const arr = invoiceMap.get(s.customer_id) ?? [];
      arr.push({ invoice_number: s.invoice_number, sale_id: s.id, sale_date: String(s.sale_date) });
      invoiceMap.set(s.customer_id, arr);
    }

    // oldest unpaid sale per customer
    const oldestMap = new Map<string, string>();
    const salesAsc = [...sales].reverse();
    for (const s of salesAsc) {
      if (Number(s.due_amount) > 0 && !oldestMap.has(s.customer_id)) {
        oldestMap.set(s.customer_id, String(s.sale_date));
      }
    }

    const agg = new Map<string, {
      outstanding: number; total_sales: number; total_paid: number; last_payment: string | null;
    }>();
    for (const e of ledger) {
      const cur = agg.get(e.customer_id) ?? { outstanding: 0, total_sales: 0, total_paid: 0, last_payment: null };
      const amt = Number(e.amount);
      if (e.type === 'sale') { cur.outstanding += amt; cur.total_sales += amt; }
      else if (e.type === 'payment' || e.type === 'refund') {
        cur.outstanding -= amt; cur.total_paid += amt;
        const d = String(e.entry_date);
        if (!cur.last_payment || d > cur.last_payment) cur.last_payment = d;
      } else if (e.type === 'adjustment') {
        cur.outstanding += amt; cur.total_sales += amt;
      }
      agg.set(e.customer_id, cur);
    }

    const today = new Date();
    const result = custs.map((c: any) => {
      const a = agg.get(c.id) ?? { outstanding: 0, total_sales: 0, total_paid: 0, last_payment: null };
      const oldest = oldestMap.get(c.id) ?? null;
      const daysOverdue = oldest
        ? Math.max(0, Math.floor((today.getTime() - new Date(oldest).getTime()) / 86400000))
        : 0;
      const fu = followupMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        type: c.type,
        outstanding: Math.round(a.outstanding * 100) / 100,
        last_payment_date: a.last_payment,
        total_sales: Math.round(a.total_sales * 100) / 100,
        total_paid: Math.round(a.total_paid * 100) / 100,
        invoices: invoiceMap.get(c.id) ?? [],
        oldestSaleDate: oldest,
        daysOverdue,
        agingBucket: getAgingBucket(daysOverdue),
        lastFollowupDate: fu?.date ?? null,
        lastFollowupStatus: fu?.status ?? null,
        maxOverdueDays: Number(c.max_overdue_days ?? 0),
      };
    }).filter((c) => c.outstanding > 0);

    res.json({ customers: result });
  } catch (err: any) {
    console.error('[collections/outstanding]', err.message);
    res.status(500).json({ error: 'Failed to load collections' });
  }
});

// ─── POST /api/collections/payment ───────────────────────────────────────
// Atomic customer payment: allocates across oldest due invoices (FIFO) and
// updates sales.paid_amount / sales.due_amount for each allocation.
const collectionPaymentSchema = z.object({
  customer_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional(),
  payment_mode: z.string().trim().max(50).optional(),
});

router.post('/payment', requireRole('dealer_admin', 'manager', 'accountant', 'salesman'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = collectionPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { customer_id, amount, note, payment_mode } = parsed.data;

  try {
    const result = await db.transaction(async (trx) =>
      recordCustomerPayment(trx, {
        dealerId,
        customerId: customer_id,
        amount,
        note,
        payment_mode,
      }),
    );
    res.status(201).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[collections/payment]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record payment' });
  }
});

router.get('/recent', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
    const rows = await db('customer_ledger as cl')
      .leftJoin('customers as c', 'c.id', 'cl.customer_id')
      .select(
        'cl.id',
        'cl.amount',
        'cl.description',
        'cl.entry_date',
        'cl.created_at',
        'cl.customer_id',
        'c.name as customer_name',
      )
      .where({ 'cl.dealer_id': dealerId, 'cl.type': 'payment' })
      .orderBy('cl.created_at', 'desc')
      .limit(limit);
    res.json({
      rows: rows.map((r: any) => ({
        id: r.id,
        customer_name: r.customer_name ?? 'Unknown',
        amount: Number(r.amount),
        description: r.description,
        entry_date: r.entry_date,
        created_at: r.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[collections/recent]', err.message);
    res.status(500).json({ error: 'Failed to load recent collections' });
  }
});

// ─── Customer Follow-ups (Phase 3U-4) ─────────────────────────────────────
router.get('/followups', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const customerId = (req.query.customerId as string | undefined) || '';
  if (!customerId) {
    res.status(400).json({ error: 'customerId is required' });
    return;
  }
  try {
    const rows = await db('customer_followups')
      .where({ customer_id: customerId, dealer_id: dealerId })
      .orderBy('created_at', 'desc')
      .select('*');
    res.json({ rows });
  } catch (err: any) {
    console.error('[collections/followups.list]', err.message);
    res.status(500).json({ error: 'Failed to load follow-ups' });
  }
});

router.post('/followups', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { customer_id, note, status } = (req.body ?? {}) as {
    customer_id?: string;
    note?: string;
    status?: string;
  };
  if (!customer_id || !note?.trim()) {
    res.status(400).json({ error: 'customer_id and note are required' });
    return;
  }
  try {
    const owner = await db('customers')
      .where({ id: customer_id, dealer_id: dealerId })
      .first();
    if (!owner) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const todayStr = new Date().toISOString().split('T')[0];
    const [row] = await db('customer_followups')
      .insert({
        dealer_id: dealerId,
        customer_id,
        note: note.trim(),
        status: status || 'no_answer',
        created_by: req.user?.userId ?? null,
        followup_date: todayStr,
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[collections/followups.create]', err.message);
    res.status(500).json({ error: 'Failed to add follow-up' });
  }
});

export default router;
