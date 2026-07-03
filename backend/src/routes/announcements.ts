/**
 * /api/announcements/active — dealer-facing.
 *
 * Returns active platform announcements targeted to the current dealer based
 * on their subscription status, respecting the start/end window. Any
 * authenticated user can read; results are filtered by audience.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Derive the dealer's audience buckets so we can match announcement targeting.
async function dealerBuckets(dealerId: string | null): Promise<Set<string>> {
  const buckets = new Set<string>(['all']);
  if (!dealerId) return buckets;

  const sub = await db('subscriptions')
    .where({ dealer_id: dealerId })
    .orderBy('start_date', 'desc')
    .first();

  if (!sub) return buckets;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = sub.end_date ? new Date(sub.end_date) : null;

  if (sub.status === 'suspended') {
    buckets.add('suspended');
  } else if (sub.status === 'active') {
    buckets.add('active');
    if (end) {
      const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
      if (days <= 7) buckets.add('expiring');
    }
  }

  // Trial detection via plan flag
  try {
    const plan = await db('plans').where({ id: sub.plan_id }).first();
    if (plan?.is_trial) buckets.add('trial');
  } catch {
    /* ignore */
  }

  return buckets;
}

router.get('/active', async (req: Request, res: Response) => {
  try {
    const dealerId = req.user?.dealerId ?? null;
    const buckets = await dealerBuckets(dealerId);

    const now = new Date();
    const rows = await db('platform_announcements')
      .where({ is_active: true })
      .where((b) => b.whereNull('start_at').orWhere('start_at', '<=', now))
      .where((b) => b.whereNull('end_at').orWhere('end_at', '>=', now))
      .orderBy('created_at', 'desc');

    const filtered = rows.filter((r: any) => buckets.has(r.audience));

    res.json({
      announcements: filtered.map((r: any) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        severity: r.severity,
        dismissible: r.dismissible,
        created_at: r.created_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
