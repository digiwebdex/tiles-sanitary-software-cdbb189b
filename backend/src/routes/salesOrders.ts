/**
 * Sales Orders route — V2 Sprint 4B (Sales Order & Reservation Integration).
 *
 *   GET    /api/sales-orders?dealerId=&search=&status=&projectId=&customerId=&page=
 *   GET    /api/sales-orders/:id
 *   GET    /api/sales-orders/:id/items
 *   POST   /api/sales-orders                              (create draft + items)
 *   PUT    /api/sales-orders/:id                           (edit draft — replace items)
 *   POST   /api/sales-orders/:id/confirm                   ("Approve" — draft → confirmed, auto-reserve)
 *   POST   /api/sales-orders/:id/cancel                    (release reservations, → cancelled)
 *   PATCH  /api/sales-orders/:id/items/:itemId             (edit qty on a confirmed order — updates reservation)
 *   PATCH  /api/sales-orders/:id/delivery-planning         (planned_delivery_date / delivery_readiness)
 *   POST   /api/sales-orders/from-quotation/:quotationId   (Quotation → Sales Order conversion)
 *   POST   /api/sales-orders/:id/invoice-prefill            (V2 Sprint 4C — prefill payload for /sales/new)
 *   POST   /api/sales-orders/:id/link-to-sale               (V2 Sprint 4C — body: { saleId })
 *
 * This is a genuinely new entity — no "Sales Order" concept existed before
 * this sprint (the existing `sales` table is Invoice-equivalent: it deducts
 * stock immediately via allocate_sale_batches and posts VAT/ledger; a Sales
 * Order is an earlier, non-monetary commitment stage). Per the sprint's
 * scope, this file must reuse — never duplicate — the existing Availability
 * Engine (availabilityService.ts, Sprint 3C), Reservation Engine
 * (create_stock_reservation / release_stock_reservation RPCs, Sprint 3C),
 * and Warehouse/Godown/Rack + Batch/Lot infrastructure (Sprint 3B/3C).
 * Invoice, Challan, Payment, VAT posting, POS, Returns, Exchange, Warranty,
 * Barcode/QR and Accounting posting are explicitly out of scope.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { computeAvailability, computeBatchAvailability } from '../services/availabilityService';
import { calcLineTotal, calcTotals, computeReservableQty, hasCaliberMismatch, computeDeliveryReadiness } from '../services/salesOrderService';

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

const itemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name_snapshot: z.string().min(1),
  product_sku_snapshot: z.string().nullable().optional(),
  unit_type: z.enum(['box_sft', 'piece']),
  per_box_sft: z.number().nullable().optional(),
  quantity: z.coerce.number().min(0),
  rate: z.coerce.number().min(0),
  discount_value: z.coerce.number().min(0).default(0),
  rate_source: z.enum(['default', 'tier', 'manual']).default('default'),
  tier_id: z.string().uuid().nullable().optional(),
  preferred_shade_code: z.string().nullable().optional(),
  preferred_caliber: z.string().nullable().optional(),
  preferred_batch_no: z.string().nullable().optional(),
});

const formSchema = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  customer_name_text: z.string().nullable().optional(),
  customer_phone_text: z.string().nullable().optional(),
  customer_address_text: z.string().nullable().optional(),
  quotation_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  salesperson_id: z.string().uuid().nullable().optional(),
  order_date: z.string(),
  discount_type: z.enum(['flat', 'percent']),
  discount_value: z.coerce.number().min(0),
  planned_delivery_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  terms_text: z.string().nullable().optional(),
  items: z.array(itemSchema),
});

async function insertItems(
  trx: any,
  dealerId: string,
  salesOrderId: string,
  items: z.infer<typeof itemSchema>[],
) {
  if (!items.length) return;
  const rows = items.map((it, idx) => ({
    dealer_id: dealerId,
    sales_order_id: salesOrderId,
    product_id: it.product_id || null,
    product_name_snapshot: it.product_name_snapshot,
    product_sku_snapshot: it.product_sku_snapshot || null,
    unit_type: it.unit_type,
    per_box_sft: it.per_box_sft ?? null,
    quantity: it.quantity,
    rate: it.rate,
    discount_value: it.discount_value || 0,
    line_total: calcLineTotal(it),
    rate_source: it.rate_source ?? 'default',
    tier_id: it.tier_id ?? null,
    preferred_shade_code: it.preferred_shade_code || null,
    preferred_caliber: it.preferred_caliber || null,
    preferred_batch_no: it.preferred_batch_no || null,
    sort_order: idx,
  }));
  await trx('sales_order_items').insert(rows);
}

/* ----- LIST / DETAIL ----- */

