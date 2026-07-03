/**
 * Subscription-expiry reminders — fires N days before a dealer's subscription
 * end_date across SMS, WhatsApp and Email (each channel toggleable by Super
 * Admin via reminder_settings).
 *
 * Covers ALL active subscriptions (paid + free trial), one per dealer.
 *
 * Cron:
 *   npm run cron:expiry-reminders
 *
 * API (super_admin):
 *   GET  /api/admin/reminders/settings
 *   PUT  /api/admin/reminders/settings
 *   GET  /api/admin/reminders/upcoming?days=7
 *   POST /api/admin/reminders/run
 *   POST /api/admin/reminders/send/:dealerId
 */
import { env } from '../config/env';
import { db } from '../db/connection';
import { sendEmail, sendSms, sendWhatsApp } from './notificationService';

const SUPPORT_PHONE = '01674533303';
const APP_URL = 'https://app.sanitileserp.com';
const REMINDER_TYPE = 'subscription_expiry_reminder';

export interface ReminderSettings {
  enabled: boolean;
  days_before: number;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  updated_at?: string;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: true,
  days_before: 2,
  sms_enabled: true,
  whatsapp_enabled: true,
  email_enabled: false,
};

export interface ChannelConfigStatus {
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
}

export interface ExpiryCandidate {
  subscription_id: string;
  dealer_id: string;
  end_date: string;
  status: string;
  business_name: string;
  plan_name: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
}

export interface UpcomingExpiry extends ExpiryCandidate {
  days_left: number;
  reminder_sent: boolean;
}

