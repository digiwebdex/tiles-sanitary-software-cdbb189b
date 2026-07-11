import { db } from '../db/connection';

/**
 * V2 Sprint 3C — "Reservation Expiry" sweep.
 *
 * `expire_stale_reservations(dealerId)` (ported to VPS in migration 087) is
 * per-dealer and callable manually via POST /api/reservations/expire-stale.
 * This wraps it for a single cron-triggered sweep across every dealer that
 * has reservations enabled, mirroring the existing trialExpiryService.ts
 * pattern (one function, called by one cron-guarded route in adminStats.ts).
 */
export async function runReservationExpirySweep(): Promise<{ dealersSwept: number; totalExpired: number }> {
  const dealers = await db('dealers').where({ enable_reservations: true }).select('id');

  let totalExpired = 0;
  for (const dealer of dealers) {
    const r = await db.raw(`select expire_stale_reservations(?::uuid) as n`, [dealer.id]);
    totalExpired += Number(r?.rows?.[0]?.n ?? 0);
  }

  return { dealersSwept: dealers.length, totalExpired };
}
