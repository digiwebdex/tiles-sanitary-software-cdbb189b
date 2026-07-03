/**
 * Notification dispatch service for the VPS backend.
 *
 * Channels:
 *   - SMS via BulkSMSBD (HTTP API, supports Bengali Unicode)
 *   - Email via SMTP (nodemailer)
 *
 * Both channels are best-effort: if credentials are missing or the upstream
 * call fails, the function logs a warning and returns false, but never
 * throws (so a single failed channel cannot break the calling flow such
 * as self-signup).
 *
 * Used by:
 *   - authService.register() for new-signup alerts
 *   - dealersRoutes for approval / rejection notices
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { db } from '../db/connection';

let envTransport: nodemailer.Transporter | null = null;
const dealerTransportCache = new Map<string, { transport: nodemailer.Transporter; from: string; updated_at: string }>();

function getEnvTransport(): { transport: nodemailer.Transporter; from: string } | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  if (!envTransport) {
    envTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return { transport: envTransport, from: env.SMTP_FROM || env.SMTP_USER! };
}

async function getDealerTransport(dealerId: string): Promise<{ transport: nodemailer.Transporter; from: string } | null> {
  try {
    const row = await db('dealer_smtp_settings').where({ dealer_id: dealerId, enabled: true }).first();
    if (!row) return null;
    const cacheKey = dealerId;
    const updatedAtKey = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
    const cached = dealerTransportCache.get(cacheKey);
    if (cached && cached.updated_at === updatedAtKey) {
      return { transport: cached.transport, from: cached.from };
    }
    const transport = nodemailer.createTransport({
      host: row.host,
      port: row.port ?? 587,
      secure: !!row.secure,
      auth: { user: row.username, pass: row.password },
    });
    const from = row.from_name ? `"${row.from_name}" <${row.from_email}>` : row.from_email;
    dealerTransportCache.set(cacheKey, { transport, from, updated_at: updatedAtKey });
    return { transport, from };
  } catch (err) {
    console.warn('[notify] dealer SMTP lookup failed:', (err as Error).message);
    return null;
  }
}

export function invalidateDealerSmtpCache(dealerId: string) {
  dealerTransportCache.delete(dealerId);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  dealerId?: string;
}): Promise<boolean> {
  let cfg = opts.dealerId ? await getDealerTransport(opts.dealerId) : null;
  if (!cfg) cfg = getEnvTransport();
  if (!cfg) {
    console.warn('[notify] SMTP not configured — skipping email to', opts.to);
    return false;
  }
  try {
    await cfg.transport.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    console.log('[notify] email sent to', opts.to, '—', opts.subject);
    return true;
  } catch (err) {
    console.error('[notify] email send failed to', opts.to, (err as Error).message);
    return false;
  }
}

/** Normalize a phone number to BulkSMSBD-friendly format (88 + 11 digits). */
function normalizeBdPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, '');
  if (digits.startsWith('880') && digits.length === 13) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `88${digits}`;
  if (digits.length === 10) return `880${digits}`;
  return digits; // best effort
}

export async function sendSms(opts: {
  to: string;
  message: string;
}): Promise<boolean> {
  if (!env.BULKSMSBD_API_KEY || !env.BULKSMSBD_SENDER_ID) {
    console.warn('[notify] BulkSMSBD not configured — skipping SMS to', opts.to);
    return false;
  }
  const url = env.BULKSMSBD_API_URL || 'http://bulksmsbd.net/api/smsapi';
  const number = normalizeBdPhone(opts.to);

  try {
    const params = new URLSearchParams({
      api_key: env.BULKSMSBD_API_KEY,
      type: 'text',
      number,
      senderid: env.BULKSMSBD_SENDER_ID,
      message: opts.message,
    });
    const res = await fetch(`${url}?${params.toString()}`, { method: 'GET' });
    const body = await res.text();
    if (!res.ok) {
      console.error('[notify] SMS send failed', res.status, body);
      return false;
    }
    console.log('[notify] SMS sent to', number);
    return true;
  } catch (err) {
    console.error('[notify] SMS send error to', opts.to, (err as Error).message);
    return false;
  }
}

