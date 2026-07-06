/**
 * Collections aggregation route — VPS migration phase 3F.
 *
 *   GET /api/collections/outstanding?dealerId=<uuid>&customerId=<uuid>
 *     → { customers: [...] }  matches CustomerOutstanding[] shape used by
 *       src/modules/collections/CollectionTracker.tsx. `customerId` is
 *       optional (V2 Sprint 4A) — scopes the result to one customer for the
 *       new Customer Profile "ledger summary" view; omitted, it behaves
 *       exactly as before (dealer-wide, outstanding-only).
 *
 *   GET /api/collections/recent?dealerId=<uuid>&limit=20
 *     → { rows: [...] }  recent customer payment entries.
 *
 *   POST /api/collections/adjustment (V2 Sprint 4A)
 *     → manual signed customer_ledger entry (type='adjustment') for
 *       corrections outside the normal payment flow — e.g. a write-off or
 *       a balance correction. dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { recordCustomerPayment } from '../lib/customerPayment';
import {
  getCustomerAggById,
  getCustomerOutstandingMapFromReadModel,
  getOldestUnpaidSaleDateByCustomer,
} from '../services/reportQueryService';

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
  // V2 Sprint 4A — optional single-customer scope for the new Customer
  // Profile view. Existing dealer-wide callers (CollectionTracker.tsx)
  // never send this param, so their behavior is unchanged.
  const customerId = (req.query.customerId as string | undefined) || undefined;

  try {
    const [custs, sales, followups, aggMap, outstandingMap, oldestMap] = await Promise.all([
      db('customers')
        .select('id', 'name', 'phone', 'type', 'max_overdue_days')
        .where({ dealer_id: dealerId, status: 'active' })
        .modify((qb) => { if (customerId) qb.andWhere('id', customerId); })
        .orderBy('name'),
      db('sales')
        .select('customer_id', 'invoice_number', 'sale_date', 'id', 'due_amount')
        .where({ dealer_id: dealerId })
        .orderBy('sale_date', 'desc'),
      db('customer_followups')
        .select('customer_id', 'followup_date', 'status', 'created_at')
        .where({ dealer_id: dealerId })
        .orderBy('created_at', 'desc')
        .catch(() => [] as any[]),
      getCustomerAggById(dealerId),
      getCustomerOutstandingMapFromReadModel(dealerId),
      getOldestUnpaidSaleDateByCustomer(dealerId),
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

    // oldest unpaid sale per customer (shared with dashboard / due aging)
    const oldestMapFromSales = oldestMap;

    const today = new Date();
    const result = custs.map((c: any) => {
      const a = aggMap.get(c.id) ?? {
        outstanding: 0, total_sales: 0, total_paid: 0, last_payment: null,
      };
      const outstanding = outstandingMap.get(c.id) ?? a.outstanding;
      const oldest = oldestMapFromSales.get(c.id) ?? null;
      const daysOverdue = oldest
        ? Math.max(0, Math.floor((today.getTime() - new Date(oldest).getTime()) / 86400000))
        : 0;
      const fu = followupMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        type: c.type,
        outstanding,
        last_payment_date: a.last_payment,
        total_sales: a.total_sales,
        total_paid: a.total_paid,
        invoices: invoiceMap.get(c.id) ?? [],
        oldestSaleDate: oldest,
        daysOverdue,
        agingBucket: getAgingBucket(daysOverdue),
        lastFollowupDate: fu?.date ?? null,
        lastFollowupStatus: fu?.status ?? null,
        maxOverdueDays: Number(c.max_overdue_days ?? 0),
      };
    })
      // V2 Sprint 4A — scoped to a single customer (Customer Profile), return
      // the row regardless of outstanding balance (0 or credit is a valid,
      // informative state there); the dealer-wide list keeps its existing
      // "outstanding only" behavior.
      .filter((c: any) => (customerId ? true : c.outstanding > 0));

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
  paid_account_id: z.string().uuid().optional().nullable(),
});

router.post('/payment', requireRole('dealer_admin', 'manager', 'accountant', 'salesman'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = collectionPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { customer_id, amount, note, payment_mode, paid_account_id } = parsed.data;

  try {
    const result = await db.transaction(async (trx) =>
      recordCustomerPayment(trx, {
        dealerId,
        customerId: customer_id,
        amount,
        note,
        payment_mode,
        paid_account_id,
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

// ─── POST /api/collections/adjustment — "Collection Adjustment" (V2 Sprint 4A) ───
// A manual, signed customer_ledger entry outside the normal FIFO payment
// flow — e.g. correcting a data-entry error or writing off a small balance.
// Reuses the exact ledger semantics customerStatements.ts already relies on:
// type='adjustment' is summed the SAME way 'sale' is (a positive amount
// increases due_balance); passing a negative amount decreases it (e.g. a
// write-off). dealer_admin only, since it bypasses invoice-level tracking.
const adjustmentSchema = z.object({
  customer_id: z.string().uuid(),
  amount: z.coerce.number().refine((v) => v !== 0, 'Amount must not be zero'),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

router.post('/adjustment', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { customer_id, amount, reason } = parsed.data;

  try {
    const customer = await db('customers').where({ id: customer_id, dealer_id: dealerId }).first('id');
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const [row] = await db('customer_ledger')
      .insert({
        dealer_id: dealerId,
        customer_id,
        type: 'adjustment',
        amount,
        description: reason,
        entry_date: new Date().toISOString().slice(0, 10),
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[collections/adjustment]', err.message);
    res.status(500).json({ error: err.message || 'Failed to record adjustment' });
  }
});

export default router;
