/**
 * Auto-expires trial subscriptions whose end_date has passed.
 * Sets status = 'expired', logs to notifications, sends WhatsApp renewal notice.
 *
 * Run daily via cron or POST /api/admin/cron/expire-trials
 */
import { db } from '../db/connection';
import { sendWhatsApp } from './notificationService';

const APP_URL = 'https://app.sanitileserp.com';
const SUPPORT_PHONE = '01674533303';
const NOTIF_TYPE = 'trial_auto_expired';

export interface TrialExpiryResult {
  scanned: number;
  expired: number;
  notified: number;
  already_notified: number;
  details: { dealer_id: string; dealer_name: string; end_date: string; notified: boolean }[];
}

export async function runTrialExpiry(): Promise<TrialExpiryResult> {
  const out: TrialExpiryResult = {
    scanned: 0,
    expired: 0,
    notified: 0,
    already_notified: 0,
    details: [],
  };

  // Find all active trial subscriptions whose end_date has already passed
  const expired = await db.raw(`
    SELECT
      s.id AS subscription_id,
      s.dealer_id,
      s.end_date::text AS end_date,
      d.name AS dealer_name,
      COALESCE(ns.owner_phone, d.phone) AS phone
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN dealers d ON d.id = s.dealer_id
    LEFT JOIN notification_settings ns ON ns.dealer_id = d.id
    WHERE s.status = 'active'
      AND (p.is_trial = true OR p.price_monthly = 0)
      AND s.end_date::date < CURRENT_DATE
  `);

  out.scanned = expired.rows.length;

  for (const row of expired.rows) {
    // Mark subscription expired
    await db('subscriptions')
      .where({ id: row.subscription_id })
      .update({ status: 'expired' });
    out.expired++;

    // Check if we already sent the expiry notification for this subscription
    const alreadyNotified = await db('notifications')
      .where({
        dealer_id: row.dealer_id,
        type: NOTIF_TYPE,
        status: 'sent',
      })
      .whereRaw(`payload->>'subscription_id' = ?`, [row.subscription_id])
      .first();

    if (alreadyNotified) {
      out.already_notified++;
      out.details.push({
        dealer_id: row.dealer_id,
        dealer_name: row.dealer_name,
        end_date: row.end_date,
        notified: false,
      });
      continue;
    }

    // Send WhatsApp renewal notification
    let sent = false;
    if (row.phone) {
      const expiredDate = new Date(row.end_date).toLocaleDateString('bn-BD', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const msg =
        `⛔ *${row.dealer_name}* — আপনার Free Trial মেয়াদ শেষ!\n\n` +
        `মেয়াদ শেষ: ${expiredDate}\n\n` +
        `আপনার ব্যবসার ডেটা সুরক্ষিত রাখতে এখনই সাবস্ক্রিপশন নবায়ন করুন:\n` +
        `🔗 ${APP_URL}/subscription\n\n` +
        `সাহায্যের জন্য কল করুন: ${SUPPORT_PHONE}\n\n` +
        `_Tiles & Sanitary ERP_`;
      try {
        await sendWhatsApp({ to: row.phone, text: msg });
        sent = true;
      } catch (err: any) {
        console.warn(`[trial-expiry] WhatsApp failed for ${row.dealer_id}:`, err?.message);
      }
    }

    // Log notification
    try {
      await db('notifications').insert({
        dealer_id: row.dealer_id,
        channel: 'whatsapp',
        type: NOTIF_TYPE,
        payload: { subscription_id: row.subscription_id, end_date: row.end_date },
        status: sent ? 'sent' : 'failed',
        error_message: sent ? null : 'No phone or WhatsApp send failed',
        sent_at: sent ? new Date() : null,
      });
    } catch (logErr: any) {
      console.warn('[trial-expiry] notification log failed:', logErr?.message);
    }

    if (sent) out.notified++;
    out.details.push({
      dealer_id: row.dealer_id,
      dealer_name: row.dealer_name,
      end_date: row.end_date,
      notified: sent,
    });
  }

  console.log(
    `[trial-expiry] scanned=${out.scanned} expired=${out.expired} notified=${out.notified} already_notified=${out.already_notified}`,
  );
  return out;
}
