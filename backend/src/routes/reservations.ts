/**
 * Stock reservations route — Phase 3R, extended in V2 Sprint 3C.
 *
 *   GET   /api/reservations?dealerId=&status=&product_id=&customer_id=
 *   GET   /api/reservations/by-customer-product?customerId=&productId=
 *   GET   /api/reservations/by-product/:productId
 *   POST  /api/reservations                            ← create (calls RPC)
 *   PATCH /api/reservations/:id                        ← edit (Sprint 3C)
 *   POST  /api/reservations/:id/release                ← release (calls RPC)
 *   POST  /api/reservations/:id/extend                 ← extend expiry
 *   POST  /api/reservations/:id/consume                ← consume during sale
 *   POST  /api/reservations/expire-stale               ← bulk expire stale
 *
 * Mutations call the existing PL/pgSQL RPCs (create_stock_reservation,
 * release_stock_reservation, consume_reservation_for_sale,
 * expire_stale_reservations) so atomicity matches Supabase exactly. V2
 * Sprint 3C ported these three RPCs to the VPS database (they previously
 * only existed in the old Supabase migration history — see migration 087).
 *
 * V2 Sprint 3C additions (all reuse this same table/RPCs — no parallel
 * mechanism was built):
 *   - `kind: 'reservation' | 'allocation'` — "Stock Allocation" is the SAME
 *     mechanism as a Reservation, distinguished only by `source_type =
 *     'allocation'` (already a free-text column, no CHECK constraint) plus
 *     an optional `priority`. The create/release/expire RPCs are unaware of
 *     this distinction; the route sets it via a follow-up UPDATE inside the
 *     same transaction, after the RPC has done its atomic stock bookkeeping.
 *   - `warehouse_id` / `godown_id` / `rack_id` — optional location tag on a
 *     reservation (Sprint 3B's hierarchy). Purely a label for "what this
 *     reservation is earmarked against" — it does NOT deduct from
 *     warehouse_stock/godown_stock/rack_stock (those only move via transfers,
 *     same as before Sprint 3C).
 *   - `PATCH /:id` ("Edit Reservation") — no low-level RPC existed for
 *     editing qty/expiry/reason. Implemented as release (existing RPC) +
 *     create (existing RPC) in one transaction, preserving batch/customer/
 *     location/kind from the original — avoids writing any new stock-
 *     mutating SQL beyond what's already proven atomic.
 *
 * dealer_admin OR salesman can read; only dealer_admin can release/extend/edit.
 * Create is allowed for both (POS/Sale flows need to reserve).
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
    res.status(403).json({ error: 'Only dealer_admin can perform this action' });
    return false;
  }
  return true;
}

// ── GET /api/reservations ──
router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    let q = db('stock_reservations as sr')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .leftJoin('warehouses as w', 'w.id', 'sr.warehouse_id')
      .leftJoin('godowns as g', 'g.id', 'sr.godown_id')
      .leftJoin('racks as rk', 'rk.id', 'sr.rack_id')
      .where({ 'sr.dealer_id': dealerId })
      .select(
        'sr.*',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit_type as product_unit_type',
        'p.category as product_category',
        'c.name as customer_name',
        'pb.batch_no as batch_no',
        'pb.shade_code as batch_shade_code',
        'pb.caliber as batch_caliber',
        'pb.lot_no as batch_lot_no',
        'w.name as warehouse_name',
        'g.name as godown_name',
        'rk.name as rack_name',
      )
      .orderBy('sr.created_at', 'desc');

    const status = req.query.status as string | undefined;
    if (status) q = q.andWhere('sr.status', status);
    const productId = req.query.product_id as string | undefined;
    if (productId) q = q.andWhere('sr.product_id', productId);
    const customerId = req.query.customer_id as string | undefined;
    if (customerId) q = q.andWhere('sr.customer_id', customerId);
    const kind = req.query.kind as string | undefined;
    if (kind === 'allocation') q = q.andWhere('sr.source_type', 'allocation');
    else if (kind === 'reservation') q = q.andWhereNot('sr.source_type', 'allocation');

    const rows = await q;
    res.json({
      rows: rows.map((r: any) => ({
        ...r,
        products: {
          name: r.product_name,
          sku: r.product_sku,
          unit_type: r.product_unit_type,
          category: r.product_category,
        },
        customers: { name: r.customer_name },
        product_batches: r.batch_no
          ? { batch_no: r.batch_no, shade_code: r.batch_shade_code, caliber: r.batch_caliber }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[reservations/list]', err.message);
    res.status(500).json({ error: 'Failed to list reservations' });
  }
});

// ── GET /api/reservations/by-customer-product ──
router.get('/by-customer-product', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const customerId = req.query.customerId as string | undefined;
  const productId = req.query.productId as string | undefined;
  if (!customerId || !productId) {
    res.status(400).json({ error: 'customerId and productId are required' });
    return;
  }
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .where({
        'sr.dealer_id': dealerId,
        'sr.customer_id': customerId,
        'sr.product_id': productId,
        'sr.status': 'active',
      })
      .select(
        'sr.*',
        'pb.batch_no as batch_no',
        'pb.shade_code as batch_shade_code',
        'pb.caliber as batch_caliber',
      )
      .orderBy('sr.created_at', 'asc');
    res.json({
      rows: rows.map((r: any) => ({
        ...r,
        product_batches: r.batch_no
          ? { batch_no: r.batch_no, shade_code: r.batch_shade_code, caliber: r.batch_caliber }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[reservations/by-customer-product]', err.message);
    res.status(500).json({ error: 'Failed to load reservations' });
  }
});

// ── GET /api/reservations/by-product/:productId ──
router.get('/by-product/:productId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .where({
        'sr.dealer_id': dealerId,
        'sr.product_id': req.params.productId,
        'sr.status': 'active',
      })
      .select(
        'sr.*',
        'c.name as customer_name',
        'pb.batch_no as batch_no',
        'pb.shade_code as batch_shade_code',
        'pb.caliber as batch_caliber',
      )
      .orderBy('sr.created_at', 'asc');
    res.json({
      rows: rows.map((r: any) => ({
        ...r,
        customers: { name: r.customer_name },
        product_batches: r.batch_no
          ? { batch_no: r.batch_no, shade_code: r.batch_shade_code, caliber: r.batch_caliber }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[reservations/by-product]', err.message);
    res.status(500).json({ error: 'Failed to load reservations' });
  }
});

// ── POST /api/reservations ──
const CreateSchema = z.object({
  product_id: z.string().uuid(),
  batch_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid(),
  reserved_qty: z.coerce.number().positive(),
  unit_type: z.enum(['box_sft', 'piece']),
  reason: z.string().optional().nullable(),
  expires_at: z.string().nullable().optional(),
  // V2 Sprint 3C
  kind: z.enum(['reservation', 'allocation']).default('reservation'),
  priority: z.coerce.number().int().min(0).max(100).default(0),
  warehouse_id: z.string().uuid().nullable().optional(),
  godown_id: z.string().uuid().nullable().optional(),
  rack_id: z.string().uuid().nullable().optional(),
});

/**
 * V2 Sprint 3C — apply the kind/priority/location tags that the
 * create_stock_reservation RPC has no parameters for. Runs inside the
 * same transaction as the RPC call so it's part of the same atomic unit.
 */
