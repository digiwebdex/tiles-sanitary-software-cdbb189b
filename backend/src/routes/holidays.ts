/**
 * Holidays REST routes — Phase C.
 *
 * Endpoints:
 *   GET    /api/holidays?dealerId=&year=&from=&to=
 *   GET    /api/holidays/:id?dealerId=
 *   POST   /api/holidays                 body: { dealerId, data }
 *   PATCH  /api/holidays/:id             body: { dealerId, data }
 *   DELETE /api/holidays/:id?dealerId=
 *   POST   /api/holidays/bulk            body: { dealerId, rows: [...] }
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();

const WRITABLE = new Set(['holiday_date', 'name', 'type', 'recurring', 'paid', 'notes']);

const holidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  name: z.string().trim().min(1).max(255).optional(),
  type: z.enum(['public', 'religious', 'national', 'company', 'weekend', 'other']).optional(),
  recurring: z.coerce.boolean().optional(),
  paid: z.coerce.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

function resolveDealerScope(req: Request, res: Response): string | null {
  const isSuperAdmin = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined);
  if (isSuperAdmin) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

router.use(authenticate, tenantGuard);

// ── List ──────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const year = req.query.year ? parseInt(req.query.year as string, 10) : null;
    const from = (req.query.from as string) || null;
    const to = (req.query.to as string) || null;

    let q = db('holidays').where({ dealer_id: dealerId });
    if (year && Number.isFinite(year)) {
      q = q.andWhereRaw(`(recurring = true OR EXTRACT(YEAR FROM holiday_date) = ?)`, [year]);
    }
    if (from) q = q.andWhere('holiday_date', '>=', from);
    if (to) q = q.andWhere('holiday_date', '<=', to);

    const rows = await q.select('*').orderBy('holiday_date', 'asc');
    res.json({ rows, total: rows.length });
  } catch (err: any) {
    console.error('[holidays/list]', err.message);
    res.status(500).json({ error: 'Failed to list holidays' });
  }
});

// ── Single ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const row = await db('holidays').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!row) { res.status(404).json({ error: 'Holiday not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[holidays/get]', err.message);
    res.status(500).json({ error: 'Failed to load holiday' });
  }
});

// ── Create ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = holidaySchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    if (!parsed.data.holiday_date || !parsed.data.name) {
      res.status(400).json({ error: 'holiday_date and name are required' });
      return;
    }
    const payload: Record<string, unknown> = { dealer_id: dealerId, created_by: req.user?.userId ?? null };
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    const [row] = await db('holidays').insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'Holiday already exists for that date and name' });
      return;
    }
    console.error('[holidays/create]', err.message);
    res.status(500).json({ error: 'Failed to create holiday' });
  }
});

// ── Update ────────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = holidaySchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    if (Object.keys(payload).length === 0) { res.status(400).json({ error: 'No editable fields' }); return; }
    const [row] = await db('holidays').where({ id: req.params.id, dealer_id: dealerId }).update(payload).returning('*');
    if (!row) { res.status(404).json({ error: 'Holiday not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[holidays/update]', err.message);
    res.status(500).json({ error: 'Failed to update holiday' });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('holidays').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Holiday not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[holidays/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete holiday' });
  }
});

// ── Bulk insert (for importing yearly calendars) ─────────────────────────
const bulkSchema = z.object({
  rows: z.array(holidaySchema).min(1).max(500),
});
router.post('/bulk', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

    const payload = parsed.data.rows
      .filter(r => r.holiday_date && r.name)
      .map(r => {
        const row: Record<string, unknown> = { dealer_id: dealerId, created_by: req.user?.userId ?? null };
        for (const k of Object.keys(r)) {
          if (WRITABLE.has(k)) row[k] = (r as any)[k];
        }
        return row;
      });
    if (!payload.length) { res.status(400).json({ error: 'No valid rows' }); return; }

    const rows = await db('holidays').insert(payload).onConflict(['dealer_id', 'holiday_date', 'name']).ignore().returning('*');
    res.status(201).json({ rows, inserted: rows.length });
  } catch (err: any) {
    console.error('[holidays/bulk]', err.message);
    res.status(500).json({ error: 'Failed to bulk-insert holidays' });
  }
});

export default router;
