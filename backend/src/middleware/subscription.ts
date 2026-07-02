import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';

/**
 * Server-side subscription enforcement.
 *
 * Previously subscription expiry was enforced ONLY in the browser
 * (ProtectedRoute / useSubscriptionGuard), so a dealer with an unexpired JWT
 * could keep mutating data via direct API calls after their subscription
 * lapsed. This middleware closes that hole on the server, using the Postgres
 * server clock (never the client clock).
 *
 * Policy:
 *   - Read-only requests (GET/HEAD/OPTIONS) are always allowed, so an expired
 *     dealer can still view data and reach the renewal flow.
 *   - State-changing requests are blocked (HTTP 402) when the dealer's
 *     subscription is missing, suspended, cancelled, or expired beyond grace.
 *   - super_admin always bypasses.
 *   - Auth / subscription-self-service / health / plans endpoints stay open so
 *     an expired dealer can log in, view plans, and renew.
 *
 * Must run AFTER token decoding (optionalAuth) so req.user is populated. Fails
 * OPEN on infrastructure error to avoid locking out paying customers during a
 * transient DB hiccup.
 */

const GRACE_DAYS = 3;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Path prefixes that must remain writable even without an active subscription.
const OPEN_PREFIXES = [
  '/api/auth',
  '/api/subscription', // status + dealer self-service renewal (and SA /subscriptions)
  '/api/health',
  '/api/plans',
];

export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const path = req.originalUrl.split('?')[0];
    if (OPEN_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p))) {
      next();
      return;
    }

    const roles = req.user?.roles ?? [];
    if (roles.includes('super_admin')) {
      next();
      return;
    }

    const dealerId = req.user?.dealerId;
    if (!dealerId) {
      // Unauthenticated or no dealer scope — let the route's own authenticate /
      // tenantGuard produce the correct 401/403.
      next();
      return;
    }

    const sub = await db('subscriptions')
      .where({ dealer_id: dealerId })
      .orderBy('start_date', 'desc')
      .orderBy('created_at', 'desc')
      .first();

    if (!sub) {
      res.status(402).json({
        error: 'No active subscription. Please subscribe to continue.',
        code: 'SUBSCRIPTION_REQUIRED',
      });
      return;
    }
    if (sub.status === 'suspended') {
      res.status(402).json({
        error: 'Your subscription is suspended. Please contact support.',
        code: 'SUBSCRIPTION_SUSPENDED',
      });
      return;
    }
    if (sub.status === 'cancelled') {
      res.status(402).json({
        error: 'Your subscription has been cancelled. Please renew to continue.',
        code: 'SUBSCRIPTION_CANCELLED',
      });
      return;
    }

    // Expiry via server clock; allow a short grace window past end_date.
    const result = await db.raw(`SELECT (DATE(?::date) - CURRENT_DATE)::int AS days_remaining`, [
      sub.end_date,
    ]);
    const daysRemaining: number = result.rows?.[0]?.days_remaining ?? -9999;
    if (daysRemaining < -GRACE_DAYS) {
      res.status(402).json({
        error: 'Your subscription has expired. Please renew to continue.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
      return;
    }

    next();
  } catch (err: any) {
    // Fail open — never lock out a paying dealer because of a DB hiccup.
    console.error('[requireActiveSubscription]', err?.message);
    next();
  }
}