async function applySprint3CTags(
  trx: any,
  reservationId: string,
  p: { kind: 'reservation' | 'allocation'; priority: number; warehouse_id?: string | null; godown_id?: string | null; rack_id?: string | null },
) {
  const patch: Record<string, unknown> = { priority: p.priority };
  if (p.kind === 'allocation') patch.source_type = 'allocation';
  if (p.warehouse_id !== undefined) patch.warehouse_id = p.warehouse_id;
  if (p.godown_id !== undefined) patch.godown_id = p.godown_id;
  if (p.rack_id !== undefined) patch.rack_id = p.rack_id;
  await trx('stock_reservations').where({ id: reservationId }).update(patch);
}

router.post('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const p = parsed.data;
  try {
    const result = await db.transaction(async (trx) => {
      const r = await trx.raw(
        `select create_stock_reservation(
           ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::numeric, ?::text, ?::text, ?::timestamptz, ?::uuid
         ) as id`,
        [
          dealerId,
          p.product_id,
          p.batch_id ?? null,
          p.customer_id,
          p.reserved_qty,
          p.unit_type,
          p.reason ?? null,
          p.expires_at ?? null,
          req.user?.userId ?? null,
        ],
      );
      const id = r?.rows?.[0]?.id as string;

      await applySprint3CTags(trx, id, p);

      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: p.kind === 'allocation' ? 'ALLOCATION_CREATED' : 'RESERVATION_CREATED',
        table_name: 'stock_reservations',
        record_id: id,
        new_data: {
          product_id: p.product_id,
          batch_id: p.batch_id ?? null,
          customer_id: p.customer_id,
          reserved_qty: p.reserved_qty,
          reason: p.reason ?? null,
          kind: p.kind,
          priority: p.priority,
          warehouse_id: p.warehouse_id ?? null,
          godown_id: p.godown_id ?? null,
          rack_id: p.rack_id ?? null,
        },
      });

      return id;
    });
    res.status(201).json({ id: result });
  } catch (err: any) {
    console.error('[reservations/create]', err.message);
    res.status(400).json({ error: err.message || 'Failed to create reservation' });
  }
});

