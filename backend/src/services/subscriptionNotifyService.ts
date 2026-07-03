/**
 * WhatsApp notifications for every subscription lifecycle event.
 * All functions are best-effort — failures are logged but never thrown.
 */
import { sendWhatsApp } from './notificationService';
import { db } from '../db/connection';

const STATUS_LABEL: Record<string, string> = {
  active: '✅ সক্রিয়',
  expired: '⛔ মেয়াদোত্তীর্ণ',
  suspended: '🚫 স্থগিত',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtAmount(n: number | string | null | undefined): string {
  return `৳${Number(n ?? 0).toLocaleString('bn-BD')}`;
}

async function send(phone: string | null | undefined, text: string): Promise<void> {
  if (!phone) return;
  sendWhatsApp({ to: phone, text }).catch((err) =>
    console.warn('[subscriptionNotify] WhatsApp failed:', err?.message),
  );
}

/** Fetch dealer name + phone from the DB. */
async function dealerInfo(dealerId: string): Promise<{ name: string; phone: string | null }> {
  const row = await db('dealers').where({ id: dealerId }).select('name', 'phone').first();
  return { name: row?.name ?? 'ব্যবহারকারী', phone: row?.phone ?? null };
}

// ── Event handlers ────────────────────────────────────────────────────────────

/** 1. Dealer submitted a payment / upgrade request */
export async function notifyPaymentSubmitted(opts: {
  dealerId: string;
  planName?: string;
  amount?: number;
  billingCycle?: string;
  refNote?: string;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  const cycleLabel = opts.billingCycle === 'yearly' ? 'বার্ষিক' : 'মাসিক';
  await send(phone,
    `📩 *পেমেন্ট রিকোয়েস্ট পাওয়া গেছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.planName ? `প্ল্যান: ${opts.planName} (${cycleLabel})\n` : '') +
    (opts.amount ? `পরিমাণ: ${fmtAmount(opts.amount)}\n` : '') +
    (opts.refNote ? `রেফারেন্স: ${opts.refNote}\n` : '') +
    `\nআমরা যাচাই করে শীঘ্রই আপনাকে জানাব। ধন্যবাদ!`,
  );
}

/** 2. SA approved the payment request → subscription activated */
export async function notifyPaymentApproved(opts: {
  dealerId: string;
  planName?: string;
  endDate?: string | null;
  reviewNote?: string;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `✅ *পেমেন্ট অনুমোদিত হয়েছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.planName ? `প্ল্যান: ${opts.planName}\n` : '') +
    `মেয়াদ শেষ: ${fmtDate(opts.endDate)}\n` +
    (opts.reviewNote ? `মন্তব্য: ${opts.reviewNote}\n` : '') +
    `\nআপনার সাবস্ক্রিপশন এখন সক্রিয়। লগইন করুন: app.sanitileserp.com`,
  );
}

/** 3. SA rejected the payment request */
export async function notifyPaymentRejected(opts: {
  dealerId: string;
  planName?: string;
  reviewNote?: string;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `❌ *পেমেন্ট রিকোয়েস্ট বাতিল হয়েছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.planName ? `প্ল্যান: ${opts.planName}\n` : '') +
    (opts.reviewNote ? `কারণ: ${opts.reviewNote}\n` : '') +
    `\nবিস্তারিত জানতে আমাদের সাথে যোগাযোগ করুন।`,
  );
}

/** 4. SA asked for more information */
export async function notifyMoreInfoNeeded(opts: {
  dealerId: string;
  reviewNote?: string;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `⚠️ *আরো তথ্য প্রয়োজন*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.reviewNote ? `প্রয়োজনীয় তথ্য: ${opts.reviewNote}\n` : '') +
    `\nঅনুগ্রহ করে উল্লিখিত তথ্য পাঠান। ধন্যবাদ!`,
  );
}

/** 5. SA manually activated the subscription */
export async function notifyManualActivated(opts: {
  dealerId: string;
  planName?: string;
  endDate?: string | null;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `✅ *সাবস্ক্রিপশন সক্রিয় করা হয়েছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.planName ? `প্ল্যান: ${opts.planName}\n` : '') +
    `মেয়াদ শেষ: ${fmtDate(opts.endDate)}\n` +
    `\nলগইন করুন: app.sanitileserp.com`,
  );
}

/** 6. SA extended the subscription */
export async function notifyExtended(opts: {
  dealerId: string;
  planName?: string;
  newEndDate?: string | null;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `📅 *সাবস্ক্রিপশন বাড়ানো হয়েছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.planName ? `প্ল্যান: ${opts.planName}\n` : '') +
    `নতুন মেয়াদ শেষ: ${fmtDate(opts.newEndDate)}\n` +
    `\nআপনার সেবা অব্যাহত রয়েছে। ধন্যবাদ!`,
  );
}

/** 7. SA suspended the account */
export async function notifySuspended(opts: {
  dealerId: string;
  reason?: string;
}): Promise<void> {
  const { name, phone } = await dealerInfo(opts.dealerId);
  await send(phone,
    `⛔ *অ্যাকাউন্ট স্থগিত করা হয়েছে*\n` +
    `ব্যবসা: *${name}*\n` +
    (opts.reason ? `কারণ: ${opts.reason}\n` : '') +
    `\nবিস্তারিত জানতে আমাদের সাথে যোগাযোগ করুন।`,
  );
}

/** 8. Trial ended / skipped */
export async function notifyTrialEnded(opts: {
  dealerId: string;
  dealerName?: string;
  phone?: string | null;
}): Promise<void> {
  const phone = opts.phone ?? (await dealerInfo(opts.dealerId)).phone;
  const name = opts.dealerName ?? (await dealerInfo(opts.dealerId)).name;
  await send(phone,
    `⏭️ *ট্রায়াল শেষ হয়েছে*\n` +
    `ব্যবসা: *${name}*\n\n` +
    `আপনার বিনামূল্যে ট্রায়াল পিরিয়ড শেষ হয়েছে।\n` +
    `প্রশ্ন: আপনার কি সব মডিউল ঠিকমতো দেখা হয়েছে? 🤔\n\n` +
    `সাবস্ক্রিপশন চালু রাখতে আমাদের সাথে যোগাযোগ করুন বা app.sanitileserp.com-এ লগইন করে আপগ্রেড করুন।`,
  );
}
