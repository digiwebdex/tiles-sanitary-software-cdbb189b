/**
 * /api/admin — Super Admin aggregate stats.
 *
 * Used by Super Admin → System Monitoring + Dashboard pages to render
 * platform-wide counts (users, sales, dealers, active subs) and revenue
 * aggregates without N round-trips. All routes require super_admin.
 */
import { Router, Request, Response } from 'express';
import { sendAllTrialReminders, sendTrialDay5Reminders, sendTrialDay7Reminders } from '../services/trialReminderService';
import { runTrialExpiry } from '../services/trialExpiryService';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const CRON_SECRET = process.env.CRON_SECRET || 'tilessaas-cron-internal';

const router = Router();
router.use(authenticate, requireRole('super_admin'));

// Separate router for cron endpoints (bypass auth if secret header present)
const cronRouter = Router();
function cronGuard(req: Request, res: Response, next: import('express').NextFunction) {
  if (req.headers['x-cron-secret'] === CRON_SECRET) return next();
  return authenticate(req, res, () => requireRole('super_admin')(req, res, next));
}

/** GET /api/admin/system-stats — platform-wide counts. */
router.get('/system-stats', async (_req: Request, res: Response) => {
  try {
    const [profilesRes, salesRes, dealersRes, subsRes] = await Promise.all([
      db('profiles').count<{ count: string }[]>('id as count'),
      db('sales').count<{ count: string }[]>('id as count'),
      db('dealers').count<{ count: string }[]>('id as count'),
      db('subscriptions').where({ status: 'active' }).count<{ count: string }[]>('id as count'),
    ]);

    return res.json({
      totalUsers: Number(profilesRes[0]?.count ?? 0),
      totalSales: Number(salesRes[0]?.count ?? 0),
      totalDealers: Number(dealersRes[0]?.count ?? 0),
      activeSubs: Number(subsRes[0]?.count ?? 0),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const [dealers, subscriptions, payments] = await Promise.all([
      db('dealers').select('id', 'status'),
      db('subscriptions as s')
        .leftJoin('plans as p', 'p.id', 's.plan_id')
        .select(
          's.id',
          's.status',
          's.start_date',
          's.end_date',
          's.plan_id',
          's.dealer_id',
          'p.price_monthly',
          'p.price_yearly',
        ),
      db('subscription_payments').select('id', 'amount', 'payment_date', 'payment_status'),
    ]);

    return res.json({
      dealers,
      subscriptions: subscriptions.map((s: any) => ({
        id: s.id,
        status: s.status,
        start_date: s.start_date,
        end_date: s.end_date,
        plan_id: s.plan_id,
        dealer_id: s.dealer_id,
        subscription_plans: s.price_monthly === null && s.price_yearly === null
          ? null
          : { monthly_price: s.price_monthly, yearly_price: s.price_yearly },
      })),
      payments,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/dashboard-v2 — rich analytics for advanced SA dashboard. */
router.get('/dashboard-v2', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const graceCutoff = new Date(now); graceCutoff.setDate(graceCutoff.getDate() - 3);
    const expirySoonCutoff = new Date(now); expirySoonCutoff.setDate(expirySoonCutoff.getDate() + 7);

    const [
      kpi,
      alertDealers,
      recentActivity,
      monthlyRevenue,
      planDist,
      paymentTotals,
    ] = await Promise.all([
      // KPI aggregates
      db.raw(`
        SELECT
          (SELECT COUNT(*) FROM dealers) AS total_dealers,
          (SELECT COUNT(*) FROM dealers WHERE created_at >= NOW() - INTERVAL '30 days') AS new_dealers_30d,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subs,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND end_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS expiring_soon,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'expired' AND end_date::date >= NOW()::date - 3) AS grace_period,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'expired' AND (end_date IS NULL OR end_date::date < NOW()::date - 3)) AS truly_expired,
          (SELECT COUNT(*) FROM subscriptions WHERE status = 'suspended') AS suspended,
          (SELECT COALESCE(SUM(p.price_monthly),0) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active') AS mrr,
          (SELECT COALESCE(SUM(amount),0) FROM subscription_payments WHERE payment_status IN ('paid','partial') AND DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE)) AS collected_this_month,
          (SELECT COALESCE(SUM(amount),0) FROM subscription_payments WHERE payment_status IN ('pending','partial')) AS outstanding
      `),
      // Alert dealers: expiring ≤7 days or in grace
      db('subscriptions as s')
        .join('dealers as d', 'd.id', 's.dealer_id')
        .leftJoin('plans as p', 'p.id', 's.plan_id')
        // Phone lives on dealers (d.phone); the profiles table has no phone column.
        .where('s.status', 'active')
        .whereRaw('s.end_date::date BETWEEN ? AND ?', [todayStr, expirySoonCutoff.toISOString().slice(0, 10)])
        .orWhere(function () {
          this.where('s.status', 'expired')
            .whereRaw('s.end_date::date >= ?', [graceCutoff.toISOString().slice(0, 10)]);
        })
        .groupBy('s.id', 'd.id', 'p.id')
        .select(
          'd.id as dealer_id', 'd.name as dealer_name', 'd.status as dealer_status',
          's.id as sub_id', 's.status as sub_status', 's.end_date',
          'p.name as plan_name',
          db.raw('MIN(d.phone) as phone'),
          db.raw(`(s.end_date::date - CURRENT_DATE) as days_left`)
        )
        .orderBy(db.raw('s.end_date::date'))
        .limit(20),
      // Recent activity: last 10 dealer signups + renewals
      db.raw(`
        (SELECT 'new_dealer' AS type, d.name AS label, d.created_at AS ts FROM dealers d ORDER BY d.created_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'payment' AS type,
          CONCAT(d.name, ' — ', TO_CHAR(sp.amount, 'FM৳999,999')) AS label,
          sp.created_at AS ts
         FROM subscription_payments sp JOIN dealers d ON d.id = sp.dealer_id
         WHERE sp.payment_status = 'paid'
         ORDER BY sp.created_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'renewal' AS type,
          CONCAT(d.name, ' renewed') AS label,
          s.created_at AS ts
         FROM subscriptions s JOIN dealers d ON d.id = s.dealer_id
         WHERE s.status = 'active'
         ORDER BY s.created_at DESC LIMIT 5)
        ORDER BY ts DESC LIMIT 12
      `),
      // Last 6 months revenue
      db.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', gs.m), 'Mon YY') AS month,
          COALESCE(SUM(sp.amount) FILTER (WHERE sp.payment_status IN ('paid','partial')), 0) AS collected,
          COALESCE((SELECT SUM(p2.price_monthly) FROM subscriptions s2 JOIN plans p2 ON p2.id = s2.plan_id
           WHERE s2.status = 'active' AND s2.start_date::date <= (gs.m + INTERVAL '1 month - 1 day')::date
             AND (s2.end_date IS NULL OR s2.end_date::date >= gs.m::date)), 0) AS expected
        FROM generate_series(
          DATE_TRUNC('month', NOW()) - INTERVAL '5 months',
          DATE_TRUNC('month', NOW()),
          '1 month'
        ) AS gs(m)
        LEFT JOIN subscription_payments sp ON DATE_TRUNC('month', sp.payment_date) = gs.m
        GROUP BY gs.m ORDER BY gs.m
      `),
      // Plan distribution
      db('subscriptions as s')
        .join('plans as p', 'p.id', 's.plan_id')
        .where('s.status', 'active')
        .groupBy('p.name')
        .select('p.name', db.raw('COUNT(*) as count')),
      // Payment method totals this month
      db('subscription_payments')
        .where('payment_status', 'paid')
        .whereRaw(`DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE)`)
        .groupBy('payment_method')
        .select('payment_method', db.raw('SUM(amount) as total')),
    ]);

    return res.json({
      kpi: kpi.rows[0],
      alertDealers,
      recentActivity: recentActivity.rows,
      monthlyRevenue: monthlyRevenue.rows,
      planDistribution: planDist,
      paymentTotals,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/cron/trial-day5-reminders — 2 days left on trial. */
cronRouter.post('/trial-day5-reminders', cronGuard, async (_req: Request, res: Response) => {
  try {
    return res.json(await sendTrialDay5Reminders());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Trial Day 5 reminders failed' });
  }
});

/** POST /api/admin/cron/trial-day7-reminders — trial ends today. */
cronRouter.post('/trial-day7-reminders', cronGuard, async (_req: Request, res: Response) => {
  try {
    return res.json(await sendTrialDay7Reminders());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Trial Day 7 reminders failed' });
  }
});

/** POST /api/admin/cron/trial-reminders — run Day 5 + Day 7 together. */
cronRouter.post('/trial-reminders', cronGuard, async (_req: Request, res: Response) => {
  try {
    return res.json(await sendAllTrialReminders());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Trial reminders failed' });
  }
});

/** POST /api/admin/cron/expire-trials — mark overdue trials expired + send WhatsApp. */
cronRouter.post('/expire-trials', cronGuard, async (_req: Request, res: Response) => {
  try {
    return res.json(await runTrialExpiry());
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Trial expiry failed' });
  }
});

export { cronRouter };
export default router;