router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const projectId = (req.query.projectId as string) || null;
    const customerId = (req.query.customerId as string) || null;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    let q = db('sales_orders as so')
      .leftJoin('customers as c', 'c.id', 'so.customer_id')
      .leftJoin('projects as p', 'p.id', 'so.project_id')
      .where('so.dealer_id', dealerId);
    if (status) q = q.where('so.status', status);
    if (projectId) q = q.where('so.project_id', projectId);
    if (customerId) q = q.where('so.customer_id', customerId);
    if (search) {
      q = q.where(function () {
        this.where('so.so_number', 'ilike', `%${search}%`).orWhere('so.customer_name_text', 'ilike', `%${search}%`);
      });
    }

    const totalRow = await q.clone().clearSelect().clearOrder().count<{ count: string }[]>('so.id as count');
    const total = Number(totalRow[0]?.count ?? 0);

    const rows = await q
      .orderBy('so.created_at', 'desc')
      .limit(PAGE_SIZE)
      .offset(offset)
      .select('so.*', 'c.name as c_name', 'c.phone as c_phone', 'p.project_name as p_name', 'p.project_code as p_code');

    const data = rows.map((r: any) => {
      const { c_name, c_phone, p_name, p_code, ...rest } = r;
      return {
        ...rest,
        customers: c_name ? { name: c_name, phone: c_phone } : null,
        projects: p_name ? { project_name: p_name, project_code: p_code } : null,
      };
    });
    res.json({ data, total });
  } catch (e: any) {
    console.error('[sales-orders GET]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load sales orders' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('sales_orders as so')
      .leftJoin('customers as c', 'c.id', 'so.customer_id')
      .where('so.id', req.params.id)
      .where('so.dealer_id', dealerId)
      .first('so.*', 'c.id as c_id', 'c.name as c_name', 'c.phone as c_phone', 'c.address as c_address');
    if (!row) return res.status(404).json({ error: 'Sales order not found' });
    const { c_id, c_name, c_phone, c_address, ...rest } = row;
    res.json({
      data: {
        ...rest,
        customers: c_id ? { id: c_id, name: c_name, phone: c_phone, address: c_address } : null,
      },
    });
  } catch (e: any) {
    console.error('[sales-orders GET id]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load sales order' });
  }
});

router.get('/:id/items', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('sales_order_items as soi')
      .leftJoin('products as p', 'p.id', 'soi.product_id')
      .leftJoin('stock_reservations as sr', 'sr.id', 'soi.reservation_id')
      .where({ 'soi.sales_order_id': req.params.id, 'soi.dealer_id': dealerId })
      .orderBy('soi.sort_order', 'asc')
      .select(
        'soi.*',
        'p.pieces_per_box as pieces_per_box',
        'sr.status as reservation_status',
      );

    // Caliber validation (informational only — no auto-matching): resolve
    // preferred_batch_no to its actual batch caliber where possible.
    const batchNos = Array.from(new Set(rows.map((r: any) => r.preferred_batch_no).filter(Boolean)));
    const productIds = Array.from(new Set(rows.map((r: any) => r.product_id).filter(Boolean)));
    let batchByProductAndNo = new Map<string, string | null>();
    if (batchNos.length && productIds.length) {
      const batches = await db('product_batches')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', productIds)
        .whereIn('batch_no', batchNos)
        .select('product_id', 'batch_no', 'caliber');
      batchByProductAndNo = new Map(batches.map((b: any) => [`${b.product_id}::${b.batch_no}`, b.caliber]));
    }

    const data = rows.map((r: any) => {
      const actualCaliber = r.product_id && r.preferred_batch_no
        ? batchByProductAndNo.get(`${r.product_id}::${r.preferred_batch_no}`) ?? null
        : null;
      return {
        ...r,
        caliber_mismatch: hasCaliberMismatch(r.preferred_caliber, actualCaliber),
        actual_batch_caliber: actualCaliber,
      };
    });
    res.json({ data });
  } catch (e: any) {
    console.error('[sales-orders items]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load items' });
  }
});

