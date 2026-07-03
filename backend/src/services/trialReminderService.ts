/**
 * Trial expiry reminders — SMS + email on Day 5 (2 days left) and Day 7 (last day).
 *
 * Cron:
 *   npm run cron:trial-day5
 *   npm run cron:trial-day7
 *   npm run cron:trial-reminders   (both)
 *
 * API (super_admin):
 *   POST /api/admin/cron/trial-day5-reminders
 *   POST /api/admin/cron/trial-day7-reminders
 */
import { db } from '../db/connection';
import { sendEmail, sendSms } from './notificationService';
import { notifyTrialEnded } from './subscriptionNotifyService';

const SUPPORT_PHONE = '01674533303';
const APP_URL = 'https://app.sanitileserp.com';

export type TrialReminderKind = 'trial_day5_reminder' | 'trial_day7_reminder';

export interface TrialReminderCandidate {
  subscription_id: string;
  dealer_id: string;
  end_date: string;
  business_name: string;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
}

export interface TrialReminderResult {
  kind: TrialReminderKind;
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  details: { dealer_id: string; business_name: string; sms: boolean; email: boolean }[];
}

interface ReminderConfig {
  kind: TrialReminderKind;
  daysBeforeExpiry: number;
  logLabel: string;
  buildSms: (ownerName: string, businessName: string, endDate: string) => string;
  buildEmail: (ownerName: string, businessName: string, endDate: string) => { subject: string; text: string };
}

async function findTrialCandidates(
  kind: TrialReminderKind,
  daysBeforeExpiry: number,
): Promise<TrialReminderCandidate[]> {
  const result = await db.raw(
    `
    SELECT DISTINCT ON (s.dealer_id)
      s.id::text AS subscription_id,
      s.dealer_id::text AS dealer_id,
      s.end_date::text AS end_date,
      d.name AS business_name,
      pr.name AS owner_name,
      COALESCE(ns.owner_email, pr.email) AS owner_email,
      COALESCE(ns.owner_phone, d.phone) AS owner_phone
    FROM subscriptions s
    INNER JOIN dealers d ON d.id = s.dealer_id
    INNER JOIN plans pl ON pl.id = s.plan_id
    LEFT JOIN profiles pr ON pr.dealer_id = d.id
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'dealer_admin'
    LEFT JOIN notification_settings ns ON ns.dealer_id = d.id
    WHERE d.status = 'active'
      AND s.end_date = (CURRENT_DATE + (? * INTERVAL '1 day'))::date
      AND s.status IN ('active', 'expired')
      AND (pl.is_trial = true OR pl.price_monthly = 0)
      AND NOT EXISTS (
        SELECT 1 FROM subscription_payments sp
        WHERE sp.dealer_id = s.dealer_id AND sp.payment_status = 'paid'
      )
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.dealer_id = s.dealer_id
          AND n.type = ?
          AND n.status = 'sent'
          AND n.payload->>'subscription_id' = s.id::text
      )
    ORDER BY s.dealer_id, s.created_at DESC
  `,
    [daysBeforeExpiry, kind],
  );

  return (result.rows ?? []) as TrialReminderCandidate[];
}

function buildDay5Sms(ownerName: string, businessName: string, endDate: string): string {
  const name = ownerName?.trim() || 'ভাই';
  return (
    `${name}, SaniTiles ERP trial — আর ২ দিন বাকি (${businessName}).\n` +
    `Trial শেষ হওয়ার আগে একটা sale complete করুন।\n` +
    `Renew: ${APP_URL}/subscription | সাহায্য: ${SUPPORT_PHONE}\n\n` +
    `Tiles & Sanitary ERP`
  );
}

function buildDay5Email(ownerName: string, businessName: string, endDate: string): {
  subject: string;
  text: string;
} {
  const name = ownerName?.trim() || 'there';
  return {
    subject: '2 Days Left on Your Free Trial',
    text:
      `Dear ${name},\n\n` +
      `Your 7-day free trial for "${businessName}" ends on ${endDate} — that's 2 days from now.\n\n` +
      `Before your trial ends, we recommend completing at least one full cycle:\n` +
      `  • Add a product → Record a purchase → Create a sale → Collect payment\n\n` +
      `Ready to continue? Open Subscription and choose a plan:\n` +
      `  ${APP_URL}/subscription\n\n` +
      `Questions? Call or WhatsApp +880 ${SUPPORT_PHONE.slice(1)}.\n\n` +
      `Best regards,\nTiles & Sanitary ERP Team`,
  };
}

function buildDay7Sms(ownerName: string, businessName: string): string {
  const name = ownerName?.trim() || 'ভাই';
  return (
    `${name}, আজ আপনার SaniTiles ERP trial শেষ (${businessName}).\n` +
    `Renew করতে bKash/Nagad: ${SUPPORT_PHONE}\n` +
    `Transaction ID পাঠান। Subscription: ${APP_URL}/subscription\n\n` +
    `Tiles & Sanitary ERP`
  );
}

