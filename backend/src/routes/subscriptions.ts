import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { defaultSubscriptionEndDate } from '../lib/subscriptionEndDate';
import { recordSaAudit } from '../services/saAuditService';
import { sendWhatsApp } from '../services/notificationService';
import {
  notifyPaymentApproved,
  notifyPaymentRejected,
  notifyMoreInfoNeeded,
  notifyManualActivated,
  notifyExtended,
  notifySuspended,
} from '../services/subscriptionNotifyService';

const router = Router();

router.use(authenticate, requireRole('super_admin'));

// ── WhatsApp notification helpers ────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: '✅ সক্রিয়',
  expired: '⛔ মেয়াদোত্তীর্ণ',
  suspended: '🚫 স্থগিত',
};

async function notifySubscriptionChange(opts: {
  dealerPhone: string | null;
  dealerName: string;
  event: 'created' | 'updated' | 'payment';
  status?: string;
  endDate?: string | null;
  amount?: number;
  method?: string;
  planName?: string;
}): Promise<void> {
  const { dealerPhone, dealerName, event, status, endDate, amount, method, planName } = opts;
  if (!dealerPhone) return;

  const dateStr = endDate ? new Date(endDate).toLocaleDateString('bn-BD') : '—';
  const statusLabel = status ? (STATUS_LABEL[status] ?? status) : '';

  let text = '';
  if (event === 'created') {
    text =
      `🎉 *সাবস্ক্রিপশন তৈরি হয়েছে*\n` +
      `ব্যবসা: *${dealerName}*\n` +
      (planName ? `প্ল্যান: ${planName}\n` : '') +
      `স্ট্যাটাস: ${statusLabel}\n` +
      `মেয়াদ শেষ: ${dateStr}\n\n` +
      `আপনার অ্যাকাউন্ট এখন সক্রিয়। লগইন করুন: app.sanitileserp.com`;
  } else if (event === 'updated') {
    text =
      `🔄 *সাবস্ক্রিপশন আপডেট হয়েছে*\n` +
      `ব্যবসা: *${dealerName}*\n` +
      (planName ? `প্ল্যান: ${planName}\n` : '') +
      `স্ট্যাটাস: ${statusLabel}\n` +
      `মেয়াদ শেষ: ${dateStr}`;
  } else if (event === 'payment') {
    const methodLabels: Record<string, string> = { cash: 'ক্যাশ', bank: 'ব্যাংক', mobile_banking: 'মোবাইল ব্যাংকিং' };
    text =
      `💳 *পেমেন্ট গ্রহণ হয়েছে*\n` +
      `ব্যবসা: *${dealerName}*\n` +
      `পরিমাণ: ৳${(amount ?? 0).toLocaleString('bn-BD')}\n` +
      `মাধ্যম: ${methodLabels[method ?? ''] ?? method ?? '—'}\n` +
      `স্ট্যাটাস: ${statusLabel}\n` +
      `মেয়াদ শেষ: ${dateStr}\n\n` +
      `ধন্যবাদ! app.sanitileserp.com`;
  }

  if (text) {
    // Best-effort — don't let notification failure block the response
    sendWhatsApp({ to: dealerPhone, text }).catch(() => {});
  }
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Reconciles subscription.status with end_date so the auth /me endpoint
 * always returns a status that matches reality. Suspended is sticky.
 */
function deriveStatus(currentStatus: string, endDateStr: string | null): 'active' | 'expired' | 'suspended' {
  if (currentStatus === 'suspended') return 'suspended';
  if (!endDateStr) return 'expired';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDateStr + 'T00:00:00');
  return today <= end ? 'active' : 'expired';
}

async function ensurePlan(planId?: string | null): Promise<string> {
  if (planId) return planId;
  let plan = await db('plans').where({ is_active: true }).orderBy('sort_order', 'asc').orderBy('price_monthly', 'asc').first();
  if (!plan) plan = await db('plans').orderBy('price_monthly', 'asc').first();
  if (!plan) {
    [plan] = await db('plans')
      .insert({ name: 'Basic', price_monthly: 0, price_yearly: 0, max_users: 1 })
      .returning('*');
  }
  return plan.id;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db('subscriptions as s')
      .leftJoin('dealers as d', 'd.id', 's.dealer_id')
      .leftJoin('plans as p', 'p.id', 's.plan_id')
      .select(
        's.id', 's.dealer_id', 's.plan_id', 's.status', 's.billing_cycle',
        's.start_date', 's.end_date', 's.yearly_discount_applied', 's.created_at',
        's.custom_features',
        'd.name as dealer_name', 'p.name as plan_name', 'p.price_monthly', 'p.price_yearly', 'p.max_users',
      )
      .orderBy('s.start_date', 'desc')
      .orderBy('s.created_at', 'desc');

    res.json({
      subscriptions: rows.map((r: any) => ({
        ...r,
        start_date: toDateOnly(r.start_date),
        end_date: toDateOnly(r.end_date),
        dealers: r.dealer_name ? { name: r.dealer_name } : null,
        plans: r.plan_name ? { id: r.plan_id, name: r.plan_name } : null,
      })),
    });
  } catch (err: any) {
    console.error('[subscriptions:list] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load subscriptions' });
  }
});