/* ----- CREATE / EDIT (draft-only) ----- */

router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    }
    const f = parsed.data;
    const totals = calcTotals(f.items, f.discount_type, f.discount_value);
    const userId = req.user?.userId ?? null;
    const draftNo = `SO-DRAFT-${Date.now()}`;

    const created = await db.transaction(async (trx) => {
      const [so] = await trx('sales_orders')
        .insert({
          dealer_id: dealerId,
          so_number: draftNo,
          status: 'draft',
          customer_id: f.customer_id || null,
          customer_name_text: f.customer_name_text?.trim() || null,
          customer_phone_text: f.customer_phone_text?.trim() || null,
          customer_address_text: f.customer_address_text?.trim() || null,
          quotation_id: f.quotation_id || null,
          project_id: f.project_id || null,
          site_id: f.site_id || null,
          salesperson_id: f.salesperson_id || null,
          order_date: f.order_date,
          subtotal: totals.subtotal,
          discount_type: f.discount_type,
          discount_value: f.discount_value,
          total_amount: totals.total_amount,
          planned_delivery_date: f.planned_delivery_date || null,
          notes: f.notes?.trim() || null,
          terms_text: f.terms_text?.trim() || null,
          created_by: userId,
        })
        .returning('*');
      await insertItems(trx, dealerId, so.id, f.items);
      return so;
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    console.error('[sales-orders POST]', e.message);
    res.status(500).json({ error: e.message || 'Failed to create sales order' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
    }
    const f = parsed.data;
    const totals = calcTotals(f.items, f.discount_type, f.discount_value);

    await db.transaction(async (trx) => {
      const existing = await trx('sales_orders').where({ id: req.params.id, dealer_id: dealerId }).first('id', 'status');
      if (!existing) throw new Error('Sales order not found');
      if (existing.status !== 'draft') throw new Error('Only draft sales orders can be edited this way.');
      await trx('sales_orders')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({
          customer_id: f.customer_id || null,
          customer_name_text: f.customer_name_text?.trim() || null,
          customer_phone_text: f.customer_phone_text?.trim() || null,
          customer_address_text: f.customer_address_text?.trim() || null,
          project_id: f.project_id || null,
          site_id: f.site_id || null,
          salesperson_id: f.salesperson_id || null,
          order_date: f.order_date,
          subtotal: totals.subtotal,
          discount_type: f.discount_type,
          discount_value: f.discount_value,
          total_amount: totals.total_amount,
          planned_delivery_date: f.planned_delivery_date || null,
          notes: f.notes?.trim() || null,
          terms_text: f.terms_text?.trim() || null,
          updated_at: new Date().toISOString(),
        });
      await trx('sales_order_items').where({ sales_order_id: req.params.id, dealer_id: dealerId }).del();
      await insertItems(trx, dealerId, req.params.id, f.items);
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error('[sales-orders PUT]', e.message);
    const status = e.message === 'Sales order not found' ? 404 : e.message?.includes('draft') ? 409 : 500;
    res.status(status).json({ error: e.message || 'Failed to update sales order' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const n = await db('sales_orders').where({ id: req.params.id, dealer_id: dealerId, status: 'draft' }).del();
    if (!n) return res.status(409).json({ error: 'Only draft sales orders can be deleted.' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[sales-orders DELETE]', e.message);
    res.status(500).json({ error: e.message || 'Failed to delete' });
  }
});

/* ----- RESERVATION HELPERS (reuse Sprint 3C RPCs directly — never duplicated) ----- */

/**
 * Reserve stock for one sales_order_item, capping the request at real
 * availability (product-level and, when a preferred batch resolves,
 * batch-level too) BEFORE calling create_stock_reservation — so the RPC
 * (which has no availability check for product-level reservations, and
 * would throw for an over-capacity batch-level one) never has to reject
 * anything. This is how "handle partial reservations if stock is limited"
 * is satisfied without touching the RPC itself. Runs in its own
 * transaction per item so each item's availability read reflects the
 * reservations already committed by earlier items in the same order.
 */
async function reserveItemStock(
  dealerId: string,
  customerId: string,
  soNumber: string,
  item: { id: string; product_id: string | null; unit_type: 'box_sft' | 'piece'; quantity: number | string; preferred_batch_no: string | null },
  userId: string | null,
): Promise<{ reservation_id: string | null; reserved_qty: number }> {
  if (!item.product_id) return { reservation_id: null, reserved_qty: 0 };

  const availability = await computeAvailability(dealerId, item.product_id);
  let batchId: string | null = null;
  let cappedAvailablePieces = availability.available_pieces;

  if (item.preferred_batch_no) {
    const batches = await computeBatchAvailability(dealerId, item.product_id);
    const match = batches.find((b) => b.batch_no === item.preferred_batch_no);
    if (match) {
      batchId = match.batch_id;
      cappedAvailablePieces = Math.min(cappedAvailablePieces, match.available_pieces);
    }
  }

  const reservableQty = computeReservableQty(
    Number(item.quantity),
    cappedAvailablePieces,
    item.unit_type,
    availability.pieces_per_box,
  );

  if (reservableQty <= 0) return { reservation_id: null, reserved_qty: 0 };

  return db.transaction(async (trx) => {
    const r = await trx.raw(
      `select create_stock_reservation(
         ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::numeric, ?::text, ?::text, ?::timestamptz, ?::uuid
       ) as id`,
      [dealerId, item.product_id, batchId, customerId, reservableQty, item.unit_type, `Sales Order ${soNumber}`, null, userId],
    );
    const reservationId = r?.rows?.[0]?.id as string;
    await trx('stock_reservations').where({ id: reservationId }).update({ source_type: 'sales_order', source_id: item.id });
    await trx('audit_logs').insert({
      dealer_id: dealerId,
      user_id: userId,
      action: 'RESERVATION_CREATED',
      table_name: 'stock_reservations',
      record_id: reservationId,
      new_data: { product_id: item.product_id, batch_id: batchId, customer_id: customerId, reserved_qty: reservableQty, source_type: 'sales_order', source_id: item.id },
    });
    return { reservation_id: reservationId, reserved_qty: reservableQty };
  });
}

async function releaseItemReservation(dealerId: string, reservationId: string, userId: string | null, reason: string): Promise<void> {
  await db.transaction(async (trx) => {
    const res = await trx('stock_reservations').where({ id: reservationId, dealer_id: dealerId }).first('status');
    if (!res || res.status !== 'active') return;
    await trx.raw(`select release_stock_reservation(?::uuid, ?::uuid, ?::text)`, [reservationId, dealerId, reason]);
    await trx('audit_logs').insert({
      dealer_id: dealerId,
      user_id: userId,
      action: 'RESERVATION_RELEASED',
      table_name: 'stock_reservations',
      record_id: reservationId,
      new_data: { release_reason: reason },
    });
  });
}

/* ----- CONFIRM ("Approve Sales Order") ----- */

router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const so = await db('sales_orders').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!so) return res.status(404).json({ error: 'Sales order not found' });
    if (so.status !== 'draft') return res.status(409).json({ error: 'Only draft sales orders can be confirmed.' });
    if (!so.customer_id) {
      return res.status(400).json({ error: 'A linked customer is required to confirm a sales order (stock reservations require one) — link a registered customer first.' });
    }

    const r = await db.raw('SELECT generate_next_sales_order_no(?::uuid) AS no', [dealerId]);
    const soNumber = String(r.rows?.[0]?.no ?? '');
    if (!soNumber) return res.status(500).json({ error: 'Failed to generate sales order number' });

    await db('sales_orders')
      .where({ id: so.id, dealer_id: dealerId })
      .update({ status: 'confirmed', so_number: soNumber, confirmed_by: userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    const items = await db('sales_order_items').where({ sales_order_id: so.id, dealer_id: dealerId }).orderBy('sort_order', 'asc');
    const warnings: { item_id: string; message: string }[] = [];
    for (const item of items) {
      const outcome = await reserveItemStock(dealerId, so.customer_id, soNumber, item, userId);
      await db('sales_order_items').where({ id: item.id }).update({ reservation_id: outcome.reservation_id, reserved_qty: outcome.reserved_qty });
      if (item.product_id && outcome.reserved_qty < Number(item.quantity)) {
        warnings.push({
          item_id: item.id,
          message: outcome.reserved_qty <= 0
            ? `No stock available to reserve for "${item.product_name_snapshot}".`
            : `Only ${outcome.reserved_qty} of ${item.quantity} reserved for "${item.product_name_snapshot}" — stock is limited.`,
        });
      }
    }

    const updatedItems = await db('sales_order_items').where({ sales_order_id: so.id, dealer_id: dealerId }).orderBy('sort_order', 'asc');
    const readiness = computeDeliveryReadiness(updatedItems);
    await db('sales_orders').where({ id: so.id }).update({ delivery_readiness: readiness });

    const updated = await db('sales_orders').where({ id: so.id, dealer_id: dealerId }).first();
    res.json({ data: updated, warnings });
  } catch (e: any) {
    console.error('[sales-orders confirm]', e.message);
    res.status(500).json({ error: e.message || 'Failed to confirm sales order' });
  }
});

/* ----- CANCEL ----- */

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;
    const reason = String(req.body?.cancel_reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'cancel_reason is required' });

    const so = await db('sales_orders').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!so) return res.status(404).json({ error: 'Sales order not found' });
    if (!['draft', 'confirmed', 'partially_delivered'].includes(so.status)) {
      return res.status(409).json({ error: `Sales order cannot be cancelled from status '${so.status}'.` });
    }

    const items = await db('sales_order_items').where({ sales_order_id: so.id, dealer_id: dealerId }).whereNotNull('reservation_id');
    for (const item of items) {
      await releaseItemReservation(dealerId, item.reservation_id, userId, `Sales Order ${so.so_number} cancelled: ${reason}`);
    }
    await db('sales_order_items').where({ sales_order_id: so.id, dealer_id: dealerId }).whereNotNull('reservation_id').update({ reservation_id: null, reserved_qty: 0 });

    await db('sales_orders')
      .where({ id: so.id, dealer_id: dealerId })
      .update({ status: 'cancelled', cancelled_by: userId, cancelled_at: new Date().toISOString(), cancel_reason: reason, updated_at: new Date().toISOString() });

    res.json({ ok: true });
  } catch (e: any) {
    console.error('[sales-orders cancel]', e.message);
    res.status(500).json({ error: e.message || 'Failed to cancel sales order' });
  }
});