// ── PATCH /api/reservations/:id — "Edit Reservation" (V2 Sprint 3C) ──
// No RPC exists for editing an in-flight reservation's qty/expiry/reason.
// Implemented as release (existing RPC) + create (existing RPC) in one
// transaction, carrying over batch/customer/kind/priority/location from the
// original — this reuses the same two proven atomic primitives rather than
// writing new low-level stock-mutating SQL.
const EditSchema = z.object({
  reserved_qty: z.coerce.number().positive().optional(),
  reason: z.string().optional().nullable(),
  expires_at: z.string().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  godown_id: z.string().uuid().nullable().optional(),
  rack_id: z.string().uuid().nullable().optional(),
});

router.patch('/:id', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const p = parsed.data;
  try {
    const newId = await db.transaction(async (trx) => {
      const old = await trx('stock_reservations')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first();
      if (!old) throw new Error('Reservation not found');
      if (old.status !== 'active') throw new Error('Only active reservations can be edited');

      const product = await trx('products').where({ id: old.product_id }).first('unit_type');
      const remaining = Number(old.reserved_qty) - Number(old.fulfilled_qty) - Number(old.released_qty);
      const newQty = p.reserved_qty ?? remaining;

      await trx.raw(`select release_stock_reservation(?::uuid, ?::uuid, ?::text)`, [
        old.id,
        dealerId,
        'Edited — replaced by an updated reservation',
      ]);

      const r = await trx.raw(
        `select create_stock_reservation(
           ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::numeric, ?::text, ?::text, ?::timestamptz, ?::uuid
         ) as id`,
        [
          dealerId,
          old.product_id,
          old.batch_id,
          old.customer_id,
          newQty,
          product?.unit_type ?? 'piece',
          p.reason !== undefined ? p.reason : old.reason,
          p.expires_at !== undefined ? p.expires_at : old.expires_at,
          req.user?.userId ?? null,
        ],
      );
      const id = r?.rows?.[0]?.id as string;

      await applySprint3CTags(trx, id, {
        kind: old.source_type === 'allocation' ? 'allocation' : 'reservation',
        priority: p.priority ?? old.priority ?? 0,
        warehouse_id: p.warehouse_id !== undefined ? p.warehouse_id : old.warehouse_id,
        godown_id: p.godown_id !== undefined ? p.godown_id : old.godown_id,
        rack_id: p.rack_id !== undefined ? p.rack_id : old.rack_id,
      });

      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: 'RESERVATION_EDITED',
        table_name: 'stock_reservations',
        record_id: id,
        old_data: { id: old.id, reserved_qty: old.reserved_qty, expires_at: old.expires_at, reason: old.reason },
        new_data: { id, reserved_qty: newQty, expires_at: p.expires_at ?? old.expires_at, reason: p.reason ?? old.reason },
      });

      return id;
    });
    res.json({ id: newId });
  } catch (err: any) {
    console.error('[reservations/edit]', err.message);
    res.status(400).json({ error: err.message || 'Failed to edit reservation' });
  }
});

