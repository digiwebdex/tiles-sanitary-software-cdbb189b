/**
 * Leads CRM REST routes — Phase A.
 *
 * Endpoints:
 *   GET    /api/leads?dealerId=&page=&pageSize=&search=&f.status=&f.source=
 *   GET    /api/leads/:id?dealerId=
 *   POST   /api/leads                       body: { dealerId, data }
 *   PATCH  /api/leads/:id                   body: { dealerId, data }
 *   DELETE /api/leads/:id?dealerId=
 *   POST   /api/leads/:id/convert           body: { dealerId, customerData? }
 *
 *   GET    /api/leads/:id/visits?dealerId=
 *   POST   /api/leads/:id/visits            body: { dealerId, data }
 *   DELETE /api/leads/visits/:visitId?dealerId=
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();

const SORTABLE = new Set(['name', 'created_at', 'status', 'next_followup', 'estimated_value']);
const FILTERABLE = new Set(['status', 'source', 'assigned_to']);
const WRITABLE = new Set([
  'name', 'phone', 'email', 'address', 'company', 'source', 'status',
  'interest', 'estimated_value', 'assigned_to', 'next_followup', 'notes',
]);

const leadSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  company: z.string().trim().max(255).nullable().optional(),
  source: z.enum(['walk_in', 'phone', 'referral', 'online', 'facebook', 'whatsapp', 'other']).optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
  interest: z.string().trim().max(1000).nullable().optional(),
  estimated_value: z.coerce.number().finite().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  next_followup: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const visitSchema = z.object({
  visit_date: z.string().optional(),
  visit_type: z.string().trim().max(50).optional(),
  outcome: z.string().trim().max(1000).nullable().optional(),
  next_action: z.string().trim().max(500).nullable().optional(),
  next_date: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  visited_by: z.string().uuid().nullable().optional(),
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

// ── Lead options (per-dealer configurable lookups) ───────────────────────
const optionSchema = z.object({
  kind: z.enum(['source', 'status', 'visit_type', 'outcome']),
  value: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(100),
  color: z.string().trim().max(20).nullable().optional(),
  sort_order: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
});

router.get('/options/all', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const kind = req.query.kind as string | undefined;
    let q = db('lead_options').where({ dealer_id: dealerId });
    if (kind) q = q.andWhere({ kind });
    const rows = await q.orderBy('kind').orderBy('sort_order').orderBy('label');
    res.json({ rows });
  } catch (err: any) {
    console.error('[leads/options/list]', err.message);
    res.status(500).json({ error: 'Failed to list options' });
  }
});

router.post('/options', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = optionSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    const [row] = await db('lead_options')
      .insert({ dealer_id: dealerId, ...parsed.data })
      .onConflict(['dealer_id', 'kind', 'value'])
      .merge(['label', 'color', 'sort_order', 'is_active'])
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[leads/options/create]', err.message);
    res.status(500).json({ error: 'Failed to save option' });
  }
});

router.delete('/options/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('lead_options').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Option not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[leads/options/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete option' });
  }
});

// ── Visits register (cross-lead) ─────────────────────────────────────────
router.get('/visits/register', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const from = (req.query.from as string) || null;
    const to = (req.query.to as string) || null;
    const visitType = (req.query.visit_type as string) || null;

    let q = db('lead_visits as lv')
      .leftJoin('leads as l', 'l.id', 'lv.lead_id')
      .where('lv.dealer_id', dealerId)
      .select(
        'lv.*',
        'l.name as lead_name',
        'l.phone as lead_phone',
        'l.company as lead_company',
        'l.status as lead_status',
      );
    if (from) q = q.andWhere('lv.visit_date', '>=', from);
    if (to) q = q.andWhere('lv.visit_date', '<=', to);
    if (visitType) q = q.andWhere('lv.visit_type', visitType);

    const rows = await q.orderBy('lv.visit_date', 'desc').orderBy('lv.created_at', 'desc').limit(500);
    res.json({ rows });
  } catch (err: any) {
    console.error('[leads/visits/register]', err.message);
    res.status(500).json({ error: 'Failed to load visit register' });
  }
});



// ── List leads ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt((req.query.pageSize as string) || '25', 10)));
    const search = ((req.query.search as string) || '').trim();
    const orderBy = (req.query.orderBy as string) || 'created_at';
    const orderDir = ((req.query.orderDir as string) || 'desc').toLowerCase();

    let q = db('leads').where({ dealer_id: dealerId });
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('f.')) continue;
      const col = key.slice(2);
      if (!FILTERABLE.has(col)) continue;
      q = q.andWhere(col, value as string);
    }
    if (search) {
      q = q.andWhere(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('phone', `%${search}%`)
          .orWhereILike('company', `%${search}%`);
      });
    }

    const countQ = q.clone().clearOrder().clearSelect().count<{ count: string }[]>('* as count');
    const sortCol = SORTABLE.has(orderBy) ? orderBy : 'created_at';
    const sortDir = orderDir === 'asc' ? 'asc' : 'desc';
    const rowsQ = q.clone().select('*').orderBy(sortCol, sortDir).offset(page * pageSize).limit(pageSize);

    const [countRow] = await countQ;
    const rows = await rowsQ;
    res.json({ rows, total: Number(countRow?.count ?? 0) });
  } catch (err: any) {
    console.error('[leads/list]', err.message);
    res.status(500).json({ error: 'Failed to list leads' });
  }
});

// ── Single lead ───────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const row = await db('leads').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!row) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[leads/get]', err.message);
    res.status(500).json({ error: 'Failed to load lead' });
  }
});

// ── Create lead ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = leadSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
    if (!parsed.data.name) { res.status(400).json({ error: 'name is required' }); return; }

    const payload: Record<string, unknown> = { dealer_id: dealerId, created_by: req.user?.userId ?? null };
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    const [row] = await db('leads').insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[leads/create]', err.message);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// ── Update lead ───────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = leadSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }
    if (Object.keys(payload).length === 0) { res.status(400).json({ error: 'No editable fields' }); return; }
    const [row] = await db('leads').where({ id: req.params.id, dealer_id: dealerId }).update(payload).returning('*');
    if (!row) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ row });
  } catch (err: any) {
    console.error('[leads/update]', err.message);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ── Delete lead ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('leads').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[leads/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ── Convert lead → customer ───────────────────────────────────────────────
router.post('/:id/convert', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const trx = await db.transaction();
    try {
      const lead = await trx('leads').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!lead) { await trx.rollback(); res.status(404).json({ error: 'Lead not found' }); return; }
      if (lead.converted_customer_id) {
        await trx.rollback();
        res.status(409).json({ error: 'Lead already converted', customer_id: lead.converted_customer_id });
        return;
      }

      const extra = (req.body?.customerData ?? {}) as Record<string, unknown>;
      const customerPayload = {
        dealer_id: dealerId,
        name: (extra.name as string) || lead.name,
        phone: (extra.phone as string) ?? lead.phone ?? null,
        email: (extra.email as string) ?? lead.email ?? null,
        address: (extra.address as string) ?? lead.address ?? null,
        status: 'active',
      };
      const [customer] = await trx('customers').insert(customerPayload).returning('*');

      const [updatedLead] = await trx('leads')
        .where({ id: lead.id, dealer_id: dealerId })
        .update({
          status: 'converted',
          converted_customer_id: customer.id,
          converted_at: new Date(),
        })
        .returning('*');

      await trx.commit();
      res.json({ lead: updatedLead, customer });
    } catch (e) {
      await trx.rollback();
      throw e;
    }
  } catch (err: any) {
    console.error('[leads/convert]', err.message);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

// ── Visits ────────────────────────────────────────────────────────────────
router.get('/:id/visits', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db('lead_visits')
      .where({ dealer_id: dealerId, lead_id: req.params.id })
      .orderBy('visit_date', 'desc')
      .orderBy('created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    console.error('[leads/visits/list]', err.message);
    res.status(500).json({ error: 'Failed to list visits' });
  }
});

router.post('/:id/visits', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = visitSchema.safeParse(req.body?.data);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

    const lead = await db('leads').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const payload: Record<string, unknown> = {
      dealer_id: dealerId,
      lead_id: req.params.id,
      visited_by: req.user?.userId ?? null,
      ...parsed.data,
    };
    const [row] = await db('lead_visits').insert(payload).returning('*');

    // bump next_followup on the lead if provided
    if (parsed.data.next_date) {
      await db('leads')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({ next_followup: parsed.data.next_date });
    }

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[leads/visits/create]', err.message);
    res.status(500).json({ error: 'Failed to add visit' });
  }
});

router.delete('/visits/:visitId', async (req, res) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const n = await db('lead_visits').where({ id: req.params.visitId, dealer_id: dealerId }).delete();
    if (!n) { res.status(404).json({ error: 'Visit not found' }); return; }
    res.status(204).end();
  } catch (err: any) {
    console.error('[leads/visits/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete visit' });
  }
});

export default router;
