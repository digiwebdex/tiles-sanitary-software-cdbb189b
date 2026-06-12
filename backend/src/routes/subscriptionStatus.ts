/**
 * /api/subscription/status — server-clock subscription enforcement.
 *
 * P1 fix: previous implementation computed expiry on the browser,
 * letting anyone with devtools shift their machine clock to bypass
 * subscription gates. This endpoint always uses NOW() from the
 * Postgres server.
 *
 * Returns:
 *   { status: 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'none',
 *     end_date, days_remaining, is_super_admin, dealer_id }
 *
 * Frontend should poll this every page load / on demand and treat
 * 'expired' / 'suspended' as a hard gate.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { notifyRenewalPaymentSubmitted } from '../lib/subscriptionRenewalNotify';

const router = Router();

router.use(authenticate);

const GRACE_DAYS = 3;
const EXPIRING_SOON_DAYS = 7;

router.get('/status', async (req: Request, res: Response) => {
  try {
    const isSuper = req.user?.roles.includes('super_admin') ?? false;
    if (isSuper) {
      res.json({
        status: 'active',
        end_date: null,
        days_remaining: null,
        is_super_admin: true,
        dealer_id: null,
      });
      return;
    }

    const dealerId = req.user?.dealerId;
    if (!dealerId) {
      res.json({
        status: 'none',
        end_date: null,
        days_remaining: null,
        is_super_admin: false,
        dealer_id: null,
      });
      return;
    }

    // Use server NOW() — never trust the client clock.
    const sub = await db('subscriptions')
      .where({ dealer_id: dealerId })
      .orderBy('start_date', 'desc')
      .orderBy('created_at', 'desc')
      .first();

    if (!sub) {
      res.json({
        status: 'none',
        end_date: null,
        days_remaining: null,
        is_super_admin: false,
        dealer_id: dealerId,
      });
      return;
    }

    if (sub.status === 'suspended') {
      res.json({
        status: 'suspended',
        end_date: sub.end_date,
        days_remaining: 0,
        is_super_admin: false,
        dealer_id: dealerId,
      });
      return;
    }

    // Compute days remaining using the database clock for safety.
    const result = await db.raw(
      `SELECT (DATE(?::date) - CURRENT_DATE)::int AS days_remaining`,
      [sub.end_date],
    );
    const daysRemaining: number =
      result.rows?.[0]?.days_remaining ?? -9999;

    let status: 'active' | 'expiring' | 'expired';
    if (daysRemaining > EXPIRING_SOON_DAYS) status = 'active';
    else if (daysRemaining >= 0) status = 'expiring';
    else status = 'expired';

    res.json({
      status,
      end_date: sub.end_date,
      days_remaining: daysRemaining,
      is_super_admin: false,
      dealer_id: dealerId,
    });
  } catch (err: any) {
    console.error('[subscription/status]', err.message);
    res.status(500).json({ error: 'Failed to check subscription' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Dealer-facing subscription self-service (current plan, plan list,
// payment history, upgrade request). Scoped by req.user.dealerId.
// ─────────────────────────────────────────────────────────────────────

function requireDealer(req: Request, res: Response): string | null {
  const dealerId = req.user?.dealerId;
  if (!dealerId) {
    res.status(403).json({ error: 'Dealer scope required' });
    return null;
  }
  return dealerId;
}

/** GET /api/subscription/current — dealer's most recent subscription joined with plan. */
router.get('/current', async (req: Request, res: Response) => {
  try {
    const dealerId = requireDealer(req, res);
    if (!dealerId) return;

    const sub = await db('subscriptions as s')
      .leftJoin('plans as p', 'p.id', 's.plan_id')
      .where('s.dealer_id', dealerId)
      .orderBy('s.start_date', 'desc')
      .orderBy('s.created_at', 'desc')
      .select(
        's.id', 's.dealer_id', 's.plan_id', 's.status', 's.billing_cycle',
        's.start_date', 's.end_date', 's.yearly_discount_applied',
        'p.name as plan_name', 'p.price_monthly', 'p.price_yearly', 'p.max_users',
        'p.sms_enabled', 'p.email_enabled', 'p.daily_summary_enabled',
        'p.features as plan_features', 'p.is_trial', 'p.trial_days', 'p.sort_order',
      )
      .first();

    res.json({ subscription: sub ?? null });
  } catch (err: any) {
    console.error('[subscription/current]', err.message);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

/** GET /api/subscription/plans — active plans visible to dealers. */
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const plans = await db('plans')
      .where({ is_active: true })
      .select(
        'id', 'name', 'price_monthly', 'price_yearly', 'max_users',
        'sms_enabled', 'email_enabled', 'daily_summary_enabled',
        'is_trial', 'trial_days', 'sort_order', 'features',
      )
      .orderBy('sort_order', 'asc')
      .orderBy('price_monthly', 'asc');
    res.json({ plans });
  } catch (err: any) {
    console.error('[subscription/plans]', err.message);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

/** GET /api/subscription/payments — dealer's own subscription payments / requests. */
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const dealerId = requireDealer(req, res);
    if (!dealerId) return;

    const rows = await db('subscription_payments as sp')
      .leftJoin('plans as p', 'p.id', 'sp.requested_plan_id')
      .where('sp.dealer_id', dealerId)
      .orderBy('sp.payment_date', 'desc')
      .orderBy('sp.created_at', 'desc')
      .select(
        'sp.id', 'sp.amount', 'sp.payment_method', 'sp.payment_status',
        'sp.payment_date', 'sp.note', 'sp.created_at',
        'sp.requested_plan_id', 'sp.requested_billing_cycle', 'sp.source',
        'p.name as requested_plan_name',
      )
      .limit(100);

    res.json({ payments: rows });
  } catch (err: any) {
    console.error('[subscription/payments]', err.message);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

/** POST /api/subscription/upgrade-request — dealer requests a plan change. */
router.post('/upgrade-request', async (req: Request, res: Response) => {
  try {
    const dealerId = requireDealer(req, res);
    if (!dealerId) return;

    const { plan_id, billing_cycle, note, payment_method, transaction_id } = req.body ?? {};
    if (!plan_id || typeof plan_id !== 'string') {
      res.status(400).json({ error: 'plan_id is required' });
      return;
    }
    const cycle = billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const methodRaw = String(payment_method || 'bank');
    const paymentMethod =
      methodRaw === 'cash' || methodRaw === 'mobile_banking' ? methodRaw : 'bank';
    const txnId = transaction_id ? String(transaction_id).slice(0, 80) : '';

    const plan = await db('plans').where({ id: plan_id, is_active: true }).first();
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const sub = await db('subscriptions')
      .where({ dealer_id: dealerId })
      .orderBy('start_date', 'desc')
      .orderBy('created_at', 'desc')
      .first();
    if (!sub) {
      res.status(400).json({ error: 'No active subscription found' });
      return;
    }

    // Reject duplicate pending request for the same plan + cycle
    const existing = await db('subscription_payments')
      .where({
        dealer_id: dealerId,
        requested_plan_id: plan_id,
        requested_billing_cycle: cycle,
        payment_status: 'pending',
      })
      .first();
    if (existing) {
      res.status(409).json({ error: 'A pending request for this plan already exists' });
      return;
    }

    const amount = cycle === 'yearly'
      ? Number(plan.price_yearly || 0)
      : Number(plan.price_monthly || 0);

    const noteParts = [
      `Renewal request: ${plan.name} (${cycle})`,
      txnId ? `Txn: ${txnId}` : null,
      note ? String(note).slice(0, 300) : null,
    ].filter(Boolean);

    const [row] = await db('subscription_payments')
      .insert({
        dealer_id: dealerId,
        subscription_id: sub.id,
        amount,
        payment_method: paymentMethod,
        payment_status: 'pending',
        payment_date: db.fn.now(),
        note: noteParts.join(' | ').slice(0, 500),
        requested_plan_id: plan_id,
        requested_billing_cycle: cycle,
        source: 'dealer_request',
        collected_by: req.user?.userId ?? null,
      })
      .returning('*');

    const dealer = await db('dealers').where({ id: dealerId }).first();
    void notifyRenewalPaymentSubmitted({
      dealerName: dealer?.name || 'Dealer',
      dealerEmail: dealer?.email || req.user?.email || '',
      dealerPhone: dealer?.phone || '',
      planName: plan.name,
      billingCycle: cycle,
      amount,
      paymentMethod,
      transactionRef: txnId || undefined,
    });

    res.json({ payment: row });
  } catch (err: any) {
    console.error('[subscription/upgrade-request]', err.message);
    res.status(500).json({ error: err.message || 'Failed to submit request' });
  }
});

export default router;