// ── POST /api/reservations/:id/release ──
router.post('/:id/release', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const reason = String(req.body?.release_reason ?? '').trim();
  if (!reason) {
    res.status(400).json({ error: 'release_reason is required' });
    return;
  }
  try {
    await db.transaction(async (trx) => {
      await trx.raw(
        `select release_stock_reservation(?::uuid, ?::uuid, ?::text)`,
        [req.params.id, dealerId, reason],
      );
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: 'RESERVATION_RELEASED',
        table_name: 'stock_reservations',
        record_id: req.params.id,
        new_data: { release_reason: reason },
      });
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[reservations/release]', err.message);
    res.status(400).json({ error: err.message || 'Failed to release reservation' });
  }
});

// ── POST /api/reservations/:id/extend ──
router.post('/:id/extend', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const Schema = z.object({
    expires_at: z.string().min(1),
    reason: z.string().min(1),
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await db.transaction(async (trx) => {
      const old = await trx('stock_reservations')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first('expires_at', 'status');
      if (!old) throw new Error('Reservation not found');
      if (old.status !== 'active') throw new Error('Only active reservations can be extended');

      const updated = await trx('stock_reservations')
        .where({ id: req.params.id, dealer_id: dealerId, status: 'active' })
        .update({ expires_at: parsed.data.expires_at });
      if (!updated) throw new Error('Update failed (possibly status changed)');

      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: 'RESERVATION_EXTENDED',
        table_name: 'stock_reservations',
        record_id: req.params.id,
        old_data: { expires_at: old.expires_at },
        new_data: { expires_at: parsed.data.expires_at, reason: parsed.data.reason },
      });
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[reservations/extend]', err.message);
    res.status(400).json({ error: err.message || 'Failed to extend reservation' });
  }
});

// ── POST /api/reservations/:id/consume ──
router.post('/:id/consume', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const Schema = z.object({
    sale_item_id: z.string().uuid(),
    consume_qty: z.coerce.number().positive(),
  });
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await db.transaction(async (trx) => {
      await trx.raw(
        `select consume_reservation_for_sale(?::uuid, ?::uuid, ?::uuid, ?::numeric)`,
        [req.params.id, dealerId, parsed.data.sale_item_id, parsed.data.consume_qty],
      );
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: 'RESERVATION_CONSUMED',
        table_name: 'stock_reservations',
        record_id: req.params.id,
        new_data: {
          sale_item_id: parsed.data.sale_item_id,
          consumed_qty: parsed.data.consume_qty,
        },
      });
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[reservations/consume]', err.message);
    res.status(400).json({ error: err.message || 'Failed to consume reservation' });
  }
});

// ── POST /api/reservations/expire-stale ──
router.post('/expire-stale', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const r = await db.raw(`select expire_stale_reservations(?::uuid) as n`, [dealerId]);
    const n = Number(r?.rows?.[0]?.n ?? 0);
    res.json({ expired: n });
  } catch (err: any) {
    console.error('[reservations/expire-stale]', err.message);
    res.status(500).json({ error: err.message || 'Failed to expire reservations' });
  }
});

export default router;
