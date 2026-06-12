import { db } from '../db/connection';
import { env } from '../config/env';
import { sendEmail, sendSms } from '../services/notificationService';

async function superAdminContacts(): Promise<{ email: string; phone: string }[]> {
  const contacts: { email: string; phone: string }[] = [];
  if (env.ADMIN_EMAIL) contacts.push({ email: env.ADMIN_EMAIL, phone: env.ADMIN_PHONE || '' });
  if (env.ADMIN_PHONE && !contacts.some((c) => c.phone === env.ADMIN_PHONE)) {
    contacts.push({ email: env.ADMIN_EMAIL || '', phone: env.ADMIN_PHONE });
  }

  const admins = await db('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .where('ur.role', 'super_admin')
    .where('u.status', 'active')
    .select('u.email')
    .limit(5);

  for (const row of admins as { email?: string }[]) {
    if (row.email && !contacts.some((c) => c.email === row.email)) {
      contacts.push({ email: row.email, phone: env.ADMIN_PHONE || '' });
    }
  }
  return contacts;
}

export async function notifyRenewalPaymentSubmitted(input: {
  dealerName: string;
  dealerEmail: string;
  dealerPhone: string;
  planName: string;
  billingCycle: string;
  amount: number;
  paymentMethod: string;
  transactionRef?: string;
}): Promise<void> {
  const {
    dealerName,
    dealerEmail,
    dealerPhone,
    planName,
    billingCycle,
    amount,
    paymentMethod,
    transactionRef,
  } = input;

  const amountStr = `৳${amount.toLocaleString('en-BD')}`;
  const txnLine = transactionRef ? `\nTxn ID: ${transactionRef}` : '';

  const dealerSms =
    `পেমেন্ট রিকোয়েস্ট গ্রহণ হয়েছে!\n` +
    `প্ল্যান: ${planName} (${billingCycle})\n` +
    `পরিমাণ: ${amountStr}${txnLine}\n` +
    `Super Admin নিশ্চিত করলে অ্যাকাউন্ট সক্রিয় হবে।\n\n` +
    `Tiles & Sanitary ERP`;

  const dealerSubject = 'Subscription Payment Received — Awaiting Confirmation';
  const dealerText =
    `Dear ${dealerName},\n\n` +
    `We received your subscription renewal payment request.\n\n` +
    `Plan: ${planName} (${billingCycle})\n` +
    `Amount: ${amountStr}\n` +
    `Method: ${paymentMethod}${transactionRef ? `\nTransaction ID: ${transactionRef}` : ''}\n\n` +
    `Our team will verify the payment and activate your account shortly. ` +
    `You will receive SMS and email once your account is active.\n\n` +
    `Tiles & Sanitary ERP Team`;

  const adminSms =
    `নতুন সাবস্ক্রিপশন পেমেন্ট (অপেক্ষমাণ)!\n` +
    `ডিলার: ${dealerName}\n` +
    `প্ল্যান: ${planName} (${billingCycle})\n` +
    `পরিমাণ: ${amountStr}\n` +
    `মাধ্যম: ${paymentMethod}${txnLine}\n` +
    `ফোন: ${dealerPhone}\n` +
    `ইমেইল: ${dealerEmail}`;

  const adminSubject = `Pending Subscription Payment — ${dealerName}`;
  const adminText =
    `A dealer submitted a subscription renewal payment awaiting your confirmation.\n\n` +
    `Dealer: ${dealerName}\n` +
    `Phone: ${dealerPhone}\n` +
    `Email: ${dealerEmail}\n` +
    `Plan: ${planName} (${billingCycle})\n` +
    `Amount: ${amountStr}\n` +
    `Method: ${paymentMethod}${transactionRef ? `\nTransaction ID: ${transactionRef}` : ''}\n\n` +
    `Confirm from Super Admin → Payments.`;

  const tasks: Promise<unknown>[] = [];
  if (dealerPhone) tasks.push(sendSms({ to: dealerPhone, message: dealerSms }));
  if (dealerEmail) tasks.push(sendEmail({ to: dealerEmail, subject: dealerSubject, text: dealerText }));

  const admins = await superAdminContacts();
  for (const admin of admins) {
    if (admin.phone) tasks.push(sendSms({ to: admin.phone, message: adminSms }));
    if (admin.email) tasks.push(sendEmail({ to: admin.email, subject: adminSubject, text: adminText }));
  }

  await Promise.allSettled(tasks);
}

export async function notifySubscriptionActivated(input: {
  dealerName: string;
  dealerEmail: string;
  dealerPhone: string;
  planName: string;
  endDate: string;
}): Promise<void> {
  const { dealerName, dealerEmail, dealerPhone, planName, endDate } = input;

  const sms =
    `অভিনন্দন ${dealerName}!\n` +
    `আপনার "${planName}" সাবস্ক্রিপশন সক্রিয় হয়েছে।\n` +
    `মেয়াদ: ${endDate}\n` +
    `লগইন: app.sanitileserp.com\n\n` +
    `Tiles & Sanitary ERP`;

  const subject = 'Your Subscription is Active';
  const text =
    `Dear ${dealerName},\n\n` +
    `Your subscription has been confirmed and your account is now active.\n\n` +
    `Plan: ${planName}\n` +
    `Valid until: ${endDate}\n\n` +
    `You can log in and use the full ERP:\n` +
    `  https://app.sanitileserp.com/login\n\n` +
    `Best regards,\nTiles & Sanitary ERP Team`;

  await Promise.allSettled([
    dealerPhone ? sendSms({ to: dealerPhone, message: sms }) : Promise.resolve(),
    dealerEmail ? sendEmail({ to: dealerEmail, subject, text }) : Promise.resolve(),
  ]);
}
