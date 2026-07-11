/**
 * Deliveries routes — Phase 3O.
 *
 *   POST  /api/deliveries                ← create delivery (over-delivery guard, batch RPC, sale_status sync)
 *   PATCH /api/deliveries/:id/status     ← update delivery status
 *
 * Atomic semantics: each mutation wraps all side-effects in a single Knex
 * transaction so a failure rolls back partial state. Reads continue to use
 * the existing Supabase service for now (Phase 3O is mutations-only).
 *
 * Per-line fulfillment promotion mirrors the legacy deliveryService:
 *   delivered >= ordered  → 'fulfilled'
 *   0 < delivered < ord.  → 'partially_delivered'
 *   else                  → leave allocation-derived status untouched
 *
 * Sale-level promotion:
 *   all delivered → 'delivered'
 *   some delivered → 'partially_delivered'
 *   else → leave existing sale_status
 *
 * On full delivery, this route also calls the existing
 * `promote_commission_to_earned_if_fully_delivered(_sale_id, _dealer_id)`
 * SQL function (best-effort; non-fatal on failure).
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
    res.status(403).json({ error: 'Only dealer_admin can manage deliveries' });
    return false;
  }
  return true;
}

function clientMeta(req: Request) {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ua = (req.headers['user-agent'] as string) || null;
  return { ip, ua };
}

async function generateDeliveryNo(trx: any, dealerId: string): Promise<string> {
  const row = await trx('deliveries')
    .where({ dealer_id: dealerId })
    .count('id as count');
  const seq = Number(row?.[0]?.count ?? 0) + 1;
  return `DL-${String(seq).padStart(5, '0')}`;
}

/**
 * Recompute per-line fulfillment_status + sale-level sale_status based on
 * cumulative delivered quantities. Mirrors deliveryService.updateSaleDeliveryStatus.
 */
async function syncSaleDeliveryStatus(trx: any, saleId: string, dealerId: string) {
  const saleItems = await trx('sale_items')
    .where({ sale_id: saleId, dealer_id: dealerId })
    .select('id', 'quantity', 'backorder_qty', 'allocated_qty', 'fulfillment_status');

  const deliveryRows = await trx('deliveries')
    .where({ sale_id: saleId, dealer_id: dealerId })
    .select('id');
  const deliveryIds = deliveryRows.map((d: any) => d.id);

  const deliveredQty: Record<string, number> = {};
  if (deliveryIds.length > 0) {
    const items = await trx('delivery_items')
      .whereIn('delivery_id', deliveryIds)
      .select('sale_item_id', 'quantity');
    for (const it of items) {
      deliveredQty[it.sale_item_id] =
        (deliveredQty[it.sale_item_id] || 0) + Number(it.quantity);
    }
  }

  let totalOrdered = 0;
  let totalDelivered = 0;

  for (const si of saleItems) {
    const ordered = Number(si.quantity);
    const delivered = deliveredQty[si.id] || 0;
    totalOrdered += ordered;
    totalDelivered += delivered;

    let nextStatus: string | null = null;
    if (delivered >= ordered && ordered > 0) {
      nextStatus = 'fulfilled';
    } else if (delivered > 0) {
      nextStatus = 'partially_delivered';
    }
    if (nextStatus && nextStatus !== si.fulfillment_status) {
      await trx('sale_items')
        .where({ id: si.id, dealer_id: dealerId })
        .update({ fulfillment_status: nextStatus });
    }
  }

  let newSaleStatus: string | null = null;
  if (totalDelivered >= totalOrdered && totalOrdered > 0) {
    newSaleStatus = 'delivered';
  } else if (totalDelivered > 0) {
    newSaleStatus = 'partially_delivered';
  }
  if (newSaleStatus) {
    await trx('sales')
      .where({ id: saleId, dealer_id: dealerId })
      .update({ sale_status: newSaleStatus });
  }

  return newSaleStatus;
}

/**
 * Best-effort: promote commission to "earned" once a sale becomes fully
 * delivered. Implemented as a thin SQL helper call; absence of the helper
 * just means commission promotion is skipped (matches Supabase service).
 */
async function tryPromoteCommission(trx: any, saleId: string, dealerId: string) {
  try {
    await trx.raw(
      `select promote_commission_to_earned_if_fully_delivered(?::uuid, ?::uuid)`,
      [saleId, dealerId],
    );
  } catch (e) {
    // Non-fatal: commission promotion helper may not exist yet.
    console.warn('[deliveries] commission promotion skipped:', (e as any)?.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/deliveries
// ────────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  challan_id: z.string().uuid().nullable().optional(),
  sale_id: z.string().uuid().nullable().optional(),
  delivery_date: z.string().min(1),
  receiver_name: z.string().nullable().optional(),
  receiver_phone: z.string().nullable().optional(),
  delivery_address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        sale_item_id: z.string().uuid(),
        product_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
      }),
    )
    .optional(),
});