router.get('/lookups', async (_req: Request, res: Response) => {
  try {
    const [dealers, plans] = await Promise.all([
      db('dealers').select('id', 'name').whereIn('status', ['active', 'pending', 'suspended']).orderBy('name'),
      db('plans')
        .where({ is_active: true })
        .select('id', 'name', 'price_monthly', 'price_yearly', 'max_users')
        .orderBy('sort_order', 'asc')
        .orderBy('price_monthly', 'asc'),
    ]);
    res.json({ dealers, plans });
  } catch (err: any) {
    console.error('[subscriptions:lookups] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load subscription lookups' });
  }
});

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const [dealers, subscriptions, payments] = await Promise.all([
      db('dealers').select('id', 'status'),
      db('subscriptions as s')
        .leftJoin('plans as p', 'p.id', 's.plan_id')
        .select(
          's.id', 's.dealer_id', 's.status', 's.start_date', 's.end_date', 's.billing_cycle', 's.created_at',
          'p.price_monthly', 'p.price_yearly', 'p.name as plan_name',
        ),
      db('subscription_payments').select('id', 'subscription_id', 'dealer_id', 'amount', 'payment_date', 'payment_status'),
    ]);

    res.json({
      dealers: dealers.map((d: any) => ({ ...d })),
      subscriptions: subscriptions.map((s: any) => ({
        ...s,
        start_date: toDateOnly(s.start_date),
        end_date: toDateOnly(s.end_date),
      })),
      payments: payments.map((p: any) => ({
        ...p,
        payment_date: toDateOnly(p.payment_date),
        amount: Number(p.amount || 0),
      })),
    });
  } catch (err: any) {
    console.error('[subscriptions:dashboard] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load dashboard metrics' });
  }
});

router.get('/payments', async (req: Request, res: Response) => {
  try {
    const dealerId = String(req.query.dealer_id || '').trim();
    const rows = await db('subscription_payments as sp')
      .leftJoin('dealers as d', 'd.id', 'sp.dealer_id')
      .leftJoin('subscriptions as s', 's.id', 'sp.subscription_id')
      .leftJoin('plans as p', 'p.id', 's.plan_id')
      .leftJoin('users as u', 'u.id', 'sp.collected_by')
      .modify((qb) => {
        if (dealerId) qb.where('sp.dealer_id', dealerId);
      })
      .select(
        'sp.id', 'sp.subscription_id', 'sp.dealer_id', 'sp.amount', 'sp.payment_method',
        'sp.payment_status', 'sp.payment_date', 'sp.note', 'sp.collected_by', 'sp.created_at',
        'd.name as dealer_name', 'd.email as dealer_email', 'd.phone as dealer_phone', 'd.address as dealer_address',
        'p.name as plan_name', 's.billing_cycle', 's.start_date', 's.end_date', 'u.name as collected_by_name',
      )
      .orderBy('sp.payment_date', 'desc')
      .orderBy('sp.created_at', 'desc')
      .limit(500);

    res.json({
      payments: rows.map((r: any) => ({
        ...r,
        amount: Number(r.amount || 0),
        payment_date: toDateOnly(r.payment_date),
        start_date: toDateOnly(r.start_date),
        end_date: toDateOnly(r.end_date),
      })),
    });
  } catch (err: any) {
    console.error('[subscriptions:payments:list] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load payment history' });
  }
});