/** Normalize a phone number to WhatsApp E.164 format (+8801XXXXXXXXX). */
function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D+/g, '');
  if (digits.startsWith('880') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+88${digits}`;
  if (digits.length === 10) return `+880${digits}`;
  return digits.startsWith('+') ? phone : `+${digits}`; // best effort
}

/**
 * Send a WhatsApp text message via WasenderAPI.
 * Best-effort: returns false on missing config / non-2xx / network error,
 * never throws. Note: the free trial is rate-limited to ~1 request/minute,
 * so callers fanning out to many recipients should pace their sends.
 */
export async function sendWhatsApp(opts: {
  to: string;
  text: string;
}): Promise<boolean> {
  if (!env.WASENDER_API_TOKEN) {
    console.warn('[notify] WasenderAPI not configured — skipping WhatsApp to', opts.to);
    return false;
  }
  const url = env.WASENDER_API_URL || 'https://wasenderapi.com/api/send-message';
  const to = normalizeE164(opts.to);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WASENDER_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, text: opts.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[notify] WhatsApp send failed', res.status, body.slice(0, 200));
      return false;
    }
    console.log('[notify] WhatsApp sent to', to);
    return true;
  } catch (err) {
    console.error('[notify] WhatsApp send error to', opts.to, (err as Error).message);
    return false;
  }
}

/**
 * Fan-out helper: fires SMS + Email to dealer and to admin in parallel.
 * Never throws — caller can ignore the result safely.
 */
export async function dispatchSignupNotifications(input: {
  dealerName: string;
  businessName: string;
  dealerPhone: string;
  dealerEmail: string;
  adminPhone?: string;
  adminEmail?: string;
}): Promise<void> {
  const { dealerName, businessName, dealerPhone, dealerEmail, adminPhone, adminEmail } = input;
  const today = new Date().toLocaleDateString('bn-BD');
  const loginUrl = 'https://sanitileserp.com/login';

  // ── Dealer messages ──────────────────────────────────────────────────
  const dealerSms =
    `স্বাগতম ${dealerName}!\n` +
    `"${businessName}" অ্যাকাউন্ট সক্রিয় হয়েছে।\n` +
    `7 দিনের ফ্রি ট্রায়াল শুরু হয়েছে।\n` +
    `লগইন: ${loginUrl}\n` +
    `TilesERP`;

  const dealerWhatsApp =
    `✅ *স্বাগতম TilesERP-তে!*\n\n` +
    `প্রিয় ${dealerName},\n` +
    `আপনার *"${businessName}"* অ্যাকাউন্ট সফলভাবে তৈরি ও সক্রিয় হয়েছে!\n\n` +
    `📦 *পরিকল্পনা:* Starter (7-দিন ফ্রি ট্রায়াল)\n` +
    `📧 *ইমেইল:* ${dealerEmail}\n` +
    `📱 *ফোন:* ${dealerPhone}\n\n` +
    `🔗 এখনই লগইন করুন: ${loginUrl}\n\n` +
    `যেকোনো সমস্যায় যোগাযোগ করুন: +880 1674 533303\n` +
    `— TilesERP Team`;

  const dealerEmailSubject = `✅ আপনার TilesERP অ্যাকাউন্ট সক্রিয় — ${businessName}`;
  const dealerEmailText =
    `Dear ${dealerName},\n\n` +
    `Your business account has been created and is ACTIVE!\n\n` +
    `Business : ${businessName}\n` +
    `Email    : ${dealerEmail}\n` +
    `Phone    : ${dealerPhone}\n` +
    `Plan     : Starter (7-day free trial)\n` +
    `Status   : ✅ Active — log in now\n\n` +
    `Login at: ${loginUrl}\n\n` +
    `Need help? Call +880 1674 533303 or reply to this email.\n\n` +
    `Best regards,\nTiles & Sanitary ERP Team`;

  // ── Admin messages ───────────────────────────────────────────────────
  const adminSms =
    `🆕 নতুন ডিলার!\n` +
    `নাম: ${dealerName}\n` +
    `ব্যবসা: ${businessName}\n` +
    `ফোন: ${dealerPhone}\n` +
    `ইমেইল: ${dealerEmail}\n` +
    `Status: Active (Trial)`;

  const adminWhatsApp =
    `🆕 *নতুন ডিলার রেজিস্ট্রেশন!*\n\n` +
    `👤 *নাম:* ${dealerName}\n` +
    `🏪 *ব্যবসা:* ${businessName}\n` +
    `📱 *ফোন:* ${dealerPhone}\n` +
    `📧 *ইমেইল:* ${dealerEmail}\n` +
    `📦 *পরিকল্পনা:* Starter Trial\n` +
    `✅ *স্ট্যাটাস:* Active\n` +
    `📅 *তারিখ:* ${today}\n\n` +
    `Super Admin: https://sanitileserp.com/super-admin`;

  const adminEmailSubject = `🆕 New Dealer — ${businessName} (Active)`;
  const adminEmailText =
    `New dealer self-signup — account is LIVE\n\n` +
    `Owner    : ${dealerName}\n` +
    `Business : ${businessName}\n` +
    `Phone    : ${dealerPhone}\n` +
    `Email    : ${dealerEmail}\n` +
    `Plan     : Starter (7-day trial)\n` +
    `Status   : Active\n` +
    `Date     : ${new Date().toISOString().split('T')[0]}\n\n` +
    `Manage at: https://sanitileserp.com/super-admin/dealers`;

  const tasks: Promise<unknown>[] = [];

  // Dealer — SMS + WhatsApp + Email
  if (dealerPhone) {
    tasks.push(sendSms({ to: dealerPhone, message: dealerSms }));
    tasks.push(sendWhatsApp({ to: dealerPhone, text: dealerWhatsApp }));
  }
  if (dealerEmail) tasks.push(sendEmail({ to: dealerEmail, subject: dealerEmailSubject, text: dealerEmailText }));

  // Admin — SMS + WhatsApp + Email
  if (adminPhone) {
    tasks.push(sendSms({ to: adminPhone, message: adminSms }));
    tasks.push(sendWhatsApp({ to: adminPhone, text: adminWhatsApp }));
  }
  if (adminEmail) tasks.push(sendEmail({ to: adminEmail, subject: adminEmailSubject, text: adminEmailText }));

  await Promise.allSettled(tasks);
}

