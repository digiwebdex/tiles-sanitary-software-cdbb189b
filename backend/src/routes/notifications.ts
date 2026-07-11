/**
 * /api/notifications — idempotent SMS / WhatsApp send endpoints.
 *
 * P1 fix: double-clicking "Send SMS" or retrying after a network blip
 * used to fire the upstream send twice (and bill the dealer twice).
 * Clients now MUST supply an idempotency_key (UUID per logical action).
 * The unique index on (dealer_id, idempotency_key) guarantees that a
 * second call with the same key returns the original log row instead
 * of dispatching again.
 *
 * Endpoints:
 *   POST /api/notifications/sms       body: { to, message, idempotency_key, source_type?, source_id? }
 *   POST /api/notifications/whatsapp  body: { to, message, message_type, idempotency_key, source_type?, source_id? }
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard, requireDealer } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { sendSms, sendEmail } from '../services/notificationService';

const router = Router();
router.use(authenticate, tenantGuard);

const smsSchema = z.object({
  to: z.string().trim().min(8).max(32),
  message: z.string().trim().min(1).max(2000),
  idempotency_key: z.string().trim().min(8).max(80),
  source_type: z.string().trim().max(40).optional(),
  source_id: z.string().uuid().optional(),
});

router.post(
  '/sms',
  requireDealer,
  requireRole('dealer_admin', 'salesman'),
  async (req: Request, res: Response) => {
    try {
      const parsed = smsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
        return;
      }
      const dealerId = req.dealerId!;
      const body = parsed.data;

      // Idempotency check: if a log with the same (dealer, key) exists,
      // return it instead of dispatching again.
      const existing = await db('sms_message_logs')
        .where({ dealer_id: dealerId, idempotency_key: body.idempotency_key })
        .first();
      if (existing) {
        res.json({
          deduped: true,
          status: existing.status,
          id: existing.id,
          sent_at: existing.sent_at,
        });
        return;
      }

      // Insert the log first so the unique index protects us against
      // a parallel duplicate request firing right now.
      let logRow: any;
      try {
        [logRow] = await db('sms_message_logs')
          .insert({
            dealer_id: dealerId,
            idempotency_key: body.idempotency_key,
            to_phone: body.to,
            message: body.message,
            status: 'queued',
            source_type: body.source_type ?? null,
            source_id: body.source_id ?? null,
          })
          .returning('*');
      } catch (err: any) {
        // Unique violation = parallel request beat us to it
        if (err?.code === '23505') {
          const winner = await db('sms_message_logs')
            .where({ dealer_id: dealerId, idempotency_key: body.idempotency_key })
            .first();
          res.json({ deduped: true, status: winner?.status, id: winner?.id });
          return;
        }
        throw err;
      }

      const ok = await sendSms({ to: body.to, message: body.message });
      const finalStatus = ok ? 'sent' : 'failed';
      await db('sms_message_logs')
        .where({ id: logRow.id })
        .update({ status: finalStatus, sent_at: ok ? new Date() : null });

      res.json({ deduped: false, status: finalStatus, id: logRow.id });
    } catch (err: any) {
      console.error('[notify/sms]', err.message);
      res.status(500).json({ error: 'Failed to send SMS' });
    }
  },
);

/**
 * POST /api/notifications/sms/bulk — send one rendered message per recipient.
 *
 * Placeholders ({name}, {due}, …) are rendered server-side from each
 * recipient's vars. Idempotency: key = `${idempotency_prefix}-${phone}`,
 * so retrying the same campaign never double-sends to a customer.
 */
const bulkSmsSchema = z.object({
  idempotency_prefix: z.string().trim().min(8).max(40),
  message_template: z.string().trim().min(1).max(1000),
  recipients: z
    .array(
      z.object({
        phone: z.string().trim().min(8).max(32),
        vars: z.record(z.union([z.string(), z.number()])).default({}),
      }),
    )
    .min(1)
    .max(500),
});

function renderTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{(\w+)\}/g, (token, key: string) =>
    vars[key] === undefined || vars[key] === null ? token : String(vars[key]),
  );
}

