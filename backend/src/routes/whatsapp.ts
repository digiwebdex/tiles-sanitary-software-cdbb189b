/**
 * WhatsApp route — Phase 3U-16.
 *
 *   GET    /api/whatsapp/logs?dealerId=&page=&messageType=&status=&search=
 *   POST   /api/whatsapp/logs                            (create log)
 *   PATCH  /api/whatsapp/logs/:id/sent
 *   PATCH  /api/whatsapp/logs/:id/failed                 body: { error_message }
 *   POST   /api/whatsapp/logs/:id/retry                  (clones original as new manual_handoff log)
 *   POST   /api/whatsapp/logs/bulk-status                body: { ids[], status }
 *   GET    /api/whatsapp/today-stats?dealerId=
 *   GET    /api/whatsapp/recent?dealerId=&messageType=&recipientPhone=&cooldownHours=
 *   GET    /api/whatsapp/analytics?dealerId=&days=
 *   GET    /api/whatsapp/settings?dealerId=
 *   PUT    /api/whatsapp/settings                        (upsert; admin only)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

const PAGE_SIZE = 25;

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
    (req.body?.dealer_id as string | undefined) ||
    undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage WhatsApp settings' });
    return false;
  }
  return true;
}

function normalizePhone(raw: string): string {
  let p = (raw ?? '').replace(/[\s\-()+]/g, '');
  if (!p) return '';
  if (p.length === 11 && p.startsWith('0')) p = '88' + p;
  return p.replace(/\D/g, '');
}

const DEFAULT_SETTINGS = (dealerId: string) => ({
  dealer_id: dealerId,
  enable_quotation_share: true,
  enable_invoice_share: true,
  enable_payment_receipt: true,
  enable_overdue_reminder: true,
  enable_delivery_update: true,
  template_quotation_share: null,
  template_invoice_share: null,
  template_payment_receipt: null,
  template_overdue_reminder: null,
  template_delivery_update: null,
  prefer_manual_send: true,
  default_country_code: '880',
});

/* ----- LOGS ----- */

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;
    const messageType = String(req.query.messageType ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const search = String(req.query.search ?? '').trim();

    let q = db('whatsapp_message_logs').where('dealer_id', dealerId);
    if (messageType && messageType !== 'all') q = q.where('message_type', messageType);
    if (status && status !== 'all') q = q.where('status', status);
    if (search) {
      q = q.where(function () {
        this.where('recipient_phone', 'ilike', `%${search}%`)
          .orWhere('recipient_name', 'ilike', `%${search}%`);
      });
    }
    const totalRow = await q.clone().clearSelect().clearOrder().count<{ count: string }[]>('id as count');
    const total = Number(totalRow[0]?.count ?? 0);
    const rows = await q.orderBy('created_at', 'desc').limit(PAGE_SIZE).offset(offset).select('*');
    res.json({ rows, total });
  } catch (e: any) {
    console.error('[whatsapp logs GET]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load logs' });
  }
});

const createLogSchema = z.object({
  // 'purchase_order_share' is new in V2 Sprint 5B — additive (see migration 094).
  message_type: z.enum(['quotation_share', 'invoice_share', 'payment_receipt', 'overdue_reminder', 'delivery_update', 'purchase_order_share']),
  source_type: z.string().min(1),
  source_id: z.string().uuid().nullable().optional(),
  recipient_phone: z.string().min(1),
  recipient_name: z.string().nullable().optional(),
  template_key: z.string().nullable().optional(),
  message_text: z.string().min(1),
  payload_snapshot: z.any().optional(),
  status: z.enum(['pending', 'sent', 'manual_handoff', 'failed']).optional(),
});