export interface ReminderSendResult {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  details: {
    dealer_id: string;
    business_name: string;
    sms: boolean;
    whatsapp: boolean;
    email: boolean;
  }[];
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const row = await db('reminder_settings').where({ id: true }).first();
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      enabled: !!row.enabled,
      days_before: Number(row.days_before ?? 2),
      sms_enabled: !!row.sms_enabled,
      whatsapp_enabled: !!row.whatsapp_enabled,
      email_enabled: !!row.email_enabled,
      updated_at:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateReminderSettings(
  patch: Partial<Omit<ReminderSettings, 'updated_at'>>,
): Promise<ReminderSettings> {
  const update: Record<string, unknown> = { updated_at: db.fn.now() };
  if (typeof patch.enabled === 'boolean') update.enabled = patch.enabled;
  if (typeof patch.sms_enabled === 'boolean') update.sms_enabled = patch.sms_enabled;
  if (typeof patch.whatsapp_enabled === 'boolean') update.whatsapp_enabled = patch.whatsapp_enabled;
  if (typeof patch.email_enabled === 'boolean') update.email_enabled = patch.email_enabled;
  if (patch.days_before != null) {
    const n = Math.max(0, Math.min(30, Math.trunc(Number(patch.days_before))));
    if (!Number.isNaN(n)) update.days_before = n;
  }

  // Upsert the single row.
  const exists = await db('reminder_settings').where({ id: true }).first('id');
  if (exists) {
    await db('reminder_settings').where({ id: true }).update(update);
  } else {
    await db('reminder_settings').insert({ id: true, ...update });
  }
  return getReminderSettings();
}

/** Which channels actually have working credentials configured (env). */
export function getChannelConfigStatus(): ChannelConfigStatus {
  return {
    sms: Boolean(env.BULKSMSBD_API_KEY && env.BULKSMSBD_SENDER_ID),
    whatsapp: Boolean(env.WASENDER_API_TOKEN),
    email: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  };
}

// ── Candidate discovery ─────────────────────────────────────────────────────

/**
 * Active subscriptions whose end_date is exactly `daysBefore` days out, one row
 * per dealer (latest subscription), excluding any already reminded for that
 * subscription. Used by the cron / manual "run now".
 */
async function findDueCandidates(daysBefore: number): Promise<ExpiryCandidate[]> {
  const result = await db.raw(
    `
    SELECT DISTINCT ON (s.dealer_id)
      s.id::text          AS subscription_id,
      s.dealer_id::text   AS dealer_id,
      s.end_date::text    AS end_date,
      s.status::text      AS status,
      d.name              AS business_name,
      pl.name             AS plan_name,
      pr.name             AS owner_name,
      COALESCE(ns.owner_email, pr.email) AS owner_email,
      COALESCE(ns.owner_phone, d.phone)  AS owner_phone
    FROM subscriptions s
    INNER JOIN dealers d ON d.id = s.dealer_id
    LEFT JOIN plans pl ON pl.id = s.plan_id
    LEFT JOIN profiles pr ON pr.dealer_id = d.id
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'dealer_admin'
    LEFT JOIN notification_settings ns ON ns.dealer_id = d.id
    WHERE d.status = 'active'
      AND s.status = 'active'
      AND s.end_date IS NOT NULL
      AND s.end_date = (CURRENT_DATE + (? * INTERVAL '1 day'))::date
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.dealer_id = s.dealer_id
          AND n.type = ?
          AND n.status = 'sent'
          AND n.payload->>'subscription_id' = s.id::text
      )
    ORDER BY s.dealer_id, s.created_at DESC
  `,
    [daysBefore, REMINDER_TYPE],
  );
  return (result.rows ?? []) as ExpiryCandidate[];
}

/**
 * All active subscriptions expiring within the next `days` days (for the UI),
 * one row per dealer, with days_left and whether a reminder was already sent.
 */
export async function getUpcomingExpiries(days = 7): Promise<UpcomingExpiry[]> {
  const window = Math.max(0, Math.min(60, Math.trunc(days)));
  const result = await db.raw(
    `
    SELECT DISTINCT ON (s.dealer_id)
      s.id::text          AS subscription_id,
      s.dealer_id::text   AS dealer_id,
      s.end_date::text    AS end_date,
      s.status::text      AS status,
      (s.end_date - CURRENT_DATE) AS days_left,
      d.name              AS business_name,
      pl.name             AS plan_name,
      pr.name             AS owner_name,
      COALESCE(ns.owner_email, pr.email) AS owner_email,
      COALESCE(ns.owner_phone, d.phone)  AS owner_phone,
      EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.dealer_id = s.dealer_id
          AND n.type = ?
          AND n.status = 'sent'
          AND n.payload->>'subscription_id' = s.id::text
      ) AS reminder_sent
    FROM subscriptions s
    INNER JOIN dealers d ON d.id = s.dealer_id
    LEFT JOIN plans pl ON pl.id = s.plan_id
    LEFT JOIN profiles pr ON pr.dealer_id = d.id
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'dealer_admin'
    LEFT JOIN notification_settings ns ON ns.dealer_id = d.id
    WHERE d.status = 'active'
      AND s.status = 'active'
      AND s.end_date IS NOT NULL
      AND s.end_date >= CURRENT_DATE
      AND s.end_date <= (CURRENT_DATE + (? * INTERVAL '1 day'))::date
    ORDER BY s.dealer_id, s.created_at DESC
  `,
    [REMINDER_TYPE, window],
  );

  return (result.rows ?? []).map((r: any) => ({
    ...r,
    days_left: Number(r.days_left),
    reminder_sent: !!r.reminder_sent,
  })) as UpcomingExpiry[];
}

// ── Message templates ───────────────────────────────────────────────────────

function buildSmsBody(c: ExpiryCandidate, daysLeft: number): string {
  const name = c.owner_name?.trim() || 'ভাই';
  const left =
    daysLeft <= 0 ? 'আজ শেষ' : `আর ${daysLeft} দিন বাকি`;
  return (
    `${name}, SaniTiles ERP subscription ${left} (${c.business_name}).\n` +
    `Expiry: ${c.end_date}. Renew করতে: ${APP_URL}/subscription\n` +
    `সাহায্য/পেমেন্ট: ${SUPPORT_PHONE}\n\nTiles & Sanitary ERP`
  );
}

function buildWhatsAppBody(c: ExpiryCandidate, daysLeft: number): string {
  const name = c.owner_name?.trim() || 'there';
  const left = daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  return (
    `*SaniTiles ERP — Subscription Reminder*\n\n` +
    `Hello ${name},\n` +
    `Your subscription for *${c.business_name}*${c.plan_name ? ` (${c.plan_name})` : ''} ` +
    `expires *${left}* on *${c.end_date}*.\n\n` +
    `Renew to avoid interruption: ${APP_URL}/subscription\n` +
    `Pay via bKash/Nagad or get help: ${SUPPORT_PHONE}\n\n` +
    `— Tiles & Sanitary ERP`
  );
}

function buildEmail(c: ExpiryCandidate, daysLeft: number): { subject: string; text: string } {
  const name = c.owner_name?.trim() || 'there';
  const left = daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  return {
    subject:
      daysLeft <= 0
        ? `Your SaniTiles ERP subscription expires today`
        : `Your SaniTiles ERP subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    text:
      `Dear ${name},\n\n` +
      `Your subscription for "${c.business_name}"${c.plan_name ? ` (${c.plan_name} plan)` : ''} ` +
      `expires ${left} on ${c.end_date}.\n\n` +
      `To keep your account active without interruption:\n` +
      `  1. Open Subscription: ${APP_URL}/subscription\n` +
      `  2. Choose a plan and submit a renewal request\n` +
      `  3. Pay via bKash/Nagad: ${SUPPORT_PHONE}\n` +
      `  4. Send us your Transaction ID — we activate within a few hours\n\n` +
      `Questions? Call or WhatsApp +880 ${SUPPORT_PHONE.slice(1)}.\n\n` +
      `Best regards,\nTiles & Sanitary ERP Team`,
  };
}

// ── Send ────────────────────────────────────────────────────────────────────

async function logNotification(
  dealerId: string,
  channel: 'sms' | 'whatsapp' | 'email',
  subscriptionId: string,
  daysBefore: number,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    await db('notifications').insert({
      dealer_id: dealerId,
      channel,
      type: REMINDER_TYPE,
      payload: { subscription_id: subscriptionId, days_before: daysBefore },
      status: success ? 'sent' : 'failed',
      error_message: errorMessage ?? null,
      sent_at: success ? new Date() : null,
    });
  } catch (err) {
    console.warn(`[${REMINDER_TYPE}] notification log failed:`, (err as Error).message);
  }
}

async function sendToCandidate(
  c: ExpiryCandidate,
  settings: ReminderSettings,
  daysLeft: number,
): Promise<{ sms: boolean; whatsapp: boolean; email: boolean; attempted: boolean }> {
  const hasPhone = Boolean(c.owner_phone?.trim());
  const hasEmail = Boolean(c.owner_email?.trim());

  let sms = false;
  let whatsapp = false;
  let email = false;
  let attempted = false;

  if (settings.sms_enabled && hasPhone) {
    attempted = true;
    sms = await sendSms({ to: c.owner_phone!, message: buildSmsBody(c, daysLeft) });
    await logNotification(c.dealer_id, 'sms', c.subscription_id, settings.days_before, sms);
  }
  if (settings.whatsapp_enabled && hasPhone) {
    attempted = true;
    whatsapp = await sendWhatsApp({ to: c.owner_phone!, text: buildWhatsAppBody(c, daysLeft) });
    await logNotification(c.dealer_id, 'whatsapp', c.subscription_id, settings.days_before, whatsapp);
  }
  if (settings.email_enabled && hasEmail) {
    attempted = true;
    const mail = buildEmail(c, daysLeft);
    email = await sendEmail({ to: c.owner_email!, subject: mail.subject, text: mail.text });
    await logNotification(c.dealer_id, 'email', c.subscription_id, settings.days_before, email);
  }

  return { sms, whatsapp, email, attempted };
}

/**
 * Run the daily expiry reminder for all dealers due `days_before` days from now.
 * Honors the reminder_settings toggles. Idempotent per subscription (a sent
 * reminder is recorded in `notifications` and won't be re-sent).
 */
export async function sendExpiryReminders(): Promise<ReminderSendResult> {
  const settings = await getReminderSettings();
  const out: ReminderSendResult = { scanned: 0, sent: 0, skipped: 0, failed: 0, details: [] };

  if (!settings.enabled) {
    console.log('[expiry-reminders] disabled — skipping run');
    return out;
  }

  const candidates = await findDueCandidates(settings.days_before);
  out.scanned = candidates.length;

  for (const c of candidates) {
    const r = await sendToCandidate(c, settings, settings.days_before);
    if (!r.attempted) {
      out.skipped++;
      continue;
    }
    if (r.sms || r.whatsapp || r.email) {
      out.sent++;
      out.details.push({
        dealer_id: c.dealer_id,
        business_name: c.business_name,
        sms: r.sms,
        whatsapp: r.whatsapp,
        email: r.email,
      });
    } else {
      out.failed++;
    }
  }

  console.log(
    `[expiry-reminders] scanned=${out.scanned} sent=${out.sent} skipped=${out.skipped} failed=${out.failed}`,
  );
  return out;
}

/**
 * Manually send the reminder to a single dealer's current active subscription,
 * regardless of how many days remain (Super Admin "Send now"). Still honors the
 * channel toggles and records to `notifications`.
 */
export async function sendReminderToDealer(
  dealerId: string,
  channelOverride: 'sms' | 'whatsapp' | 'email' | 'all' = 'all',
): Promise<{
  ok: boolean;
  sms: boolean;
  whatsapp: boolean;
  email: boolean;
  message?: string;
}> {
  const base = await getReminderSettings();
  // Apply channel override: force only the requested channel on, others off
  const settings: ReminderSettings = channelOverride === 'all' ? base : {
    ...base,
    sms_enabled: channelOverride === 'sms',
    whatsapp_enabled: channelOverride === 'whatsapp',
    email_enabled: channelOverride === 'email',
  };
  const result = await db.raw(
    `
    SELECT
      s.id::text          AS subscription_id,
      s.dealer_id::text   AS dealer_id,
      s.end_date::text    AS end_date,
      s.status::text      AS status,
      (s.end_date - CURRENT_DATE) AS days_left,
      d.name              AS business_name,
      pl.name             AS plan_name,
      pr.name             AS owner_name,
      COALESCE(ns.owner_email, pr.email) AS owner_email,
      COALESCE(ns.owner_phone, d.phone)  AS owner_phone
    FROM subscriptions s
    INNER JOIN dealers d ON d.id = s.dealer_id
    LEFT JOIN plans pl ON pl.id = s.plan_id
    LEFT JOIN profiles pr ON pr.dealer_id = d.id
    LEFT JOIN user_roles ur ON ur.user_id = pr.id AND ur.role = 'dealer_admin'
    LEFT JOIN notification_settings ns ON ns.dealer_id = d.id
    WHERE s.dealer_id = ?
      AND s.end_date IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT 1
  `,
    [dealerId],
  );

  const row = (result.rows ?? [])[0] as (ExpiryCandidate & { days_left: number }) | undefined;
  if (!row) {
    return { ok: false, sms: false, whatsapp: false, email: false, message: 'No active subscription for this dealer' };
  }

  const r = await sendToCandidate(row, settings, Number(row.days_left));
  if (!r.attempted) {
    return {
      ok: false,
      sms: false,
      whatsapp: false,
      email: false,
      message: 'No enabled channel had a usable contact (phone/email)',
    };
  }
  return { ok: r.sms || r.whatsapp || r.email, sms: r.sms, whatsapp: r.whatsapp, email: r.email };
}