/* ----- EDIT A LINE ITEM ON A CONFIRMED ORDER (updates reservation qty) ----- */

const itemEditSchema = z.object({ quantity: z.coerce.number().min(0) });

router.patch('/:id/items/:itemId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;
    const parsed = itemEditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });

    const so = await db('sales_orders').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!so) return res.status(404).json({ error: 'Sales order not found' });
    if (!['confirmed', 'partially_delivered'].includes(so.status)) {
      return res.status(409).json({ error: `Line items can only be edited this way while the order is confirmed or partially delivered (current: '${so.status}').` });
    }
    const item = await db('sales_order_items').where({ id: req.params.itemId, sales_order_id: so.id, dealer_id: dealerId }).first();
    if (!item) return res.status(404).json({ error: 'Sales order item not found' });

    const newQty = parsed.data.quantity;

    // Release the old reservation (if any) before re-reserving at the new quantity.
    if (item.reservation_id) {
      await releaseItemReservation(dealerId, item.reservation_id, userId, `Sales Order ${so.so_number} — quantity changed`);
    }

    const lineTotal = calcLineTotal({ quantity: newQty, rate: Number(item.rate), discount_value: Number(item.discount_value) });
    await db('sales_order_items').where({ id: item.id }).update({ quantity: newQty, line_total: lineTotal, reservation_id: null, reserved_qty: 0 });

    let outcome = { reservation_id: null as string | null, reserved_qty: 0 };
    if (so.customer_id) {
      outcome = await reserveItemStock(
        dealerId,
        so.customer_id,
        so.so_number,
        { id: item.id, product_id: item.product_id, unit_type: item.unit_type, quantity: newQty, preferred_batch_no: item.preferred_batch_no },
        userId,
      );
      await db('sales_order_items').where({ id: item.id }).update({ reservation_id: outcome.reservation_id, reserved_qty: outcome.reserved_qty });
    }

    const items = await db('sales_order_items').where({ sales_order_id: so.id, dealer_id: dealerId });
    const totals = calcTotals(items.map((it: any) => ({ quantity: Number(it.quantity), rate: Number(it.rate), discount_value: Number(it.discount_value) })), so.discount_type, Number(so.discount_value));
    const readiness = computeDeliveryReadiness(items);
    await db('sales_orders').where({ id: so.id }).update({ subtotal: totals.subtotal, total_amount: totals.total_amount, delivery_readiness: readiness, updated_at: new Date().toISOString() });

    const warning = item.product_id && outcome.reserved_qty < newQty
      ? (outcome.reserved_qty <= 0 ? 'No stock available to reserve at the new quantity.' : `Only ${outcome.reserved_qty} of ${newQty} reserved — stock is limited.`)
      : null;
    res.json({ ok: true, reservation_id: outcome.reservation_id, reserved_qty: outcome.reserved_qty, warning });
  } catch (e: any) {
    console.error('[sales-orders item edit]', e.message);
    res.status(500).json({ error: e.message || 'Failed to update line item' });
  }
});