router.post(
  '/sms/bulk',
  requireDealer,
  requireRole('dealer_admin', 'manager'),
  async (req: Request, res: Response) => {
    const parsed = bulkSmsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const dealerId = req.dealerId!;
    const { idempotency_prefix, message_template, recipients } = parsed.data;

    let sent = 0;
    let failed = 0;
    let deduped = 0;

    // Sequential on purpose: BulkSMSBD rate limits, and 500 max per call.
    for (const r of recipients) {
      const phone = r.phone.replace(/\s+/g, '');
      const message = renderTemplate(message_template, r.vars);
      const idempotencyKey = `${idempotency_prefix}-${phone}`.slice(0, 80);

      let logRow: any;
      try {
        [logRow] = await db('sms_message_logs')
          .insert({
            dealer_id: dealerId,
            idempotency_key: idempotencyKey,
            to_phone: phone,
            message,
            status: 'queued',
            source_type: 'bulk',
          })
          .returning('*');
      } catch (err: any) {
        if (err?.code === '23505') {
          deduped++;
          continue;
        }
        console.error('[notify/sms/bulk] insert failed:', err.message);
        failed++;
        continue;
      }

      try {
        const ok = await sendSms({ to: phone, message });
        await db('sms_message_logs')
          .where({ id: logRow.id })
          .update({ status: ok ? 'sent' : 'failed', sent_at: ok ? new Date() : null });
        ok ? sent++ : failed++;
      } catch (err: any) {
        console.error('[notify/sms/bulk] send failed:', err.message);
        await db('sms_message_logs')
          .where({ id: logRow.id })
          .update({ status: 'failed' })
          .catch(() => {});
        failed++;
      }
    }

    res.json({ total: recipients.length, sent, failed, deduped });
  },
);

const waSchema = z.object({
  to: z.string().trim().min(8).max(32),
  message: z.string().trim().min(1).max(4000),
  message_type: z.enum(['quotation', 'invoice', 'delivery', 'payment', 'reminder', 'general']),
  idempotency_key: z.string().trim().min(8).max(80),
  source_type: z.string().trim().max(40).optional(),
  source_id: z.string().uuid().optional(),
});

router.post(
  '/whatsapp',
  requireDealer,
  requireRole('dealer_admin', 'salesman'),
  async (req: Request, res: Response) => {
    try {
      const parsed = waSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
        return;
      }
      const dealerId = req.dealerId!;
      const body = parsed.data;

      // Pre-check
      const existing = await db('whatsapp_message_logs')
        .where({ dealer_id: dealerId, idempotency_key: body.idempotency_key })
        .first();
      if (existing) {
        res.json({ deduped: true, status: existing.status, id: existing.id });
        return;
      }

      // The actual upstream WhatsApp send is delegated to the dealer's
      // configured provider (Cloud API or wa.me link). For now we record
      // the intent atomically — the existing whatsappService finalises
      // the send. The unique index still prevents double-sends.
      let logRow: any;
      try {
        [logRow] = await db('whatsapp_message_logs')
          .insert({
            dealer_id: dealerId,
            idempotency_key: body.idempotency_key,
            to_phone: body.to,
            message_type: body.message_type,
            message_body: body.message,
            status: 'queued',
            source_type: body.source_type ?? null,
            source_id: body.source_id ?? null,
          })
          .returning('*');
      } catch (err: any) {
        if (err?.code === '23505') {
          const winner = await db('whatsapp_message_logs')
            .where({ dealer_id: dealerId, idempotency_key: body.idempotency_key })
            .first();
          res.json({ deduped: true, status: winner?.status, id: winner?.id });
          return;
        }
        // Some columns above (message_body, to_phone) might not exist on
        // every install — fall back to a minimal insert so the endpoint
        // never breaks the calling flow.
        if (err?.code === '42703') {
          [logRow] = await db('whatsapp_message_logs')
            .insert({
              dealer_id: dealerId,
              idempotency_key: body.idempotency_key,
              message_type: body.message_type,
              status: 'queued',
              source_type: body.source_type ?? null,
              source_id: body.source_id ?? null,
            })
            .returning('*');
        } else {
          throw err;
        }
      }

      res.json({ deduped: false, status: 'queued', id: logRow.id });
    } catch (err: any) {
      console.error('[notify/whatsapp]', err.message);
      res.status(500).json({ error: 'Failed to log WhatsApp send' });
    }
  },
);

