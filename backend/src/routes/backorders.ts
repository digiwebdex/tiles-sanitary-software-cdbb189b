/**
 * Backorder & Fulfillment route — Phase 3U-21.
 *
 * Frontend reads (BackorderReports.tsx + OwnerDashboard.tsx).
 * All write/allocation logic is already handled atomically inside
 * POST /api/purchases (3K), POST /api/sales (3L), PUT/DELETE /api/sales/:id (3M),
 * and POST /api/returns/* (3N). This route is read-only.
 *
 * Endpoints:
 *   GET /api/backorders/summary               — items with backorder_qty > 0 (full detail)
 *   GET /api/backorders/pending               — items in pending/partially_allocated/ready/partially_delivered
 *   GET /api/backorders/shortage-demand       — aggregated shortage per product
 *   GET /api/backorders/ready-for-delivery    — items fully allocated, awaiting delivery
 *   GET /api/backorders/partially-delivered   — items some-delivered, some-pending
 *   GET /api/backorders/oldest-pending        — single oldest pending line
 *   GET /api/backorders/dashboard-stats       — counts for dashboard widget
 *   GET /api/backorders/sale/:saleId          — fulfillment summary for a specific sale
 *   GET /api/backorders/supplier-links        — V2 Sprint 3C "Supplier Backorder":
 *                                               which purchase (supplier) is expected
 *                                               to cover which customer backorder.
 *                                               Reuses the existing `purchase_shortage_links`
 *                                               table (already written by
 *                                               purchasePlanning.ts) — no new table.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
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

/** Common select for sale_items with product + sale + customer joins. */
async function querySaleItems(
  dealerId: string,
  filters: (qb: any) => any,
): Promise<any[]> {
  const rows = await db('sale_items as si')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .leftJoin('sales as s', 's.id', 'si.sale_id')
    .leftJoin('customers as c', 'c.id', 's.customer_id')
    .where('si.dealer_id', dealerId)
    .modify(filters)
    .select(
      'si.id',
      'si.product_id',
      'si.quantity',
      'si.backorder_qty',
      'si.allocated_qty',
      'si.fulfillment_status',
      'si.sale_id',
      'si.sale_rate',
      'si.created_at',
      'p.name as product_name',
      'p.sku as product_sku',
      'p.unit_type as product_unit_type',
      'p.pieces_per_box as product_pieces_per_box',
      'p.brand as product_brand',
      's.invoice_number',
      's.sale_date',
      's.customer_id',
      'c.name as customer_name',
      'c.phone as customer_phone',
    );

  return rows.map((r: any) => ({
    id: r.id,
    product_id: r.product_id,
    quantity: r.quantity,
    backorder_qty: r.backorder_qty,
    allocated_qty: r.allocated_qty,
    fulfillment_status: r.fulfillment_status,
    sale_id: r.sale_id,
    sale_rate: r.sale_rate,
    created_at: r.created_at,
    products: r.product_name
      ? {
          name: r.product_name,
          sku: r.product_sku,
          unit_type: r.product_unit_type,
          pieces_per_box: r.product_pieces_per_box,
          brand: r.product_brand,
        }
      : null,
    sales: r.invoice_number
      ? {
          invoice_number: r.invoice_number,
          sale_date: r.sale_date,
          customer_id: r.customer_id,
          customers: r.customer_name
            ? { name: r.customer_name, phone: r.customer_phone }
            : null,
        }
      : null,
  }));
}

router.get('/summary', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await querySaleItems(dealerId, (qb) =>
      qb.where('si.backorder_qty', '>', 0).orderBy('si.created_at', 'asc'),
    );
    res.json(rows);
  } catch (err: any) {
    console.error('[backorders/summary]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load backorder summary' });
  }
});

router.get('/pending', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await querySaleItems(dealerId, (qb) =>
      qb
        .whereIn('si.fulfillment_status', [
          'pending',
          'partially_allocated',
          'ready_for_delivery',
          'partially_delivered',
        ])
        .orderBy('si.created_at', 'asc'),
    );
    res.json(rows);
  } catch (err: any) {
    console.error('[backorders/pending]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load pending fulfillment' });
  }
});