const createSchema = z.object({
  dealer_id: z.string().uuid(),
  plan_id: z.string().uuid().optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  status: z.enum(['active', 'expired', 'suspended']).default('active'),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body || {});
    const planId = await ensurePlan(body.plan_id);

    let endDate = body.end_date;
    if (!endDate) {
      endDate = await defaultSubscriptionEndDate(planId);
    }

    const startDate = body.start_date || new Date().toISOString().slice(0, 10);
    const finalStatus = deriveStatus(body.status, endDate);

    const [row] = await db('subscriptions')
      .insert({
        dealer_id: body.dealer_id,
        plan_id: planId,
        start_date: startDate,
        end_date: endDate,
        status: finalStatus,
      })
      .returning('*');

    // Activate dealer + admin user so login works immediately
    await db('dealers').where({ id: body.dealer_id }).update({ status: 'active', updated_at: new Date() });
    const adminProfile = await db('profiles').where({ dealer_id: body.dealer_id }).first();
    if (adminProfile) {
      await db('users').where({ id: adminProfile.id }).update({ status: 'active', updated_at: new Date() });
    }

    // WhatsApp notification to dealer
    const newDealer = await db('dealers').where({ id: body.dealer_id }).first();
    const newPlan = planId ? await db('plans').where({ id: planId }).first() : null;
    await notifySubscriptionChange({
      dealerPhone: newDealer?.phone ?? null,
      dealerName: newDealer?.name ?? 'Unknown',
      event: 'created',
      status: finalStatus,
      endDate: endDate,
      planName: newPlan?.name ?? undefined,
    });

    res.status(201).json({ subscription: row });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid subscription data' });
      return;
    }
    console.error('[subscriptions:create] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to create subscription' });
  }
});

const updateSchema = z.object({
  plan_id: z.string().uuid().optional(),
  end_date: z.string().optional().nullable(),
  status: z.enum(['active', 'expired', 'suspended']).optional(),
  billing_cycle: z.enum(['monthly', 'yearly']).optional(),
  yearly_discount_applied: z.boolean().optional(),
  custom_features: z.record(z.unknown()).nullable().optional(),
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body || {});
    const patch: Record<string, any> = { ...body };
    if (patch.end_date === '') patch.end_date = null;

    const existing = await db('subscriptions').where({ id: req.params.id }).first();
    if (!existing) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const newEnd = patch.end_date !== undefined ? toDateOnly(patch.end_date) : toDateOnly(existing.end_date);
    const baseStatus = patch.status ?? existing.status;
    patch.status = deriveStatus(baseStatus, newEnd);

    const [row] = await db('subscriptions').where({ id: req.params.id }).update(patch).returning('*');

    // Activate dealer + admin and force token refresh so the dealer
    // app picks up the new subscription on next API call.
    if (patch.status === 'active') {
      await db('dealers').where({ id: existing.dealer_id }).update({ status: 'active', updated_at: new Date() });
      const adminProfile = await db('profiles').where({ dealer_id: existing.dealer_id }).first();
      if (adminProfile) {
        await db('users').where({ id: adminProfile.id }).update({ status: 'active', updated_at: new Date() });
        // Refresh tokens left intact; access token will pick up the new subscription via /me on next request.
      }
    }

    const dealer = await db('dealers').where({ id: existing.dealer_id }).first();
    await recordSaAudit(req, {
      action: 'subscription.update',
      targetType: 'subscription',
      targetId: row.id,
      targetLabel: dealer?.name ?? null,
      details: {
        from: { status: existing.status, end_date: toDateOnly(existing.end_date) },
        to: { status: row.status, end_date: toDateOnly(row.end_date) },
      },
    });

    const updPlan = row.plan_id ? await db('plans').where({ id: row.plan_id }).first() : null;
    const planName = updPlan?.name ?? undefined;
    const newEndDate = toDateOnly(row.end_date);

    // Determine which specific event this update represents
    const wasSuspended = existing.status !== 'suspended' && row.status === 'suspended';
    const wasActivated = existing.status !== 'active' && row.status === 'active';
    const endDateExtended = !wasSuspended && !wasActivated &&
      row.status === 'active' && newEndDate !== toDateOnly(existing.end_date);

    if (wasSuspended) {
      await notifySuspended({ dealerId: existing.dealer_id });
    } else if (wasActivated) {
      await notifyManualActivated({ dealerId: existing.dealer_id, planName, endDate: newEndDate });
    } else if (endDateExtended) {
      await notifyExtended({ dealerId: existing.dealer_id, planName, newEndDate });
    } else {
      // Generic update fallback
      await notifySubscriptionChange({
        dealerPhone: dealer?.phone ?? null,
        dealerName: dealer?.name ?? 'Unknown',
        event: 'updated',
        status: row.status,
        endDate: newEndDate,
        planName,
      });
    }

    res.json({ subscription: row });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid subscription data' });
      return;
    }
    console.error('[subscriptions:update] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to update subscription' });
  }
});