// ─── Dispatch endpoint (replaces send-notification edge function) ───────────
//
// Mirrors the templating + plan-gating + status-tracking that previously
// lived in supabase/functions/send-notification.
//
// Body: { channel, type, recipient, payload }
//   channel:    'sms' | 'email'
//   type:       'sale_created' | 'daily_summary' | 'payment_reminder'
//   recipient:  phone (for sms) or email address
//   payload:    template inputs; may contain `_custom_message` to bypass templating
//
// Behavior (best-effort, never throws to caller):
//   1. Validate body
//   2. Insert a row into `notifications` with status='pending'
//   3. Check the dealer's active subscription plan for sms/email/daily_summary flags
//   4. Render the message body (or use `_custom_message` if provided)
//   5. Dispatch via SMTP / BulkSMSBD
//   6. Update the row status to sent / failed / skipped
const PUBLISHED_URL = 'https://app.sanitileserp.com';

function buildSaleMessage(payload: Record<string, unknown>, recipient: string): string {
  const inv = payload.invoice_number ?? 'N/A';
  const customer = payload.customer_name ?? 'Customer';
  const amount = payload.total_amount ?? 0;
  const paid = payload.paid_amount ?? 0;
  const due = payload.due_amount ?? 0;
  const saleId = payload.sale_id as string | undefined;
  const dealerName = payload.dealer_name as string | undefined;
  const items = payload.items as Array<{ name: string; quantity: number; unit: string; rate: number; total: number }> | undefined;
  const customerPhone = (payload.customer_phone as string | null) ?? null;
  const invoiceLink = saleId ? `\n\nInvoice: ${PUBLISHED_URL}/sales/${saleId}/invoice` : '';
  let itemsSummary = '';
  if (items && items.length > 0) {
    itemsSummary = '\n\nItems:\n' + items.map((it, i) =>
      `${i + 1}. ${it.name} - ${it.quantity} ${it.unit} x ${it.rate} = ${it.total} BDT`,
    ).join('\n');
  }
  if (customerPhone && recipient === customerPhone) {
    return `${dealerName ? dealerName + '\n' : ''}Dear ${customer},\nThank you for your purchase!\n\nInvoice: ${inv}\nDate: ${payload.sale_date ?? ''}${itemsSummary}\n\nTotal: ${amount} BDT\nPaid: ${paid} BDT\nDue: ${due} BDT${invoiceLink}`;
  }
  return `Sale Alert!\nInvoice: ${inv}\nCustomer: ${customer}${itemsSummary}\n\nAmount: ${amount} BDT\nPaid: ${paid} BDT\nDue: ${due} BDT${invoiceLink}`;
}

function buildPaymentReminderMessage(payload: Record<string, unknown>): string {
  const customer = payload.customer_name ?? 'Customer';
  const outstanding = payload.outstanding ?? 0;
  const dealerName = payload.dealer_name ?? '';
  const dealerPhone = payload.dealer_phone ?? '';
  const lastPayment = payload.last_payment_date ?? '';
  let msg = `${dealerName ? dealerName + '\n' : ''}`;
  msg += `প্রিয় ${customer},\n`;
  msg += `আপনার বকেয়া পরিমাণ: ${outstanding} BDT।\n`;
  if (lastPayment) msg += `সর্বশেষ পেমেন্ট: ${lastPayment}\n`;
  msg += `অনুগ্রহ করে যত তাড়াতাড়ি সম্ভব পেমেন্ট করুন।\n`;
  if (dealerPhone) msg += `যোগাযোগ: ${dealerPhone}`;
  return msg;
}

function buildDailySummaryMessage(payload: Record<string, unknown>): string {
  const date = payload.date ?? new Date().toISOString().split('T')[0];
  const sales = payload.total_sales ?? 0;
  const revenue = payload.total_revenue ?? 0;
  const profit = payload.total_profit ?? 0;
  return `Daily Summary (${date})\nTotal Sales: ${sales}\nRevenue: ${revenue} BDT\nProfit: ${profit} BDT`;
}

function buildEmailSubjectAndBody(
  type: string,
  payload: Record<string, unknown>,
  recipient: string,
): { subject: string; body: string } {
  if (type === 'sale_created') {
    const inv = payload.invoice_number ?? 'N/A';
    return { subject: `Invoice ${inv} - Sale Confirmation`, body: buildSaleMessage(payload, recipient) };
  }
  if (type === 'daily_summary') {
    const date = payload.date ?? new Date().toISOString().split('T')[0];
    return { subject: `Daily Business Summary - ${date}`, body: buildDailySummaryMessage(payload) };
  }
  if (type === 'payment_reminder') {
    const customer = payload.customer_name ?? 'Customer';
    return { subject: `Payment Reminder - ${customer}`, body: buildPaymentReminderMessage(payload) };
  }
  return { subject: 'Notification', body: JSON.stringify(payload) };
}