router.get('/shortage-demand', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .where('si.dealer_id', dealerId)
      .where('si.backorder_qty', '>', 0)
      .select(
        'si.product_id',
        'si.backorder_qty',
        'si.allocated_qty',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit_type as product_unit_type',
        'p.pieces_per_box as product_pieces_per_box',
        'p.brand as product_brand',
      );

    const productMap = new Map<
      string,
      {
        name: string;
        sku: string;
        unit_type: string;
        pieces_per_box: number;
        brand: string;
        totalShortage: number;
        totalAllocated: number;
        pendingCount: number;
      }
    >();
    for (const item of rows as any[]) {
      const pid = item.product_id;
      const existing = productMap.get(pid);
      if (existing) {
        existing.totalShortage += Number(item.backorder_qty);
        existing.totalAllocated += Number(item.allocated_qty);
        existing.pendingCount++;
      } else {
        productMap.set(pid, {
          name: item.product_name ?? 'Unknown',
          sku: item.product_sku ?? '',
          unit_type: item.product_unit_type ?? 'piece',
          pieces_per_box: Number(item.product_pieces_per_box ?? 1),
          brand: item.product_brand ?? '—',
          totalShortage: Number(item.backorder_qty),
          totalAllocated: Number(item.allocated_qty),
          pendingCount: 1,
        });
      }
    }

    const result = Array.from(productMap.entries())
      .map(([id, v]) => ({
        product_id: id,
        ...v,
        unfulfilledQty: v.totalShortage - v.totalAllocated,
      }))
      .sort((a, b) => b.unfulfilledQty - a.unfulfilledQty);

    res.json(result);
  } catch (err: any) {
    console.error('[backorders/shortage-demand]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load shortage demand' });
  }
});

router.get('/ready-for-delivery', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await querySaleItems(dealerId, (qb) =>
      qb.where('si.fulfillment_status', 'ready_for_delivery'),
    );
    rows.sort((a: any, b: any) => {
      const da = a.sales?.sale_date ?? '';
      const db_ = b.sales?.sale_date ?? '';
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });
    res.json(rows);
  } catch (err: any) {
    console.error('[backorders/ready-for-delivery]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load ready-for-delivery' });
  }
});

router.get('/partially-delivered', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await querySaleItems(dealerId, (qb) =>
      qb.where('si.fulfillment_status', 'partially_delivered'),
    );
    rows.sort((a: any, b: any) => {
      const da = a.sales?.sale_date ?? '';
      const db_ = b.sales?.sale_date ?? '';
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });
    res.json(rows);
  } catch (err: any) {
    console.error('[backorders/partially-delivered]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load partially-delivered' });
  }
});

router.get('/oldest-pending', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await querySaleItems(dealerId, (qb) =>
      qb.whereIn('si.fulfillment_status', [
        'pending',
        'partially_allocated',
        'partially_delivered',
      ]),
    );
    if (rows.length === 0) {
      res.json(null);
      return;
    }
    const oldest = rows.reduce((acc: any, cur: any) => {
      const co = acc?.sales?.sale_date ?? '9999-12-31';
      const cc = cur?.sales?.sale_date ?? '9999-12-31';
      return cc < co ? cur : acc;
    }, rows[0]);
    res.json(oldest);
  } catch (err: any) {
    console.error('[backorders/oldest-pending]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load oldest pending' });
  }
});