router.post('/logs', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = createLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    }
    const i = parsed.data;
    const status = i.status ?? 'manual_handoff';
    const [row] = await db('whatsapp_message_logs')
      .insert({
        dealer_id: dealerId,
        message_type: i.message_type,
        source_type: i.source_type,
        source_id: i.source_id ?? null,
        recipient_phone: i.recipient_phone,
        recipient_name: i.recipient_name ?? null,
        template_key: i.template_key ?? null,
        message_text: i.message_text,
        payload_snapshot: i.payload_snapshot ?? {},
        status,
        provider: 'wa_click_to_chat',
        sent_at: status === 'sent' ? new Date().toISOString() : null,
        created_by: req.user?.userId ?? null,
      })
      .returning('*');
    res.status(201).json({ data: row });
  } catch (e: any) {
    console.error('[whatsapp logs POST]', e.message);
    res.status(500).json({ error: e.message || 'Failed to create log' });
  }
});

router.patch('/logs/:id/sent', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const n = await db('whatsapp_message_logs')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null, failed_at: null });
    if (!n) return res.status(404).json({ error: 'Log not found' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[whatsapp sent]', e.message);
    res.status(500).json({ error: e.message || 'Failed to mark sent' });
  }
});

router.patch('/logs/:id/failed', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const errorMessage = String(req.body?.error_message ?? '').trim() || 'Failed';
    const n = await db('whatsapp_message_logs')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ status: 'failed', error_message: errorMessage, failed_at: new Date().toISOString() });
    if (!n) return res.status(404).json({ error: 'Log not found' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[whatsapp failed]', e.message);
    res.status(500).json({ error: e.message || 'Failed to mark failed' });
  }
});

router.post('/logs/:id/retry', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const orig = await db('whatsapp_message_logs')
      .where({ id: req.params.id, dealer_id: dealerId })
      .first('*');
    if (!orig) return res.status(404).json({ error: 'Log not found' });
    const [row] = await db('whatsapp_message_logs')
      .insert({
        dealer_id: orig.dealer_id,
        message_type: orig.message_type,
        source_type: orig.source_type,
        source_id: orig.source_id,
        recipient_phone: orig.recipient_phone,
        recipient_name: orig.recipient_name,
        template_key: orig.template_key,
        message_text: orig.message_text,
        payload_snapshot: { ...(orig.payload_snapshot ?? {}), retry_of: orig.id },
        status: 'manual_handoff',
        provider: 'wa_click_to_chat',
        created_by: req.user?.userId ?? null,
      })
      .returning('*');
    const digits = normalizePhone(orig.recipient_phone);
    res.json({
      data: {
        log: row,
        waLink: `https://wa.me/${digits}?text=${encodeURIComponent(orig.message_text)}`,
      },
    });
  } catch (e: any) {
    console.error('[whatsapp retry]', e.message);
    res.status(500).json({ error: e.message || 'Failed to retry' });
  }
});

router.post('/logs/bulk-status', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const ids = (req.body?.ids as string[]) ?? [];
    const status = String(req.body?.status ?? '');
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ ok: true });
    if (!['sent', 'manual_handoff', 'failed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const patch: Record<string, any> = { status };
    if (status === 'sent') {
      patch.sent_at = new Date().toISOString();
      patch.error_message = null;
      patch.failed_at = null;
    } else if (status === 'failed') {
      patch.failed_at = new Date().toISOString();
      patch.error_message = 'Marked failed in bulk by user';
    }
    await db('whatsapp_message_logs')
      .where('dealer_id', dealerId)
      .whereIn('id', ids)
      .update(patch);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[whatsapp bulk]', e.message);
    res.status(500).json({ error: e.message || 'Failed bulk update' });
  }
});

router.get('/today-stats', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const startIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const rows = await db('whatsapp_message_logs')
      .where('dealer_id', dealerId)
      .where('created_at', '>=', startIso)
      .select('status');
    const stats = { sent: 0, handoff: 0, failed: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === 'sent') stats.sent++;
      else if (r.status === 'manual_handoff') stats.handoff++;
      else if (r.status === 'failed') stats.failed++;
    }
    res.json({ data: stats });
  } catch (e: any) {
    console.error('[whatsapp today-stats]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load stats' });
  }
});