/**
 * POST /api/subscriptions/payments — record a subscription payment.
 * Mirrors the legacy `recordSubscriptionPayment` Supabase service.
 *  - Blocks duplicate "paid" entries for the same subscription.
 *  - Computes yearly-discount eligibility (first yearly per dealer).
 *  - On full payment: extends end_date by extend_months, sets status=active,
 *    re-activates dealer + admin user, updates billing cycle.
 */
const recordPaymentSchema = z.object({
  subscription_id: z.string().uuid(),
  dealer_id: z.string().uuid(),
  amount: z.coerce.number().nonnegative(),
  payment_date: z.string(), // YYYY-MM-DD
  payment_method: z.enum(['cash', 'bank', 'mobile_banking']),
  payment_status: z.enum(['paid', 'partial', 'pending']),
  note: z.string().max(500).optional().nullable(),
  extend_months: z.coerce.number().int().min(0).max(36).default(1),
  billing_cycle: z.enum(['monthly', 'yearly']).default('monthly'),
});

function addMonthsIso(baseIso: string, months: number): string {
  const d = new Date(baseIso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

router.post('/payments', async (req: Request, res: Response) => {
  try {
    const body = recordPaymentSchema.parse(req.body || {});
    const collectedBy = (req as any).user?.id || null;

    // 1. Duplicate check for full payments.
    if (body.payment_status === 'paid') {
      const existing = await db('subscription_payments')
        .where({ subscription_id: body.subscription_id, payment_status: 'paid' })
        .first();
      if (existing) {
        res.status(409).json({
          error:
            "A full payment has already been recorded for this subscription period. Use 'Edit' to extend the end date or create a new subscription instead.",
        });
        return;
      }
    }

    // 2. Yearly discount eligibility.
    let yearlyDiscountApplied = false;
    if (body.billing_cycle === 'yearly' && body.payment_status === 'paid') {
      const prev = await db('subscriptions')
        .where({ dealer_id: body.dealer_id, yearly_discount_applied: true })
        .first();
      yearlyDiscountApplied = !prev;
    }

    let paymentRow: any = null;
    let updatedSub: any = null;

    await db.transaction(async (trx) => {
      // 3. Insert payment.
      const [pay] = await trx('subscription_payments')
        .insert({
          subscription_id: body.subscription_id,
          dealer_id: body.dealer_id,
          amount: body.amount,
          payment_date: body.payment_date,
          payment_method: body.payment_method,
          payment_status: body.payment_status,
          collected_by: collectedBy,
          note: body.note || null,
        })
        .returning('*');
      paymentRow = pay;

      // 4. Full payment → extend subscription + activate dealer/user.
      if (body.payment_status === 'paid') {
        const sub = await trx('subscriptions')
          .where({ id: body.subscription_id })
          .first();
        if (!sub) throw new Error('Subscription not found');

        const baseIso = toDateOnly(sub.end_date) || toDateOnly(sub.start_date) || new Date().toISOString().slice(0, 10);
        const newEnd = addMonthsIso(baseIso, body.extend_months);

        const [row] = await trx('subscriptions')
          .where({ id: body.subscription_id })
          .update({
            end_date: newEnd,
            status: 'active',
            billing_cycle: body.billing_cycle,
            yearly_discount_applied: yearlyDiscountApplied,
          })
          .returning('*');
        updatedSub = row;

        await trx('dealers')
          .where({ id: body.dealer_id })
          .update({ status: 'active', updated_at: new Date() });
        const adminProfile = await trx('profiles')
          .where({ dealer_id: body.dealer_id })
          .first();
        if (adminProfile) {
          await trx('users')
            .where({ id: adminProfile.id })
            .update({ status: 'active', updated_at: new Date() });
        }
      }
    });

    const payDealer = await db('dealers').where({ id: body.dealer_id }).first();
    await recordSaAudit(req, {
      action: 'subscription.payment',
      targetType: 'subscription',
      targetId: body.subscription_id,
      targetLabel: payDealer?.name ?? null,
      details: {
        amount: body.amount,
        method: body.payment_method,
        status: body.payment_status,
        billing_cycle: body.billing_cycle,
        extend_months: body.extend_months,
      },
    });

    await notifySubscriptionChange({
      dealerPhone: payDealer?.phone ?? null,
      dealerName: payDealer?.name ?? 'Unknown',
      event: 'payment',
      status: updatedSub?.status ?? body.payment_status,
      endDate: updatedSub ? toDateOnly(updatedSub.end_date) : null,
      amount: body.amount,
      method: body.payment_method,
    });

    res.status(201).json({
      payment: paymentRow,
      subscription: updatedSub,
      yearly_discount_applied: yearlyDiscountApplied,
    });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid payment data' });
      return;
    }
    console.error('[subscriptions:payments] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to record payment' });
  }
});