router.get('/dashboard-stats', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('sale_items as si')
      .leftJoin('sales as s', 's.id', 'si.sale_id')
      .where('si.dealer_id', dealerId)
      .whereNotIn('si.fulfillment_status', ['in_stock', 'fulfilled', 'cancelled'])
      .select(
        'si.fulfillment_status',
        'si.backorder_qty',
        'si.allocated_qty',
        'si.product_id',
        'si.sale_id',
        's.sale_date',
      );

    const items = rows as any[];
    const totalBackorders = items.filter((i) => Number(i.backorder_qty) > 0).length;
    const pendingFulfillment = items.filter((i) =>
      ['pending', 'partially_allocated', 'partially_delivered'].includes(i.fulfillment_status),
    ).length;
    const readyForDelivery = items.filter(
      (i) => i.fulfillment_status === 'ready_for_delivery',
    ).length;
    const partiallyDelivered = items.filter(
      (i) => i.fulfillment_status === 'partially_delivered',
    ).length;

    const pendingItems = items.filter((i) =>
      ['pending', 'partially_allocated', 'partially_delivered'].includes(i.fulfillment_status),
    );
    const oldestPendingDate = pendingItems.reduce<string | null>((oldest, i) => {
      const d: string | undefined = i.sale_date;
      if (!d) return oldest;
      if (!oldest) return d;
      return d < oldest ? d : oldest;
    }, null);

    res.json({
      totalBackorders,
      pendingFulfillment,
      readyForDelivery,
      partiallyDelivered,
      oldestPendingDate,
    });
  } catch (err: any) {
    console.error('[backorders/dashboard-stats]', err);
    res.json({
      totalBackorders: 0,
      pendingFulfillment: 0,
      readyForDelivery: 0,
      partiallyDelivered: 0,
      oldestPendingDate: null,
    });
  }
});

router.get('/sale/:saleId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const saleId = req.params.saleId;
  try {
    const rows = await db('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .where('si.dealer_id', dealerId)
      .where('si.sale_id', saleId)
      .select(
        'si.id',
        'si.product_id',
        'si.quantity',
        'si.backorder_qty',
        'si.allocated_qty',
        'si.fulfillment_status',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit_type as product_unit_type',
      );

    const result = (rows as any[]).map((r) => ({
      id: r.id,
      product_id: r.product_id,
      quantity: r.quantity,
      backorder_qty: r.backorder_qty,
      allocated_qty: r.allocated_qty,
      fulfillment_status: r.fulfillment_status,
      products: r.product_name
        ? {
            name: r.product_name,
            sku: r.product_sku,
            unit_type: r.product_unit_type,
          }
        : null,
    }));
    res.json(result);
  } catch (err: any) {
    console.error('[backorders/sale]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load fulfillment summary' });
  }
});

// ── GET /api/backorders/supplier-links — "Supplier Backorder" (V2 Sprint 3C) ──
router.get('/supplier-links', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('purchase_shortage_links as psl')
      .innerJoin('sale_items as si', 'si.id', 'psl.sale_item_id')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .leftJoin('sales as s', 's.id', 'si.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('purchases as pu', 'pu.id', 'psl.purchase_id')
      .leftJoin('suppliers as sup', 'sup.id', 'pu.supplier_id')
      .where('psl.dealer_id', dealerId)
      .select(
        'psl.id',
        'psl.planned_qty',
        'psl.link_type',
        'psl.notes',
        'psl.created_at',
        'si.id as sale_item_id',
        'si.backorder_qty',
        'si.allocated_qty',
        'si.fulfillment_status',
        'p.name as product_name',
        'p.sku as product_sku',
        's.invoice_number',
        'c.name as customer_name',
        'pu.id as purchase_id',
        'pu.invoice_number as purchase_invoice_number',
        'pu.purchase_date',
        'sup.name as supplier_name',
      )
      .orderBy('psl.created_at', 'desc');

    res.json({
      rows: rows.map((r: any) => ({
        id: r.id,
        planned_qty: r.planned_qty,
        link_type: r.link_type,
        notes: r.notes,
        created_at: r.created_at,
        sale_item: {
          id: r.sale_item_id,
          backorder_qty: r.backorder_qty,
          allocated_qty: r.allocated_qty,
          fulfillment_status: r.fulfillment_status,
          product_name: r.product_name,
          product_sku: r.product_sku,
          invoice_number: r.invoice_number,
          customer_name: r.customer_name,
        },
        purchase: r.purchase_id
          ? {
              id: r.purchase_id,
              invoice_number: r.purchase_invoice_number,
              purchase_date: r.purchase_date,
              supplier_name: r.supplier_name,
            }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[backorders/supplier-links]', err);
    res.status(500).json({ error: err.message ?? 'Failed to load supplier backorder links' });
  }
});

export default router;