function buildDay7Email(ownerName: string, businessName: string, endDate: string): {
  subject: string;
  text: string;
} {
  const name = ownerName?.trim() || 'there';
  return {
    subject: 'Your Free Trial Ends Today — Renew to Keep Your Data',
    text:
      `Dear ${name},\n\n` +
      `Your 7-day free trial for "${businessName}" ends today (${endDate}).\n\n` +
      `To continue using SaniTiles ERP without interruption:\n` +
      `  1. Open Subscription in the app: ${APP_URL}/subscription\n` +
      `  2. Choose a plan and submit an upgrade request\n` +
      `  3. Pay via bKash/Nagad: ${SUPPORT_PHONE} (or Rocket: ${SUPPORT_PHONE}3)\n` +
      `  4. Send us your Transaction ID — we activate within a few hours\n\n` +
      `You have a 3-day grace period after today if you need a little more time.\n\n` +
      `Need help? Call or WhatsApp +880 ${SUPPORT_PHONE.slice(1)}.\n\n` +
      `Best regards,\nTiles & Sanitary ERP Team`,
  };
}

const REMINDER_CONFIGS: Record<TrialReminderKind, ReminderConfig> = {
  trial_day5_reminder: {
    kind: 'trial_day5_reminder',
    daysBeforeExpiry: 2,
    logLabel: 'trial-day5',
    buildSms: buildDay5Sms,
    buildEmail: buildDay5Email,
  },
  trial_day7_reminder: {
    kind: 'trial_day7_reminder',
    daysBeforeExpiry: 0,
    logLabel: 'trial-day7',
    buildSms: (owner, business) => buildDay7Sms(owner, business),
    buildEmail: buildDay7Email,
  },
};

async function logNotification(
  kind: TrialReminderKind,
  dealerId: string,
  channel: 'sms' | 'email',
  subscriptionId: string,
  day: number,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    await db('notifications').insert({
      dealer_id: dealerId,
      channel,
      type: kind,
      payload: { subscription_id: subscriptionId, day },
      status: success ? 'sent' : 'failed',
      error_message: errorMessage ?? null,
      sent_at: success ? new Date() : null,
    });
  } catch (err) {
    console.warn(`[${kind}] notification log failed:`, (err as Error).message);
  }
}

async function sendTrialReminders(kind: TrialReminderKind): Promise<TrialReminderResult> {
  const config = REMINDER_CONFIGS[kind];
  const candidates = await findTrialCandidates(kind, config.daysBeforeExpiry);
  const day = kind === 'trial_day5_reminder' ? 5 : 7;

  const out: TrialReminderResult = {
    kind,
    scanned: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const c of candidates) {
    const hasPhone = Boolean(c.owner_phone?.trim());
    const hasEmail = Boolean(c.owner_email?.trim());

    if (!hasPhone && !hasEmail) {
      out.skipped++;
      continue;
    }

    const smsBody = config.buildSms(c.owner_name ?? '', c.business_name, c.end_date);
    const email = config.buildEmail(c.owner_name ?? '', c.business_name, c.end_date);

    let smsOk = false;
    let emailOk = false;

    if (hasPhone) {
      smsOk = await sendSms({ to: c.owner_phone!, message: smsBody });
      await logNotification(kind, c.dealer_id, 'sms', c.subscription_id, day, smsOk, smsOk ? undefined : 'SMS failed');
    }
    if (hasEmail) {
      emailOk = await sendEmail({
        to: c.owner_email!,
        subject: email.subject,
        text: email.text,
      });
      await logNotification(kind, c.dealer_id, 'email', c.subscription_id, day, emailOk, emailOk ? undefined : 'Email failed');
    }

    // WhatsApp notification on Day 7 (trial ends today)
    if (day === 7 && hasPhone) {
      await notifyTrialEnded({
        dealerId: c.dealer_id,
        dealerName: c.business_name,
        phone: c.owner_phone,
      });
    }

    if (smsOk || emailOk) {
      out.sent++;
      out.details.push({
        dealer_id: c.dealer_id,
        business_name: c.business_name,
        sms: smsOk,
        email: emailOk,
      });
    } else {
      out.failed++;
    }
  }

  console.log(
    `[${config.logLabel}] scanned=${out.scanned} sent=${out.sent} skipped=${out.skipped} failed=${out.failed}`,
  );
  return out;
}

/** Day 5 — trial ends in 2 days. */
export async function sendTrialDay5Reminders(): Promise<TrialReminderResult> {
  return sendTrialReminders('trial_day5_reminder');
}

/** Day 7 — trial ends today. */
export async function sendTrialDay7Reminders(): Promise<TrialReminderResult> {
  return sendTrialReminders('trial_day7_reminder');
}

/** Run both Day 5 and Day 7 reminders (daily cron convenience). */
export async function sendAllTrialReminders(): Promise<TrialReminderResult[]> {
  return Promise.all([sendTrialDay5Reminders(), sendTrialDay7Reminders()]);
}