/**
 * GET /api/subscriptions/yearly-discount-eligibility?dealer_id=...
 * Returns true when the dealer has never had yearly_discount_applied.
 */
router.get('/yearly-discount-eligibility', async (req: Request, res: Response) => {
  try {
    const dealerId = String(req.query.dealer_id || '');
    if (!dealerId) {
      res.status(400).json({ error: 'dealer_id is required' });
      return;
    }
    const prev = await db('subscriptions')
      .where({ dealer_id: dealerId, yearly_discount_applied: true })
      .first();
    res.json({ eligible: !prev });
  } catch (err: any) {
    console.error('[subscriptions:yearly-discount] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to check eligibility' });
  }
});

/**
 * PATCH /api/subscriptions/payments/:id — SA reviews a dealer upgrade request.
 * Actions: approve (activates subscription), reject, more_info.
 */
const reviewPaymentSchema = z.object({
  action: z.enum(['approve', 'reject', 'more_info']),
  review_note: z.string().max(1000).optional().nullable(),
  extend_months: z.coerce.number().int().min(1).max(36).default(1),
  billing_cycle: z.enum(['monthly', 'yearly']).default('monthly'),
});

router.patch('/payments/:id', async (req: Request, res: Response) => {
  try {
    const body = reviewPaymentSchema.parse(req.body || {});
    const reviewedBy = (req as any).user?.id ?? null;

    const payment = await db('subscription_payments').where({ id: req.params.id }).first();
    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const newStatus = body.action === 'approve' ? 'paid' : body.action === 'reject' ? 'rejected' : 'more_info';

    await db('subscription_payments').where({ id: req.params.id }).update({
      payment_status: newStatus,
      review_note: body.review_note ?? null,
      reviewed_by: reviewedBy,
      reviewed_at: new Date(),
    });

    let updatedSub: any = null;
    const planName = payment.requested_plan_id
      ? (await db('plans').where({ id: payment.requested_plan_id }).first())?.name
      : undefined;

    if (body.action === 'approve') {
      // Activate + extend subscription, just like a paid payment
      const sub = await db('subscriptions').where({ id: payment.subscription_id }).first();
      if (sub) {
        const baseIso = toDateOnly(sub.end_date) || toDateOnly(sub.start_date) || new Date().toISOString().slice(0, 10);
        const newEnd = addMonthsIso(baseIso, body.extend_months);
        const planIdToUse = payment.requested_plan_id ?? sub.plan_id;

        const [row] = await db('subscriptions').where({ id: sub.id }).update({
          end_date: newEnd,
          status: 'active',
          plan_id: planIdToUse,
          billing_cycle: body.billing_cycle,
        }).returning('*');
        updatedSub = row;

        await db('dealers').where({ id: payment.dealer_id }).update({ status: 'active', updated_at: new Date() });
        const adminProfile = await db('profiles').where({ dealer_id: payment.dealer_id }).first();
        if (adminProfile) {
          await db('users').where({ id: adminProfile.id }).update({ status: 'active', updated_at: new Date() });
        }

        await notifyPaymentApproved({
          dealerId: payment.dealer_id,
          planName,
          endDate: newEnd,
          reviewNote: body.review_note ?? undefined,
        });
      }
    } else if (body.action === 'reject') {
      await notifyPaymentRejected({
        dealerId: payment.dealer_id,
        planName,
        reviewNote: body.review_note ?? undefined,
      });
    } else {
      await notifyMoreInfoNeeded({
        dealerId: payment.dealer_id,
        reviewNote: body.review_note ?? undefined,
      });
    }

    await recordSaAudit(req, {
      action: `subscription.payment.${body.action}`,
      targetType: 'subscription',
      targetId: payment.subscription_id,
      targetLabel: planName ?? null,
      details: { payment_id: req.params.id, action: body.action, note: body.review_note },
    });

    res.json({ success: true, subscription: updatedSub });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid review data' });
      return;
    }
    console.error('[subscriptions:payments:review] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to review payment' });
  }
});

export default router;