/* ----- DELIVERY PLANNING ----- */

const deliveryPlanningSchema = z.object({
  planned_delivery_date: z.string().nullable().optional(),
  delivery_readiness: z.enum(['pending', 'ready', 'partially_ready']).optional(),
});

router.patch('/:id/delivery-planning', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = deliveryPlanningSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.planned_delivery_date !== undefined) patch.planned_delivery_date = parsed.data.planned_delivery_date;
    if (parsed.data.delivery_readiness !== undefined) patch.delivery_readiness = parsed.data.delivery_readiness;

    const [row] = await db('sales_orders')
      .where({ id: req.params.id, dealer_id: dealerId })
      .whereIn('status', ['draft', 'confirmed', 'partially_delivered'])
      .update(patch)
      .returning('*');
    if (!row) return res.status(409).json({ error: 'Sales order not found or not editable in its current status.' });
    res.json({ data: row });
  } catch (e: any) {
    console.error('[sales-orders delivery-planning]', e.message);
    res.status(500).json({ error: e.message || 'Failed to update delivery planning' });
  }
});

/* ----- QUOTATION -> SALES ORDER CONVERSION ----- */

router.post('/from-quotation/:quotationId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const quote = await db('quotations').where({ id: req.params.quotationId, dealer_id: dealerId }).first();
    if (!quote) return res.status(404).json({ error: 'Quotation not found' });
    if (quote.status !== 'active') {
      return res.status(409).json({ error: `Quotation is ${quote.status} — only active (approved) quotations can be converted to a Sales Order.` });
    }
    const quoteItems = await db('quotation_items').where({ quotation_id: quote.id, dealer_id: dealerId }).orderBy('sort_order', 'asc');
    if (!quoteItems.length) return res.status(400).json({ error: 'Quotation has no line items to convert.' });

    const draftNo = `SO-DRAFT-${Date.now()}`;
    const created = await db.transaction(async (trx) => {
      const [so] = await trx('sales_orders')
        .insert({
          dealer_id: dealerId,
          so_number: draftNo,
          status: 'draft',
          customer_id: quote.customer_id,
          customer_name_text: quote.customer_name_text,
          customer_phone_text: quote.customer_phone_text,
          customer_address_text: quote.customer_address_text,
          quotation_id: quote.id,
          project_id: quote.project_id,
          site_id: quote.site_id,
          order_date: new Date().toISOString().slice(0, 10),
          subtotal: quote.subtotal,
          discount_type: quote.discount_type,
          discount_value: quote.discount_value,
          total_amount: quote.total_amount,
          notes: quote.notes,
          terms_text: quote.terms_text,
          created_by: userId,
        })
        .returning('*');

      const rows = quoteItems.map((it: any, idx: number) => ({
        dealer_id: dealerId,
        sales_order_id: so.id,
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        product_sku_snapshot: it.product_sku_snapshot,
        unit_type: it.unit_type,
        per_box_sft: it.per_box_sft,
        quantity: it.quantity,
        rate: it.rate,
        discount_value: it.discount_value,
        line_total: it.line_total,
        rate_source: it.rate_source,
        tier_id: it.tier_id,
        preferred_shade_code: it.preferred_shade_code,
        preferred_caliber: it.preferred_caliber,
        preferred_batch_no: it.preferred_batch_no,
        sort_order: idx,
      }));
      await trx('sales_order_items').insert(rows);

      await trx('quotations')
        .where({ id: quote.id, dealer_id: dealerId })
        .update({ converted_sales_order_id: so.id, converted_to_so_by: userId, converted_to_so_at: new Date().toISOString() });

      return so;
    });

    res.status(201).json({ data: created });
  } catch (e: any) {
    console.error('[sales-orders from-quotation]', e.message);
    res.status(500).json({ error: e.message || 'Failed to convert quotation to sales order' });
  }
});

