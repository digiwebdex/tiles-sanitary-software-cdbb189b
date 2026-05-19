/**
 * Shifts — Phase 14.
 *
 *   GET    /api/shifts
 *   GET    /api/shifts/:id
 *   POST   /api/shifts
 *   PUT    /api/shifts/:id
 *   DELETE /api/shifts/:id
 *   POST   /api/shifts/evaluate   body: { shift_id, check_in, att_date? }
 *      -> { is_working_day, on_time, minutes_late, suggested_status }
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate as requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(requireAuth);

const shiftSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  grace_minutes: z.coerce.number().int().min(0).max(240).optional(),
  half_day_after_minutes: z.coerce.number().int().min(0).max(720).optional(),
  working_days: z.string().regex(/^[0-6](,[0-6])*$/).optional(),
  color: z.string().max(16).optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const rows = await db('shifts').where({ dealer_id: dealerId }).orderBy('name');
  res.json(rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const row = await db('shifts').where({ id: req.params.id, dealer_id: dealerId }).first();
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('shifts')
    .insert({ ...parsed.data, dealer_id: dealerId, created_by: req.user!.userId })
    .returning('*');
  res.json(row);
});

router.put('/:id', requireRole('dealer_admin', 'manager'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const parsed = shiftSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [row] = await db('shifts')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const count = await db('shifts').where({ id: req.params.id, dealer_id: dealerId }).delete();
  if (!count) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

router.post('/evaluate', async (req: Request, res: Response) => {
  const dealerId = req.user!.dealerId;
  const Body = z.object({
    shift_id: z.string().uuid(),
    check_in: z.string().regex(/^\d{2}:\d{2}$/),
    att_date: z.string().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const shift = await db('shifts').where({ id: parsed.data.shift_id, dealer_id: dealerId }).first();
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const date = parsed.data.att_date ? new Date(parsed.data.att_date + 'T00:00:00') : new Date();
  const weekday = date.getDay(); // 0=Sun..6=Sat
  const workingDays = String(shift.working_days || '').split(',').map(Number).filter((n) => !Number.isNaN(n));
  const isWorking = workingDays.includes(weekday);

  const startMin = toMinutes(shift.start_time);
  const inMin = toMinutes(parsed.data.check_in);
  const minutesLate = Math.max(0, inMin - startMin);
  const grace = Number(shift.grace_minutes ?? 0);
  const halfAfter = Number(shift.half_day_after_minutes ?? 120);
  let suggested: 'present' | 'late' | 'half' | 'absent' = 'present';
  if (!isWorking) suggested = 'absent';
  else if (minutesLate > halfAfter) suggested = 'half';
  else if (minutesLate > grace) suggested = 'late';

  res.json({
    is_working_day: isWorking,
    on_time: minutesLate <= grace,
    minutes_late: minutesLate,
    suggested_status: suggested,
  });
});

export default router;