const dispatchSchema = z.object({
  channel: z.enum(['sms', 'email']),
  type: z.enum(['sale_created', 'daily_summary', 'payment_reminder']),
  recipient: z.string().trim().min(3).max(200),
  payload: z.record(z.unknown()).default({}),
});

router.post(
  '/dispatch',
  requireDealer,
  requireRole('dealer_admin', 'salesman'),
  async (req: Request, res: Response) => {
    const parsed = dispatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const dealerId = req.dealerId!;
    const { channel, type, recipient, payload } = parsed.data;

    // 1. Queue the row
    let notifId: string | null = null;
    try {
      const [row] = await db('notifications')
        .insert({
          dealer_id: dealerId,
          channel,
          type,
          payload,
          status: 'pending',
        })
        .returning('id');
      notifId = row.id;
    } catch (err: any) {
      console.warn('[notify/dispatch] queue insert failed:', err.message);
      // Continue anyway — dispatch is best-effort
    }

    // 2. Plan gating
    try {
      const sub = await db('subscriptions as s')
        .leftJoin('subscription_plans as p', 'p.id', 's.plan_id')
        .where('s.dealer_id', dealerId)
        .where('s.status', 'active')
        .orderBy('s.start_date', 'desc')
        .select('p.sms_enabled', 'p.email_enabled', 'p.daily_summary_enabled')
        .first();

      if (sub) {
        let blockedReason: string | null = null;
        if (channel === 'sms' && sub.sms_enabled === false) blockedReason = 'Plan does not include SMS';
        else if (channel === 'email' && sub.email_enabled === false) blockedReason = 'Plan does not include Email';
        else if (type === 'daily_summary' && sub.daily_summary_enabled === false) blockedReason = 'Plan does not include daily summary';

        if (blockedReason) {
          if (notifId) {
            await db('notifications').where({ id: notifId }).update({ status: 'failed', error_message: blockedReason });
          }
          res.json({ success: false, skipped: true, error: blockedReason });
          return;
        }
      }
    } catch (err: any) {
      console.warn('[notify/dispatch] plan check failed (proceeding):', err.message);
    }

    // 3. Render + dispatch
    let success = false;
    let errorMessage: string | undefined;

    try {
      if (channel === 'sms') {
        let message = '';
        if (typeof payload._custom_message === 'string') message = payload._custom_message;
        else if (type === 'sale_created') message = buildSaleMessage(payload, recipient);
        else if (type === 'daily_summary') message = buildDailySummaryMessage(payload);
        else if (type === 'payment_reminder') message = buildPaymentReminderMessage(payload);
        else message = JSON.stringify(payload);
        success = await sendSms({ to: recipient, message });
        if (!success) errorMessage = 'SMS dispatch failed';
      } else {
        let subject: string;
        let body: string;
        if (typeof payload._custom_message === 'string') {
          const date = payload.date ?? new Date().toISOString().split('T')[0];
          subject = (payload._subject as string | undefined)
            || (type === 'daily_summary' ? `Daily Business Summary - ${date}` : 'Notification');
          body = payload._custom_message;
        } else {
          const r = buildEmailSubjectAndBody(type, payload, recipient);
          subject = r.subject;
          body = r.body;
        }
        success = await sendEmail({ to: recipient, subject, text: body, dealerId });
        if (!success) errorMessage = 'Email dispatch failed';
      }
    } catch (err: any) {
      errorMessage = err.message;
      console.error('[notify/dispatch] send error:', err.message);
    }

    // 4. Update status
    if (notifId) {
      try {
        await db('notifications').where({ id: notifId }).update({
          status: success ? 'sent' : 'failed',
          error_message: errorMessage ?? null,
          sent_at: success ? new Date() : null,
        });
      } catch (err: any) {
        console.warn('[notify/dispatch] status update failed:', err.message);
      }
    }

    res.json({ success, id: notifId, error: errorMessage });
  },
);

// GET /api/notifications/settings — fetch this dealer's notification preferences
router.get(
  '/settings',
  requireDealer,
  requireRole('dealer_admin', 'salesman'),
  async (req: Request, res: Response) => {
    try {
      const row = await db('notification_settings')
        .where({ dealer_id: req.dealerId! })
        .first();
      res.json(row ?? null);
    } catch (err: any) {
      console.error('[notify/settings]', err.message);
      res.status(500).json({ error: 'Failed to fetch settings' });
    }
  },
);

export default router;
