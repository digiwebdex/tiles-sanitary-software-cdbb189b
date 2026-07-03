/**
 * Dealer Subscription Payment Requests
 *
 * Dealer routes  (require dealer_admin):
 *   POST   /api/payment-requests          — submit a payment proof
 *   GET    /api/payment-requests          — list own requests
 *
 * Super Admin routes (require super_admin):
 *   GET    /api/payment-requests/sa/all   — list all dealers' requests
 *   PATCH  /api/payment-requests/sa/:id   — approve or reject
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { env } from '../config/env';
import { sendWhatsApp, sendEmail } from '../services/notificationService';
import { recordSaAudit } from '../services/saAuditService';

const router = Router();
router.use(authenticate);

// ── Validation ───────────────────────────────────────────────────────────────
const submitSchema = z.object({
  amount:         z.number().positive(),
  payment_method: z.enum(['bkash', 'nagad', 'bank', 'cash', 'ssl']),
  transaction_id: z.string().max(200).optional().nullable(),
  screenshot_url: z.string().url().max(500).optional().nullable(),
  note:           z.string().max(1000).optional().nullable(),
});

const reviewSchema = z.object({
  status:      z.enum(['approved', 'rejected']),
  review_note: z.string().max(1000).optional().nullable(),
});

// ── DEALER: submit ───────────────────────────────────────────────────────────
router.post('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const body = submitSchema.parse(req.body);
    const dealerId = req.user?.dealerId;
    if (!dealerId) { res.status(403).json({ error: 'No dealer account' }); return; }

    // Fetch dealer info for notification
    const dealer = await db('dealers as d')
      .where('d.id', dealerId)
      .leftJoin('profiles as p', function () {
        this.on('p.dealer_id', 'd.id').on('p.id', req.user!.userId);
      })
      .select('d.name as dealer_name', 'd.phone as dealer_phone', 'p.name as admin_name')
      .first();

    const [row] = await db('dealer_payment_requests')
      .insert({
        dealer_id:      dealerId,
        amount:         body.amount,
        payment_method: body.payment_method,
        transaction_id: body.transaction_id ?? null,
        screenshot_url: body.screenshot_url ?? null,
        note:           body.note ?? null,
        status:         'pending',
      })
      .returning('*');

    // Notify Super Admin via WhatsApp (best-effort)
    const methodLabel: Record<string, string> = {
      bkash: 'bKash', nagad: 'Nagad', bank: 'Bank Transfer', cash: 'Cash', ssl: 'SSLCommerz',
    };
    const waMsg =
      `💰 *নতুন পেমেন্ট রিকোয়েস্ট!*\n\n` +
      `🏪 *ডিলার:* ${dealer?.dealer_name ?? 'Unknown'}\n` +
      `👤 *অ্যাডমিন:* ${dealer?.admin_name ?? '—'}\n` +
      `📱 *ফোন:* ${dealer?.dealer_phone ?? '—'}\n\n` +
      `💵 *পরিমাণ:* ৳${Number(body.amount).toLocaleString('en-BD')}\n` +
      `💳 *মাধ্যম:* ${methodLabel[body.payment_method] ?? body.payment_method}\n` +
      (body.transaction_id ? `🔖 *Txn ID:* ${body.transaction_id}\n` : '') +
      (body.note ? `📝 *নোট:* ${body.note}\n` : '') +
      `\n🔗 রিভিউ করুন: https://app.sanitileserp.com/super-admin/payment-requests`;

    if (env.ADMIN_PHONE) {
      sendWhatsApp({ to: env.ADMIN_PHONE, text: waMsg }).catch(() => {});
    }
    if (env.ADMIN_EMAIL) {
      sendEmail({
        to: env.ADMIN_EMAIL,
        subject: `💰 Payment Request — ${dealer?.dealer_name} ৳${body.amount}`,
        text: waMsg.replace(/\*/g, ''),
      }).catch(() => {});
    }

    res.status(201).json({ request: row });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message });
    res.status(500).json({ error: err.message });
  }
});

// ── DEALER: list own ─────────────────────────────────────────────────────────
router.get('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = req.user?.dealerId;
    if (!dealerId) { res.status(403).json({ error: 'No dealer account' }); return; }

    const rows = await db('dealer_payment_requests')
      .where({ dealer_id: dealerId })
      .orderBy('created_at', 'desc');

    res.json({ requests: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── SA: list all ─────────────────────────────────────────────────────────────
router.get('/sa/all', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { status } = req.query;

    let q = db('dealer_payment_requests as r')
      .join('dealers as d', 'd.id', 'r.dealer_id')
      .leftJoin('profiles as rv', 'rv.id', 'r.reviewed_by')
      .select(
        'r.id', 'r.amount', 'r.payment_method', 'r.transaction_id',
        'r.screenshot_url', 'r.note', 'r.status', 'r.review_note',
        'r.reviewed_at', 'r.created_at',
        'd.name as dealer_name', 'd.phone as dealer_phone', 'd.id as dealer_id',
        'rv.name as reviewed_by_name',
      )
      .orderBy('r.created_at', 'desc');

    if (status && status !== 'all') q = q.where('r.status', status as string);

    const rows = await q;
    const pendingCount = await db('dealer_payment_requests').where({ status: 'pending' }).count('id as cnt').first();

    res.json({ requests: rows, pendingCount: Number(pendingCount?.cnt ?? 0) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── SA: approve / reject ─────────────────────────────────────────────────────
router.patch('/sa/:id', requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const body = reviewSchema.parse(req.body);
    const { id } = req.params;

    const existing = await db('dealer_payment_requests as r')
      .join('dealers as d', 'd.id', 'r.dealer_id')
      .where('r.id', id)
      .select('r.*', 'd.name as dealer_name', 'd.phone as dealer_phone')
      .first();
    if (!existing) { res.status(404).json({ error: 'Request not found' }); return; }

    const [updated] = await db('dealer_payment_requests')
      .where({ id })
      .update({
        status:      body.status,
        review_note: body.review_note ?? null,
        reviewed_by: req.user?.userId ?? null,
        reviewed_at: db.fn.now(),
        updated_at:  db.fn.now(),
      })
      .returning('*');

    // Notify dealer via WhatsApp
    if (existing.dealer_phone) {
      const statusMsg = body.status === 'approved'
        ? `✅ *পেমেন্ট নিশ্চিত হয়েছে!*\n\nআপনার ৳${Number(existing.amount).toLocaleString('en-BD')} পেমেন্ট অনুমোদিত হয়েছে।`
        : `❌ *পেমেন্ট রিকোয়েস্ট প্রত্যাখ্যাত*\n\nআপনার ৳${Number(existing.amount).toLocaleString('en-BD')} পেমেন্ট রিকোয়েস্ট গ্রহণ করা হয়নি।`;
      const reviewNote = body.review_note ? `\n📝 *কারণ:* ${body.review_note}` : '';
      sendWhatsApp({
        to: existing.dealer_phone,
        text: `${statusMsg}${reviewNote}\n\nযোগাযোগ: +880 1674 533303`,
      }).catch(() => {});
    }

    await recordSaAudit(req, {
      action: `payment_request.${body.status}`,
      targetType: 'dealer_payment_request',
      targetId: id,
      targetLabel: `${existing.dealer_name} ৳${existing.amount}`,
      details: { status: body.status, review_note: body.review_note },
    });

    res.json({ request: updated });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
