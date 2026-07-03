/**
 * Commissions route — Phase 3U-13.
 *
 * Referral sources:
 *   GET    /api/commissions/sources?dealerId=&activeOnly=&search=
 *   GET    /api/commissions/sources/:id?dealerId=
 *   POST   /api/commissions/sources                       body: ReferralSource
 *   PATCH  /api/commissions/sources/:id                   body: { dealerId, ...patch }
 *   DELETE /api/commissions/sources/:id?dealerId=         (soft → active=false)
 *
 * Sale commissions:
 *   GET    /api/commissions/sale/:saleId?dealerId=
 *   PUT    /api/commissions/sale/:saleId                  body: UpsertInput (upsert)
 *   DELETE /api/commissions/sale/:saleId?dealerId=
 *   GET    /api/commissions?dealerId=&status=&referralSourceId=&sourceType=&from=&to=
 *   POST   /api/commissions/:id/promote-earned            body: { dealerId, saleId }
 *   POST   /api/commissions/:id/settle                    body: { dealerId, settled_amount, settled_at?, note? }
 *   POST   /api/commissions/:id/cancel                    body: { dealerId, reason? }
 *   GET    /api/commissions/dashboard-stats?dealerId=
 *
 * Reads are open to authenticated dealer users (sale forms read sources +
 * existing commission). Mutations require dealer_admin (super_admin scoped
 * by ?dealerId=) — except the salesman-allowed `PUT /sale/:saleId` upsert,
 * which mirrors the existing RLS "Salesmen can create sale_commissions"
 * policy. `settle` always requires dealer_admin (touches cash_ledger).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

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

function requireAdmin(req: Request, res: Response, msg = 'Only dealer_admin can perform this action'): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: msg });
    return false;
  }
  return true;
}

async function writeAudit(
  req: Request,
  dealerId: string,
  action: string,
  table: string,
  recordId: string | null,
  oldData: any,
  newData: any,
) {
  try {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers['user-agent'] as string) || null;
    await db('audit_logs').insert({
      dealer_id: dealerId,
      user_id: req.user?.userId ?? null,
      action,
      table_name: table,
      record_id: recordId,
      old_data: oldData,
      new_data: newData,
      ip_address: ip,
      user_agent: ua,
    });
  } catch (e: any) {
    console.warn('[commissions:audit]', e.message);
  }
}

function calculateCommissionAmount(type: 'percent' | 'fixed', value: number, baseAmount: number): number {
  const v = Number(value) || 0;
  const base = Math.max(0, Number(baseAmount) || 0);
  if (type === 'percent') {
    const pct = Math.min(Math.max(v, 0), 100);
    return Math.round(((base * pct) / 100) * 100) / 100;
  }
  return Math.max(0, Math.round(v * 100) / 100);
}

const SOURCE_TYPES = ['salesman', 'architect', 'contractor', 'mason', 'fitter', 'other'] as const;
const COMMISSION_TYPES = ['percent', 'fixed'] as const;

// ──────────────────────────────────────────────────────────────────────
// Referral sources
// ──────────────────────────────────────────────────────────────────────

router.get('/sources', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const activeOnly = String(req.query.activeOnly ?? '') === 'true';
    const search = String(req.query.search ?? '').trim();
    let q = db('referral_sources').select('*').where({ dealer_id: dealerId }).orderBy('name');
    if (activeOnly) q = q.where({ active: true });
    if (search) q = q.whereILike('name', `%${search}%`);
    const rows = await q;
    res.json({ rows });
  } catch (e: any) {
    console.error('[commissions/sources]', e.message);
    res.status(500).json({ error: 'Failed to load referral sources' });
  }
});

router.get('/sources/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('referral_sources')
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();
    if (!row) {
      res.status(404).json({ error: 'Referral source not found' });
      return;
    }
    res.json({ row });
  } catch (e: any) {
    console.error('[commissions/sources/:id]', e.message);
    res.status(500).json({ error: 'Failed to load referral source' });
  }
});

const sourceCreateSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  default_commission_type: z.enum(COMMISSION_TYPES).nullable().optional(),
  default_commission_value: z.number().finite().min(0).nullable().optional(),
});

router.post('/sources', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can manage referral sources')) return;
    const parsed = sourceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const [row] = await db('referral_sources')
      .insert({
        dealer_id: dealerId,
        source_type: parsed.data.source_type,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        notes: parsed.data.notes ?? null,
        active: parsed.data.active ?? true,
        default_commission_type: parsed.data.default_commission_type ?? null,
        default_commission_value: parsed.data.default_commission_value ?? null,
      })
      .returning('*');
    await writeAudit(req, dealerId, 'referral_source_create', 'referral_sources', row.id, null, {
      name: parsed.data.name,
      source_type: parsed.data.source_type,
    });
    res.status(201).json({ row });
  } catch (e: any) {
    console.error('[commissions/sources POST]', e.message);
    res.status(500).json({ error: e.message || 'Failed to create referral source' });
  }
});

const sourcePatchSchema = sourceCreateSchema.partial();

router.patch('/sources/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can manage referral sources')) return;
    const parsed = sourcePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const patch: Record<string, any> = {};
    for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
      if (parsed.data[k] !== undefined) patch[k] = parsed.data[k];
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }
    const [row] = await db('referral_sources')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update(patch)
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Referral source not found' });
      return;
    }
    await writeAudit(req, dealerId, 'referral_source_update', 'referral_sources', row.id, null, patch);
    res.json({ row });
  } catch (e: any) {
    console.error('[commissions/sources PATCH]', e.message);
    res.status(500).json({ error: e.message || 'Failed to update referral source' });
  }
});

// Soft-delete (active=false) — referenced by sale_commissions, hard delete unsafe.
router.delete('/sources/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can manage referral sources')) return;
    const [row] = await db('referral_sources')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ active: false })
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Referral source not found' });
      return;
    }
    await writeAudit(req, dealerId, 'referral_source_delete', 'referral_sources', row.id, null, { active: false });
    res.json({ row });
  } catch (e: any) {
    console.error('[commissions/sources DELETE]', e.message);
    res.status(500).json({ error: e.message || 'Failed to delete referral source' });
  }
});

// ──────────────────────────────────────────────────────────────────────
// Sale commissions
// ──────────────────────────────────────────────────────────────────────

async function attachReferralSource(rows: any[]) {
  const ids = Array.from(new Set(rows.map((r) => r.referral_source_id).filter(Boolean)));
  if (ids.length === 0) return rows;
  const sources = await db('referral_sources')
    .select('id', 'name', 'source_type', 'phone')
    .whereIn('id', ids);
  const map = new Map(sources.map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, referral_sources: map.get(r.referral_source_id) ?? null }));
}

router.get('/sale/:saleId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('sale_commissions')
      .where({ sale_id: req.params.saleId, dealer_id: dealerId })
      .first();
    if (!row) {
      res.json({ row: null });
      return;
    }
    const [enriched] = await attachReferralSource([row]);
    res.json({ row: enriched });
  } catch (e: any) {
    console.error('[commissions/sale GET]', e.message);
    res.status(500).json({ error: 'Failed to load sale commission' });
  }
});

const upsertSchema = z.object({
  referral_source_id: z.string().uuid(),
  commission_type: z.enum(COMMISSION_TYPES),
  commission_value: z.number().finite().min(0),
  commission_base_amount: z.number().finite().min(0),
  notes: z.string().trim().max(2000).nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

router.put('/sale/:saleId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can manage commissions')) return;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const calculated = calculateCommissionAmount(
      parsed.data.commission_type,
      parsed.data.commission_value,
      parsed.data.commission_base_amount,
    );
    // Ceiling: a commission liability must never exceed the sale it is attached
    // to (guards a runaway fixed-amount or inflated base).
    const saleRow = await db('sales')
      .where({ id: req.params.saleId, dealer_id: dealerId })
      .first('total_amount');
    if (!saleRow) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    const saleTotal = Number(saleRow.total_amount) || 0;
    if (calculated > saleTotal + 1e-6) {
      res.status(400).json({
        error: `Commission (${calculated}) cannot exceed the sale total (${saleTotal.toFixed(2)}).`,
        code: 'COMMISSION_EXCEEDS_SALE',
      });
      return;
    }
    const existing = await db('sale_commissions')
      .where({ sale_id: req.params.saleId, dealer_id: dealerId })
      .first();
    if (existing) {
      const [row] = await db('sale_commissions')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({
          referral_source_id: parsed.data.referral_source_id,
          commission_type: parsed.data.commission_type,
          commission_value: parsed.data.commission_value,
          commission_base_amount: parsed.data.commission_base_amount,
          calculated_commission_amount: calculated,
          notes: parsed.data.notes ?? null,
          updated_at: db.fn.now(),
        })
        .returning('*');
      await writeAudit(req, dealerId, 'sale_commission_update', 'sale_commissions', row.id, null, {
        ...parsed.data,
        calculated_commission_amount: calculated,
      });
      res.json({ row });
      return;
    }
    const [row] = await db('sale_commissions')
      .insert({
        dealer_id: dealerId,
        sale_id: req.params.saleId,
        referral_source_id: parsed.data.referral_source_id,
        commission_type: parsed.data.commission_type,
        commission_value: parsed.data.commission_value,
        commission_base_amount: parsed.data.commission_base_amount,
        calculated_commission_amount: calculated,
        status: 'pending',
        notes: parsed.data.notes ?? null,
        created_by: parsed.data.created_by ?? req.user?.userId ?? null,
      })
      .returning('*');
    await writeAudit(req, dealerId, 'sale_commission_create', 'sale_commissions', row.id, null, {
      ...parsed.data,
      calculated_commission_amount: calculated,
    });
    res.status(201).json({ row });
  } catch (e: any) {
    console.error('[commissions/sale PUT]', e.message);
    res.status(500).json({ error: e.message || 'Failed to save sale commission' });
  }
});

router.delete('/sale/:saleId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    await db('sale_commissions')
      .where({ sale_id: req.params.saleId, dealer_id: dealerId })
      .del();
    await writeAudit(req, dealerId, 'sale_commission_remove', 'sale_commissions', req.params.saleId, null, null);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[commissions/sale DELETE]', e.message);
    res.status(500).json({ error: e.message || 'Failed to remove sale commission' });
  }
});

// List with joins (sale, customer, referral source)
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const { status, referralSourceId, sourceType, from, to } = req.query as Record<string, string | undefined>;

    let q = db('sale_commissions as sc')
      .leftJoin('referral_sources as rs', 'rs.id', 'sc.referral_source_id')
      .leftJoin('sales as s', 's.id', 'sc.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where('sc.dealer_id', dealerId)
      .select(
        'sc.*',
        'rs.id as rs_id',
        'rs.name as rs_name',
        'rs.source_type as rs_source_type',
        'rs.phone as rs_phone',
        's.id as s_id',
        's.invoice_number as s_invoice_number',
        's.sale_date as s_sale_date',
        's.sale_status as s_sale_status',
        'c.id as c_id',
        'c.name as c_name',
      )
      .orderBy('sc.created_at', 'desc');

    if (status && status !== 'all') q = q.where('sc.status', status);
    if (referralSourceId) q = q.where('sc.referral_source_id', referralSourceId);
    if (sourceType) q = q.where('rs.source_type', sourceType);
    if (from) q = q.where('sc.created_at', '>=', from);
    if (to) q = q.where('sc.created_at', '<=', to);

    const raw = await q;
    const rows = raw.map((r: any) => {
      const {
        rs_id, rs_name, rs_source_type, rs_phone,
        s_id, s_invoice_number, s_sale_date, s_sale_status,
        c_id, c_name,
        ...sc
      } = r;
      return {
        ...sc,
        referral_sources: rs_id
          ? { id: rs_id, name: rs_name, source_type: rs_source_type, phone: rs_phone }
          : null,
        sales: s_id
          ? {
              id: s_id,
              invoice_number: s_invoice_number,
              sale_date: s_sale_date,
              sale_status: s_sale_status,
              customers: c_id ? { id: c_id, name: c_name } : null,
            }
          : null,
      };
    });
    res.json({ rows });
  } catch (e: any) {
    console.error('[commissions GET]', e.message);
    res.status(500).json({ error: 'Failed to load commissions' });
  }
});

// Promote pending → earned (idempotent). Called from delivery flow.
router.post('/:id/promote-earned', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const existing = await db('sale_commissions')
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();
    if (!existing) {
      res.json({ row: null, skipped: 'not_found' });
      return;
    }
    if (existing.status !== 'pending') {
      res.json({ row: existing, skipped: 'not_pending' });
      return;
    }
    const [row] = await db('sale_commissions')
      .where({ id: existing.id, dealer_id: dealerId, status: 'pending' })
      .update({ status: 'earned', payable_at: db.fn.now() })
      .returning('*');
    if (!row) {
      res.json({ row: existing, skipped: 'race' });
      return;
    }
    await writeAudit(req, dealerId, 'sale_commission_earned', 'sale_commissions', row.id, null, {
      sale_id: row.sale_id,
      amount: row.calculated_commission_amount,
    });
    res.json({ row });
  } catch (e: any) {
    console.error('[commissions/promote-earned]', e.message);
    res.status(500).json({ error: e.message || 'Failed to promote commission' });
  }
});

// Settle → flips to settled + writes cash_ledger expense (atomic).
const settleSchema = z.object({
  settled_amount: z.number().finite().positive(),
  settled_at: z.string().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

router.post('/:id/settle', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can settle commissions')) return;
    const parsed = settleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const amount = Math.round(parsed.data.settled_amount * 100) / 100;
    const settledAt = parsed.data.settled_at ?? new Date().toISOString();
    const entryDate = settledAt.slice(0, 10);

    const result = await db.transaction(async (trx) => {
      const existing = await trx('sale_commissions')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first();
      if (!existing) throw new Error('Commission not found.');
      if (existing.status === 'settled') throw new Error('Commission already settled.');
      if (existing.status === 'cancelled') throw new Error('Cancelled commissions cannot be settled.');
      if (existing.status === 'pending') {
        throw new Error('Commission is still pending — sale must be fully delivered before payout.');
      }

      const refSrc = await trx('referral_sources')
        .select('name')
        .where({ id: existing.referral_source_id, dealer_id: dealerId })
        .first();
      const sale = await trx('sales')
        .select('invoice_number')
        .where({ id: existing.sale_id })
        .first();
      const refName = refSrc?.name ?? 'Referrer';
      const invoiceNo = sale?.invoice_number ?? '—';

      await trx('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'expense',
        // Cash outflow: stored as a negative amount to match the codebase
        // convention (expenses.ts, supplierPayment.ts). cashbook/cash-closing
        // classify amount >= 0 as cash-in, so a positive value here would be
        // mis-counted as a receipt and double-inflate cash on hand.
        amount: -amount,
        description: `Commission payout to ${refName} for invoice ${invoiceNo}${
          parsed.data.note ? ` — ${parsed.data.note}` : ''
        }`,
        reference_type: 'sale_commission',
        reference_id: existing.id,
        entry_date: entryDate,
      });

      const [updated] = await trx('sale_commissions')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({
          status: 'settled',
          settled_at: settledAt,
          settled_amount: amount,
          notes: parsed.data.note
            ? `${existing.notes ? existing.notes + '\n' : ''}Settled: ${parsed.data.note}`
            : existing.notes,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      return { updated, prev: existing };
    });

    await writeAudit(req, dealerId, 'sale_commission_settle', 'sale_commissions', result.updated.id, {
      status: result.prev.status,
      settled_amount: result.prev.settled_amount,
    }, {
      status: 'settled',
      settled_amount: amount,
      settled_at: settledAt,
    });

    res.json({ row: result.updated });
  } catch (e: any) {
    console.error('[commissions/settle]', e.message);
    res.status(400).json({ error: e.message || 'Failed to settle commission' });
  }
});

const cancelSchema = z.object({
  reason: z.string().trim().max(2000).nullable().optional(),
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res, 'Only dealer_admin can cancel commissions')) return;
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const existing = await db('sale_commissions')
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Commission not found.' });
      return;
    }
    if (existing.status === 'settled') {
      res.status(400).json({ error: 'Cannot cancel an already-settled commission.' });
      return;
    }
    await db('sale_commissions')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({
        status: 'cancelled',
        notes: parsed.data.reason
          ? `${existing.notes ? existing.notes + '\n' : ''}Cancelled: ${parsed.data.reason}`
          : existing.notes,
        updated_at: db.fn.now(),
      });
    await writeAudit(req, dealerId, 'sale_commission_cancel', 'sale_commissions', req.params.id, null, {
      reason: parsed.data.reason ?? null,
    });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[commissions/cancel]', e.message);
    res.status(500).json({ error: e.message || 'Failed to cancel commission' });
  }
});

router.get('/dashboard-stats', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('sale_commissions as sc')
      .leftJoin('referral_sources as rs', 'rs.id', 'sc.referral_source_id')
      .where('sc.dealer_id', dealerId)
      .select(
        'sc.status',
        'sc.calculated_commission_amount',
        'sc.settled_amount',
        'sc.settled_at',
        'sc.referral_source_id',
        'rs.name as rs_name',
        'rs.source_type as rs_source_type',
      );

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let unpaidLiability = 0;
    let payableNow = 0;
    let pendingDelivery = 0;
    let settledThisMonth = 0;
    const liabilityBySource = new Map<string, { name: string; source_type: string; amount: number }>();

    for (const r of rows) {
      const calc = Number(r.calculated_commission_amount) || 0;
      const settled = Number(r.settled_amount) || 0;
      if (r.status === 'pending') {
        pendingDelivery += calc;
        unpaidLiability += calc;
      } else if (r.status === 'earned') {
        payableNow += calc;
        unpaidLiability += calc;
      } else if (r.status === 'settled' && r.settled_at) {
        if (new Date(r.settled_at) >= monthStart) settledThisMonth += settled;
      }
      if ((r.status === 'pending' || r.status === 'earned') && r.rs_name) {
        const cur = liabilityBySource.get(r.referral_source_id) ?? {
          name: r.rs_name,
          source_type: r.rs_source_type,
          amount: 0,
        };
        cur.amount += calc;
        liabilityBySource.set(r.referral_source_id, cur);
      }
    }

    const topSource = [...liabilityBySource.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;

    res.json({
      unpaidLiability: Math.round(unpaidLiability * 100) / 100,
      payableNow: Math.round(payableNow * 100) / 100,
      pendingDelivery: Math.round(pendingDelivery * 100) / 100,
      settledThisMonth: Math.round(settledThisMonth * 100) / 100,
      topSource,
      totalReferralSources: liabilityBySource.size,
    });
  } catch (e: any) {
    console.error('[commissions/dashboard-stats]', e.message);
    res.status(500).json({ error: 'Failed to load commission stats' });
  }
});

export default router;