router.get('/recent', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const messageType = String(req.query.messageType ?? '');
    const recipientPhone = String(req.query.recipientPhone ?? '');
    const hours = Math.max(1, parseInt(String(req.query.cooldownHours ?? '24'), 10) || 24);
    const phone = normalizePhone(recipientPhone);
    if (!phone || !messageType) return res.json({ data: null });
    const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const row = await db('whatsapp_message_logs')
      .where({ dealer_id: dealerId, message_type: messageType, recipient_phone: phone })
      .where('created_at', '>=', sinceIso)
      .orderBy('created_at', 'desc')
      .first('*');
    res.json({ data: row ?? null });
  } catch (e: any) {
    console.error('[whatsapp recent]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load recent' });
  }
});

router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '7'), 10) || 7));
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (days - 1));
    const rows = await db('whatsapp_message_logs')
      .where('dealer_id', dealerId)
      .where('created_at', '>=', startDate.toISOString())
      .select('status', 'message_type', 'created_at');

    const totals = { sent: 0, handoff: 0, failed: 0, total: rows.length };
    const byType: Record<string, number> = {
      quotation_share: 0,
      invoice_share: 0,
      payment_receipt: 0,
      overdue_reminder: 0,
      delivery_update: 0,
    };
    const dailyMap = new Map<string, { date: string; sent: number; handoff: number; failed: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const k = d.toISOString().slice(0, 10);
      dailyMap.set(k, { date: k, sent: 0, handoff: 0, failed: 0 });
    }
    for (const r of rows as any[]) {
      if (r.status === 'sent') totals.sent++;
      else if (r.status === 'manual_handoff') totals.handoff++;
      else if (r.status === 'failed') totals.failed++;
      byType[r.message_type] = (byType[r.message_type] ?? 0) + 1;
      const dayKey = new Date(r.created_at).toISOString().slice(0, 10);
      const bucket = dailyMap.get(dayKey);
      if (bucket) {
        if (r.status === 'sent') bucket.sent++;
        else if (r.status === 'manual_handoff') bucket.handoff++;
        else if (r.status === 'failed') bucket.failed++;
      }
    }
    const positive = totals.sent + totals.handoff;
    const successRate = totals.total > 0 ? (positive / totals.total) * 100 : 0;
    res.json({
      data: { totals, byType, daily: Array.from(dailyMap.values()), successRate },
    });
  } catch (e: any) {
    console.error('[whatsapp analytics]', e.message);
    res.status(500).json({ error: e.message || 'Failed analytics' });
  }
});

/* ----- SETTINGS ----- */

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('whatsapp_settings').where('dealer_id', dealerId).first('*');
    res.json({ data: row ?? DEFAULT_SETTINGS(dealerId) });
  } catch (e: any) {
    console.error('[whatsapp settings GET]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load settings' });
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const body = (req.body ?? {}) as Record<string, any>;
    const row = {
      dealer_id: dealerId,
      enable_quotation_share: !!body.enable_quotation_share,
      enable_invoice_share: !!body.enable_invoice_share,
      enable_payment_receipt: !!body.enable_payment_receipt,
      enable_overdue_reminder: !!body.enable_overdue_reminder,
      enable_delivery_update: !!body.enable_delivery_update,
      // V2 Sprint 5B
      enable_purchase_order_share: !!body.enable_purchase_order_share,
      template_quotation_share: body.template_quotation_share ?? null,
      template_invoice_share: body.template_invoice_share ?? null,
      template_payment_receipt: body.template_payment_receipt ?? null,
      template_overdue_reminder: body.template_overdue_reminder ?? null,
      template_delivery_update: body.template_delivery_update ?? null,
      // V2 Sprint 5B
      template_purchase_order_share: body.template_purchase_order_share ?? null,
      prefer_manual_send: body.prefer_manual_send !== false,
      default_country_code: body.default_country_code ?? '880',
      updated_at: new Date().toISOString(),
    };
    await db('whatsapp_settings')
      .insert(row)
      .onConflict('dealer_id')
      .merge();
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[whatsapp settings PUT]', e.message);
    res.status(500).json({ error: e.message || 'Failed to save settings' });
  }
});

export default router;