/** Notification when SA approves a pending dealer. */
export async function dispatchApprovalNotification(input: {
  dealerName: string;
  businessName: string;
  dealerPhone: string;
  dealerEmail: string;
}): Promise<void> {
  const { dealerName, businessName, dealerPhone, dealerEmail } = input;

  const sms =
    `অভিনন্দন ${dealerName}!\n` +
    `আপনার "${businessName}" অ্যাকাউন্ট অনুমোদিত হয়েছে।\n` +
    `এখন লগইন করুন: app.sanitileserp.com\n\n` +
    `Tiles & Sanitary ERP`;

  const subject = 'Your Account is Approved — Welcome to Tiles & Sanitary ERP';
  const text =
    `Dear ${dealerName},\n\n` +
    `Great news! Your business account "${businessName}" has been approved.\n\n` +
    `You can now log in and start your 7-day free trial:\n` +
    `  https://app.sanitileserp.com/login\n\n` +
    `If you need help getting started, reply to this email or call +880 1674 533303.\n\n` +
    `Best regards,\nTiles & Sanitary ERP Team`;

  await Promise.allSettled([
    dealerPhone ? sendSms({ to: dealerPhone, message: sms }) : Promise.resolve(),
    dealerEmail ? sendEmail({ to: dealerEmail, subject, text }) : Promise.resolve(),
  ]);
}
