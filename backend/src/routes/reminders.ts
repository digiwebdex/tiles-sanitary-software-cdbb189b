/**
 * /api/admin/reminders — Super Admin control for subscription-expiry reminders.
 *
 * Auto reminder fires `days_before` days before a dealer's subscription
 * end_date, across SMS / WhatsApp / Email (each toggleable). All routes
 * require super_admin.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import {
  getReminderSettings,
  updateReminderSettings,
  getUpcomingExpiries,
  getChannelConfigStatus,
  sendExpiryReminders,
  sendReminderToDealer,
} from '../services/subscriptionReminderService';

const router = Router();
router.use(authenticate, requireRole('super_admin'));

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  days_before: z.coerce.number().int().min(0).max(30).optional(),
  sms_enabled: z.boolean().optional(),
  whatsapp_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
});

/** GET /api/admin/reminders/settings — current toggles + channel config status. */
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const [settings, channels] = await Promise.all([
      getReminderSettings(),
      Promise.resolve(getChannelConfigStatus()),
    ]);
    return res.json({ settings, channels });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** PUT /api/admin/reminders/settings — update toggles / timing. */
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const patch = settingsSchema.parse(req.body);
    const settings = await updateReminderSettings(patch);
    return res.json({ settings, channels: getChannelConfigStatus() });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: 'Invalid settings', issues: err.issues });
    return res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/reminders/upcoming?days=7 — dealers expiring soon. */
router.get('/upcoming', async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days ?? 7);
    const rows = await getUpcomingExpiries(Number.isFinite(days) ? days : 7);
    return res.json({ rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/reminders/run — run the due-today reminder batch now. */
router.post('/run', async (_req: Request, res: Response) => {
  try {
    return res.json(await sendExpiryReminders());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/reminders/send/:dealerId — send to one dealer immediately.
 *  Optional ?channel=sms|whatsapp|email|all forces specific channel(s). */
router.post('/send/:dealerId', async (req: Request, res: Response) => {
  try {
    const channel = typeof req.query.channel === 'string' ? req.query.channel : 'all';
    const valid = ['sms', 'whatsapp', 'email', 'all'];
    const override = valid.includes(channel) ? channel as 'sms' | 'whatsapp' | 'email' | 'all' : 'all';
    const result = await sendReminderToDealer(req.params.dealerId, override);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/reminders/history?limit=100&dealer_id=&channel=&status= — notification log */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const q = db('notifications as n')
      .leftJoin('dealers as d', 'd.id', 'n.dealer_id')
      .select(
        'n.id', 'n.dealer_id', 'd.name as dealer_name',
        'n.channel', 'n.type', 'n.status', 'n.error_message',
        'n.sent_at', 'n.created_at', 'n.payload',
      )
      .orderBy('n.created_at', 'desc')
      .limit(limit);

    if (req.query.dealer_id) q.where('n.dealer_id', req.query.dealer_id as string);
    if (req.query.channel) q.where('n.channel', req.query.channel as string);
    if (req.query.status) q.where('n.status', req.query.status as string);

    const rows = await q;
    return res.json({ notifications: rows });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