router.post('/', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = req.user?.userId ?? null;
  const { ip, ua } = clientMeta(req);

  try {
    const deliveryId = await db.transaction(async (trx) => {
      // ----- Server-side over-delivery guard -----
      if (input.sale_id && input.items && input.items.length > 0) {
        const saleItems = await trx('sale_items')
          .where({ sale_id: input.sale_id, dealer_id: dealerId })
          .select('id', 'quantity');
        const orderedById = new Map<string, number>();
        for (const si of saleItems) orderedById.set(si.id, Number(si.quantity));

        // Existing delivered totals
        const priorDeliveries = await trx('deliveries')
          .where({ sale_id: input.sale_id, dealer_id: dealerId })
          .select('id');
        const priorIds = priorDeliveries.map((d: any) => d.id);
        const alreadyDelivered: Record<string, number> = {};
        if (priorIds.length > 0) {
          const priorItems = await trx('delivery_items')
            .whereIn('delivery_id', priorIds)
            .select('sale_item_id', 'quantity');
          for (const it of priorItems) {
            alreadyDelivered[it.sale_item_id] =
              (alreadyDelivered[it.sale_item_id] || 0) + Number(it.quantity);
          }
        }

        for (const item of input.items) {
          const ordered = orderedById.get(item.sale_item_id);
          if (ordered === undefined) {
            throw new Error('Delivery item does not belong to the referenced sale.');
          }
          const prior = alreadyDelivered[item.sale_item_id] || 0;
          const remaining = Math.max(0, ordered - prior);
          if (Number(item.quantity) > remaining + 1e-9) {
            throw new Error(
              `Cannot deliver ${item.quantity} — only ${remaining} remaining for this line (ordered ${ordered}, already delivered ${prior}).`,
            );
          }
        }
      }

      const deliveryNo = await generateDeliveryNo(trx, dealerId);

      // Inherit project/site from sale, else challan
      let projectId: string | null = null;
      let siteId: string | null = null;
      if (input.sale_id) {
        const s = await trx('sales')
          .where({ id: input.sale_id, dealer_id: dealerId })
          .first('project_id', 'site_id');
        projectId = s?.project_id ?? null;
        siteId = s?.site_id ?? null;
      }
      if (!projectId && input.challan_id) {
        const c = await trx('challans')
          .where({ id: input.challan_id, dealer_id: dealerId })
          .first('project_id', 'site_id');
        projectId = c?.project_id ?? null;
        siteId = c?.site_id ?? null;
      }

      let resolvedAddress = input.delivery_address || null;
      if (!resolvedAddress && siteId) {
        const site = await trx('project_sites')
          .where({ id: siteId, dealer_id: dealerId })
          .first('address');
        resolvedAddress = site?.address ?? null;
      }

      const [header] = await trx('deliveries')
        .insert({
          dealer_id: dealerId,
          challan_id: input.challan_id || null,
          sale_id: input.sale_id || null,
          delivery_date: input.delivery_date,
          status: 'pending',
          receiver_name: input.receiver_name || null,
          receiver_phone: input.receiver_phone || null,
          delivery_address: resolvedAddress,
          notes: input.notes || null,
          created_by: userId,
          delivery_no: deliveryNo,
          project_id: projectId,
          site_id: siteId,
        })
        .returning('id');
      const did = header.id;

      // Insert items
      let insertedAny = false;
      if (input.items && input.items.length > 0) {
        const itemRows = input.items
          .filter((i) => Number(i.quantity) > 0)
          .map((i) => ({
            delivery_id: did,
            sale_item_id: i.sale_item_id,
            product_id: i.product_id,
            dealer_id: dealerId,
            quantity: i.quantity,
          }));
        if (itemRows.length > 0) {
          await trx('delivery_items').insert(itemRows);
          insertedAny = true;
        }
      }

      // Best-effort batch tracking via existing RPC (function may not exist).
      if (insertedAny) {
        try {
          await trx.raw(
            `select execute_delivery_batches(?::uuid, ?::uuid)`,
            [did, dealerId],
          );
        } catch (e) {
          console.warn('[deliveries] batch tracking skipped:', (e as any)?.message);
        }
      }

      // Refresh sale-level + per-line fulfillment status
      let promotedSaleStatus: string | null = null;
      if (input.sale_id) {
        promotedSaleStatus = await syncSaleDeliveryStatus(trx, input.sale_id, dealerId);
        if (promotedSaleStatus === 'delivered') {
          await tryPromoteCommission(trx, input.sale_id, dealerId);
        }
      }

      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'delivery_create',
        table_name: 'deliveries',
        record_id: did,
        new_data: {
          delivery_no: deliveryNo,
          sale_id: input.sale_id || null,
          challan_id: input.challan_id || null,
          item_count: input.items?.length ?? 0,
          promoted_sale_status: promotedSaleStatus,
        },
        ip_address: ip,
        user_agent: ua,
      });

      return did;
    });

    const created = await db('deliveries').where({ id: deliveryId }).first();
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[deliveries.create] error', err);
    res.status(500).json({ error: err?.message || 'Failed to create delivery' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /api/deliveries/:id/status
// ────────────────────────────────────────────────────────────────────────────

const statusSchema = z.object({
  status: z.string().min(1),
  dealer_id: z.string().uuid().optional(),
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { status } = parsed.data;
  const userId = req.user?.userId ?? null;
  const { ip, ua } = clientMeta(req);
  const id = req.params.id;

  try {
    await db.transaction(async (trx) => {
      const existing = await trx('deliveries')
        .where({ id, dealer_id: dealerId })
        .first('id');
      if (!existing) throw new Error('Delivery not found');

      // V2 Sprint 4C — Delivery Confirmation: stamp who/when the moment a
      // delivery is actually confirmed as delivered, distinct from just the
      // status string flipping (which could otherwise be set by any bulk
      // update with no audited "confirmation" moment).
      const isConfirming = status === 'delivered';
      await trx('deliveries')
        .where({ id })
        .update({
          status,
          ...(isConfirming ? { confirmed_by: userId, confirmed_at: trx.fn.now() } : {}),
        });

      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'delivery_status_update',
        table_name: 'deliveries',
        record_id: id,
        new_data: { status, confirmed: isConfirming },
        ip_address: ip,
        user_agent: ua,
      });
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[deliveries.status] error', err);
    res.status(500).json({ error: err?.message || 'Failed to update delivery status' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3U-24: Read endpoints (list, getById, batches, deliveredQty, stock)
// All shape-compatible with the legacy Supabase deliveryService payloads so
// the existing UI components (DeliveryList, DeliveryDetailDialog,
// CreateDeliveryDialog, BackorderReports) work without changes.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

/**
 * GET /api/deliveries
 *   ?page=1&statusFilter=pending|in_transit|delivered|cancelled|all
 *   ?projectId=<uuid>&siteId=<uuid>
 *
 * Returns: { data: Delivery[], total: number }
 * Each delivery row is enriched with:
 *   challans:        { challan_no } | null
 *   sales:           { invoice_number, customers: { name, phone, address } } | null
 *   projects:        { id, project_name, project_code } | null
 *   project_sites:   { id, site_name, address } | null
 *   delivery_items:  Array<{ id, quantity, products: { name, unit_type } }>
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const statusFilter = (req.query.statusFilter as string) || 'all';
    const projectId = (req.query.projectId as string) || null;
    const siteId = (req.query.siteId as string) || null;
    const offset = (page - 1) * PAGE_SIZE;

    let base = db('deliveries').where({ dealer_id: dealerId });
    if (statusFilter && statusFilter !== 'all') base = base.where({ status: statusFilter });
    if (projectId) base = base.where({ project_id: projectId });
    if (siteId) base = base.where({ site_id: siteId });

    const [{ count }] = await base.clone().count<{ count: string }[]>('id as count');
    const total = Number(count ?? 0);

    const rows = await base
      .clone()
      .orderBy('delivery_date', 'desc')
      .limit(PAGE_SIZE)
      .offset(offset)
      .select('*');

    if (rows.length === 0) {
      res.json({ data: [], total });
      return;
    }

    const ids = rows.map((r: any) => r.id);
    const challanIds = rows.map((r: any) => r.challan_id).filter(Boolean);
    const saleIds = rows.map((r: any) => r.sale_id).filter(Boolean);
    const projectIds = rows.map((r: any) => r.project_id).filter(Boolean);
    const siteIds = rows.map((r: any) => r.site_id).filter(Boolean);

    const [challans, sales, projects, sites, items] = await Promise.all([
      challanIds.length
        ? db('challans').whereIn('id', challanIds).select('id', 'challan_no')
        : Promise.resolve([]),
      saleIds.length
        ? db('sales as s')
            .leftJoin('customers as c', 's.customer_id', 'c.id')
            .whereIn('s.id', saleIds)
            .select(
              's.id',
              's.invoice_number',
              'c.id as customer_id',
              'c.name as customer_name',
              'c.phone as customer_phone',
              'c.address as customer_address',
            )
        : Promise.resolve([]),
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'project_name', 'project_code')
        : Promise.resolve([]),
      siteIds.length
        ? db('project_sites').whereIn('id', siteIds).select('id', 'site_name', 'address')
        : Promise.resolve([]),
      db('delivery_items as di')
        .leftJoin('products as p', 'di.product_id', 'p.id')
        .whereIn('di.delivery_id', ids)
        .select(
          'di.id',
          'di.delivery_id',
          'di.quantity',
          'p.name as product_name',
          'p.unit_type as product_unit_type',
          'p.pieces_per_box as product_ppb',
        ),
    ]);

    const challanMap = new Map<string, any>(challans.map((c: any) => [c.id, c]));
    const saleMap = new Map<string, any>(
      sales.map((s: any) => [
        s.id,
        {
          id: s.id,
          invoice_number: s.invoice_number,
          customers: s.customer_id
            ? { name: s.customer_name, phone: s.customer_phone, address: s.customer_address }
            : null,
        },
      ]),
    );
    const projectMap = new Map<string, any>(projects.map((p: any) => [p.id, p]));
    const siteMap = new Map<string, any>(sites.map((s: any) => [s.id, s]));
    const itemsByDelivery = new Map<string, any[]>();
    for (const it of items as any[]) {
      const arr = itemsByDelivery.get(it.delivery_id) ?? [];
      arr.push({
        id: it.id,
        quantity: Number(it.quantity),
        products: {
          name: it.product_name,
          unit_type: it.product_unit_type,
          pieces_per_box: Number(it.product_ppb) || 1,
        },
      });
      itemsByDelivery.set(it.delivery_id, arr);
    }

    const data = rows.map((r: any) => ({
      ...r,
      challans: r.challan_id ? challanMap.get(r.challan_id) ?? null : null,
      sales: r.sale_id ? saleMap.get(r.sale_id) ?? null : null,
      projects: r.project_id ? projectMap.get(r.project_id) ?? null : null,
      project_sites: r.site_id ? siteMap.get(r.site_id) ?? null : null,
      delivery_items: itemsByDelivery.get(r.id) ?? [],
    }));

    res.json({ data, total });
  } catch (err: any) {
    console.error('[deliveries.list] error', err);
    res.status(500).json({ error: err?.message || 'Failed to list deliveries' });
  }
});

/**
 * GET /api/deliveries/sale/:saleId/delivered-qty
 *   → Record<sale_item_id, qty>
 * MUST come before /:id to avoid path collision.
 */
router.get('/sale/:saleId/delivered-qty', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const { saleId } = req.params;

    const rows = await db('deliveries as d')
      .innerJoin('delivery_items as di', 'di.delivery_id', 'd.id')
      .where('d.dealer_id', dealerId)
      .where('d.sale_id', saleId)
      .select('di.sale_item_id', 'di.quantity');

    const result: Record<string, number> = {};
    for (const r of rows as any[]) {
      result[r.sale_item_id] = (result[r.sale_item_id] || 0) + Number(r.quantity);
    }
    res.json(result);
  } catch (err: any) {
    console.error('[deliveries.deliveredQty] error', err);
    res.status(500).json({ error: err?.message || 'Failed to get delivered quantities' });
  }
});

/**
 * GET /api/deliveries/stock?productIds=id1,id2,...
 *   → Record<product_id, { box_qty, piece_qty }>
 * Used by CreateDeliveryDialog to gate over-delivery client-side.
 */
router.get('/stock', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const raw = (req.query.productIds as string) || '';
    const productIds = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (productIds.length === 0) {
      res.json({});
      return;
    }
    const rows = await db('stock')
      .whereIn('product_id', productIds)
      .where({ dealer_id: dealerId })
      .select('product_id', 'box_qty', 'piece_qty');
    const result: Record<string, { box_qty: number; piece_qty: number }> = {};
    for (const r of rows as any[]) {
      result[r.product_id] = { box_qty: Number(r.box_qty), piece_qty: Number(r.piece_qty) };
    }
    res.json(result);
  } catch (err: any) {
    console.error('[deliveries.stock] error', err);
    res.status(500).json({ error: err?.message || 'Failed to get stock' });
  }
});

/**
 * GET /api/deliveries/:id/batches
 *   → Array<delivery_item_batches row + product_batches snapshot>
 */
router.get('/:id/batches', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const { id } = req.params;

    const rows = await db('delivery_item_batches as dib')
      .innerJoin('delivery_items as di', 'di.id', 'dib.delivery_item_id')
      .leftJoin('product_batches as pb', 'pb.id', 'dib.batch_id')
      .where('di.delivery_id', id)
      .where('dib.dealer_id', dealerId)
      .select(
        'dib.*',
        'pb.batch_no as pb_batch_no',
        'pb.shade_code as pb_shade_code',
        'pb.caliber as pb_caliber',
        'pb.lot_no as pb_lot_no',
      );

    const data = rows.map((r: any) => {
      const { pb_batch_no, pb_shade_code, pb_caliber, pb_lot_no, ...rest } = r;
      return {
        ...rest,
        product_batches: {
          batch_no: pb_batch_no,
          shade_code: pb_shade_code,
          caliber: pb_caliber,
          lot_no: pb_lot_no,
        },
      };
    });
    res.json(data);
  } catch (err: any) {
    console.error('[deliveries.batches] error', err);
    res.status(500).json({ error: err?.message || 'Failed to get delivery batches' });
  }
});

/**
 * GET /api/deliveries/:id
 *   Full detail with sales, customers, items, products, projects, sites.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const { id } = req.params;

    const delivery = await db('deliveries')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!delivery) {
      res.status(404).json({ error: 'Delivery not found' });
      return;
    }

    const [challan, saleRow, project, site, deliveryItems, saleItems] = await Promise.all([
      delivery.challan_id
        ? db('challans').where({ id: delivery.challan_id }).first('id', 'challan_no')
        : Promise.resolve(null),
      delivery.sale_id
        ? db('sales as s')
            .leftJoin('customers as c', 's.customer_id', 'c.id')
            .where('s.id', delivery.sale_id)
            .first(
              's.id',
              's.invoice_number',
              'c.name as customer_name',
              'c.phone as customer_phone',
              'c.address as customer_address',
            )
        : Promise.resolve(null),
      delivery.project_id
        ? db('projects')
            .where({ id: delivery.project_id })
            .first('id', 'project_name', 'project_code')
        : Promise.resolve(null),
      delivery.site_id
        ? db('project_sites')
            .where({ id: delivery.site_id })
            .first('id', 'site_name', 'address', 'contact_person', 'contact_phone')
        : Promise.resolve(null),
      db('delivery_items as di')
        .leftJoin('products as p', 'di.product_id', 'p.id')
        .where('di.delivery_id', id)
        .select(
          'di.*',
          'p.name as product_name',
          'p.sku as product_sku',
          'p.unit_type as product_unit_type',
          'p.per_box_sft as product_per_box_sft',
          'p.pieces_per_box as product_ppb',
        ),
      delivery.sale_id
        ? db('sale_items as si')
            .leftJoin('products as p', 'si.product_id', 'p.id')
            .where('si.sale_id', delivery.sale_id)
            .select(
              'si.*',
              'p.name as product_name',
              'p.sku as product_sku',
              'p.unit_type as product_unit_type',
              'p.per_box_sft as product_per_box_sft',
              'p.pieces_per_box as product_ppb',
            )
        : Promise.resolve([]),
    ]);

    const mapItem = (it: any) => {
      const { product_name, product_sku, product_unit_type, product_per_box_sft, product_ppb, ...rest } = it;
      return {
        ...rest,
        products: {
          name: product_name,
          sku: product_sku,
          unit_type: product_unit_type,
          per_box_sft: product_per_box_sft,
          pieces_per_box: Number(product_ppb) || 1,
        },
      };
    };

    const result = {
      ...delivery,
      challans: challan ?? null,
      sales: saleRow
        ? {
            id: saleRow.id,
            invoice_number: saleRow.invoice_number,
            customers: saleRow.customer_name
              ? {
                  name: saleRow.customer_name,
                  phone: saleRow.customer_phone,
                  address: saleRow.customer_address,
                }
              : null,
            sale_items: (saleItems as any[]).map(mapItem),
          }
        : null,
      projects: project ?? null,
      project_sites: site ?? null,
      delivery_items: (deliveryItems as any[]).map(mapItem),
    };

    res.json(result);
  } catch (err: any) {
    console.error('[deliveries.getById] error', err);
    res.status(500).json({ error: err?.message || 'Failed to get delivery' });
  }
});

export default router;