/* ----- SALES ORDER -> INVOICE CONVERSION (V2 Sprint 4C) ----- */

/**
 * Prefill payload for the EXISTING, unmodified /sales/new form — same
 * pattern as quotations.ts's own /:id/conversion-prefill. Deliberately
 * does NOT create a sale itself: the existing POST /api/sales endpoint
 * already has every piece of logic needed (fresh availability/backorder
 * check, VAT, COGS, numbering, ledger posting, and — critically —
 * `reservation_selections` support that calls the existing
 * consume_reservation_for_sale RPC and already special-cases a
 * customer's OWN active reservation as available to them). Reusing it
 * end-to-end means zero inventory/VAT math is duplicated here.
 */
router.post('/:id/invoice-prefill', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const so = await db('sales_orders as so')
      .leftJoin('customers as c', 'c.id', 'so.customer_id')
      .where({ 'so.id': req.params.id, 'so.dealer_id': dealerId })
      .first('so.*', 'c.name as customer_name');
    if (!so) return res.status(404).json({ error: 'Sales order not found' });

    const blockers: string[] = [];
    if (!['confirmed', 'partially_delivered'].includes(so.status)) {
      blockers.push(`Sales order is ${so.status} — only confirmed (or partially delivered) orders can be invoiced.`);
    }
    if (so.converted_sale_id) {
      blockers.push('This sales order has already been converted to an invoice.');
    }
    if (!so.customer_id) {
      blockers.push('Sales order has no linked customer.');
    }

    const items = await db('sales_order_items')
      .where({ sales_order_id: so.id, dealer_id: dealerId })
      .orderBy('sort_order', 'asc');

    const saleItems = items
      .filter((it: any) => !!it.product_id)
      .map((it: any) => ({ product_id: it.product_id, quantity: Number(it.quantity), sale_rate: Number(it.rate) }));

    const reservationSelections: Record<string, Array<{ reservation_id: string; consume_qty: number }>> = {};
    for (const it of items as any[]) {
      if (!it.product_id || !it.reservation_id || Number(it.reserved_qty) <= 0) continue;
      const arr = reservationSelections[it.product_id] ?? [];
      arr.push({ reservation_id: it.reservation_id, consume_qty: Number(it.reserved_qty) });
      reservationSelections[it.product_id] = arr;
    }

    const customLines = items.filter((it: any) => !it.product_id);
    if (customLines.length > 0) {
      blockers.push(`${customLines.length} custom line(s) without a product link cannot be invoiced — remove them or edit the order.`);
    }

    const subtotal = items.reduce((s: number, it: any) => s + Number(it.line_total ?? 0), 0);
    const discountAmount =
      so.discount_type === 'percent'
        ? Math.round(((subtotal * Number(so.discount_value)) / 100) * 100) / 100
        : Number(so.discount_value);

    res.json({
      data: {
        sales_order_id: so.id,
        so_number: so.so_number,
        customer_name: so.customer_name ?? so.customer_name_text ?? '',
        items: saleItems,
        reservation_selections: reservationSelections,
        discount: discountAmount,
        notes: [so.notes, `From Sales Order ${so.so_number}`].filter(Boolean).join(' · '),
        project_id: so.project_id ?? null,
        site_id: so.site_id ?? null,
        blockers,
      },
    });
  } catch (e: any) {
    console.error('[sales-orders invoice-prefill]', e.message);
    res.status(500).json({ error: e.message || 'Failed to prepare invoice conversion' });
  }
});

router.post('/:id/link-to-sale', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;
    const saleId = String(req.body?.saleId ?? req.body?.sale_id ?? '');
    if (!saleId) return res.status(400).json({ error: 'saleId required' });

    const [row] = await db('sales_orders')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ converted_sale_id: saleId, converted_to_sale_by: userId, converted_to_sale_at: new Date().toISOString() })
      .returning('id');
    if (!row) return res.status(404).json({ error: 'Sales order not found' });
    res.json({ ok: true });
  } catch (e: any) {
    console.error('[sales-orders link-to-sale]', e.message);
    res.status(500).json({ error: e.message || 'Failed to link sales order to sale' });
  }
});

export default router;
