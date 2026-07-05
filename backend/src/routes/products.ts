/**
 * Products REST routes — Phase 3D.
 *
 * Mirrors suppliers/customers pattern:
 *   GET    /api/products?dealerId=&page=&pageSize=&search=&orderBy=&orderDir=&f.<col>=
 *   GET    /api/products/:id?dealerId=
 *   POST   /api/products           body: { dealerId, data }
 *   PATCH  /api/products/:id       body: { dealerId, data }
 *   DELETE /api/products/:id?dealerId=
 *
 * Safety:
 *   - authenticate JWT + tenantGuard on every route
 *   - Every query is scoped to dealer_id
 *   - super_admin must pass an explicit dealerId
 *   - Phase 3D = shadow mode only. Writes work but frontend never calls
 *     them; product writes stay on Supabase until shadow runs clean.
 *
 * Search semantics (mirrors legacy supabase OR-ilike on sku/name/barcode):
 *   ?search=foo → ILIKE name | ILIKE sku | ILIKE barcode
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, hasRole } from '../middleware/roles';
import {
  computeBackorderOutstanding,
  shapePriceLevels,
  shapeFacets,
  FACET_COLUMNS,
  type FacetColumn,
} from '../services/productMasterService';

/**
 * Strip cost_price for users that lack 'dealer_admin' or 'super_admin'.
 * Salesmen MUST NOT see margins / cost data — enforced server-side.
 */
function stripCostForSalesman<T extends Record<string, any>>(req: Request, row: T | undefined): T | undefined {
  if (!row) return row;
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return row;
  const { cost_price: _omit, ...safe } = row;
  return safe as T;
}

const router = Router();
const TABLE = 'products';

const SORTABLE = new Set([
  'name',
  'sku',
  'created_at',
  'cost_price',
  'default_sale_rate',
  'reorder_level',
  'category',
  'series',
  'tile_type',
]);

const FILTERABLE = new Set([
  'active',
  'category',
  'brand',
  'unit_type',
  'sku',
  'barcode',
  'product_group',
  'grade',
  // V2 Sprint 2 — Product Master taxonomy (additive)
  'series',
  'collection_name',
  'tile_type',
  'finish',
  'surface',
  'country_of_origin',
  // V2 Sprint 2.1 — Product List filters
  'size',
]);

const WRITABLE = new Set([
  'sku',
  'barcode',
  'name',
  'category',
  'brand',
  'product_group',
  'grade',
  'description',
  'size',
  'color',
  'material',
  'weight',
  'warranty',
  'unit_type',
  'per_box_sft',
  'pieces_per_box',
  // Phase T1 — tile SQFT dimensions
  'tile_width',
  'tile_height',
  'size_unit',
  'sqft_per_piece',
  'sqft_per_box',
  'stock_base_unit',
  'cost_price',
  'default_sale_rate',
  'reorder_level',
  'active',
  'image_url',
  // V2 Sprint 2 — Product Master taxonomy (additive, all optional/nullable)
  'series',
  'collection_name',
  'tile_type',
  'finish',
  'surface',
  'shade_family',
  'caliber_spec',
  'thickness_mm',
  'country_of_origin',
  'default_rack',
]);

const productWriteSchema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  category: z.enum(['tiles', 'sanitary', 'tile', 'accessory']).optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  product_group: z.string().trim().max(100).nullable().optional(),
  grade: z.string().trim().max(50).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  size: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(100).nullable().optional(),
  material: z.string().trim().max(100).nullable().optional(),
  weight: z.string().trim().max(50).nullable().optional(),
  warranty: z.string().trim().max(100).nullable().optional(),
  unit_type: z.enum(['box_sft', 'piece']).optional(),
  per_box_sft: z.number().finite().nullable().optional(),
  pieces_per_box: z.number().int().positive().optional(),
  // Phase T1 — tile SQFT dimensions (all optional, additive)
  tile_width: z.number().finite().positive().nullable().optional(),
  tile_height: z.number().finite().positive().nullable().optional(),
  size_unit: z.enum(['inch', 'cm', 'feet']).optional(),
  sqft_per_piece: z.number().finite().positive().nullable().optional(),
  sqft_per_box: z.number().finite().positive().nullable().optional(),
  stock_base_unit: z.enum(['piece', 'sqft']).optional(),
  cost_price: z.number().finite().min(0).optional(),
  default_sale_rate: z.number().finite().min(0).optional(),
  reorder_level: z.number().finite().min(0).optional(),
  active: z.boolean().optional(),
  image_url: z.string().trim().max(500).nullable().optional(),
  // V2 Sprint 2 — Product Master taxonomy (additive, all optional/nullable so
  // existing clients that never send these keep working unchanged).
  series: z.string().trim().max(100).nullable().optional(),
  collection_name: z.string().trim().max(100).nullable().optional(),
  tile_type: z.string().trim().max(100).nullable().optional(),
  finish: z.string().trim().max(50).nullable().optional(),
  surface: z.string().trim().max(50).nullable().optional(),
  shade_family: z.string().trim().max(50).nullable().optional(),
  caliber_spec: z.string().trim().max(30).nullable().optional(),
  thickness_mm: z.number().finite().positive().nullable().optional(),
  country_of_origin: z.string().trim().max(100).nullable().optional(),
  default_rack: z.string().trim().max(50).nullable().optional(),
});

function resolveDealerScope(req: Request, res: Response): string | null {
  const isSuperAdmin = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined);

  if (isSuperAdmin) {
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

router.use(authenticate, tenantGuard);

// ── GET /api/products ──────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt((req.query.pageSize as string) || '25', 10)),
    );
    const search = ((req.query.search as string) || '').trim();
    const orderBy = (req.query.orderBy as string) || 'created_at';
    const orderDir = ((req.query.orderDir as string) || 'desc').toLowerCase();

    let q = db(TABLE).where({ dealer_id: dealerId });

    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('f.')) continue;
      const col = key.slice(2);
      if (!FILTERABLE.has(col)) continue;
      // Coerce booleans for `active`
      if (col === 'active') {
        q = q.andWhere(col, value === 'true');
      } else {
        q = q.andWhere(col, value as string);
      }
    }

    if (search) {
      // V2 Sprint 2.1 — additive: sku/name/barcode still match exactly as
      // before (nothing removed), series/collection_name are OR'd in so a
      // dealer can find a product by its line name too. Existing callers
      // that only cared about sku/name/barcode results are unaffected —
      // this can only ADD matches, never remove any.
      q = q.andWhere(function () {
        this.whereILike('sku', `%${search}%`)
          .orWhereILike('name', `%${search}%`)
          .orWhereILike('barcode', `%${search}%`)
          .orWhereILike('series', `%${search}%`)
          .orWhereILike('collection_name', `%${search}%`);
      });
    }

    const countQ = q
      .clone()
      .clearOrder()
      .clearSelect()
      .count<{ count: string }[]>('* as count');

    const sortCol = SORTABLE.has(orderBy) ? orderBy : 'created_at';
    const sortDir = orderDir === 'asc' ? 'asc' : 'desc';

    const rowsQ = q
      .clone()
      .select('*')
      .orderBy(sortCol, sortDir)
      .offset(page * pageSize)
      .limit(pageSize);

    const [countRow] = await countQ;
    const rawRows = await rowsQ;
    const rows = rawRows.map((r: any) => stripCostForSalesman(req, r));

    res.json({
      rows,
      total: Number(countRow?.count ?? 0),
    });
  } catch (err: any) {
    console.error('[products/list]', err.message);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

// ── GET /api/products/facets ───────────────────────────────────────────────
// V2 Sprint 2.1 — distinct values (across ALL of the dealer's products, not
// just the current page) for the Product List's filter dropdowns. Read-only;
// reuses the `products` table, no new columns/tables.
router.get('/facets', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const perColumn = await Promise.all(
      FACET_COLUMNS.map((col) =>
        db(TABLE)
          .distinct(col)
          .where({ dealer_id: dealerId })
          .whereNotNull(col)
          .select(col),
      ),
    );

    const rawByColumn = {} as Record<FacetColumn, Array<Record<string, unknown>>>;
    FACET_COLUMNS.forEach((col, i) => { rawByColumn[col] = perColumn[i]; });

    res.json(shapeFacets(rawByColumn));
  } catch (err: any) {
    console.error('[products/facets]', err.message);
    res.status(500).json({ error: 'Failed to load product facets' });
  }
});

// ── GET /api/products/cost-map ─────────────────────────────────────────────
// dealer_admin only — salesman blocked from cost data
router.get('/cost-map', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db('stock')
      .where({ dealer_id: dealerId })
      .select('product_id', 'average_cost_per_unit');
    const map: Record<string, number> = {};
    for (const s of rows as any[]) map[s.product_id] = Number(s.average_cost_per_unit) || 0;
    res.json({ rows: map });
  } catch (err: any) {
    console.error('[products/cost-map]', err.message);
    res.status(500).json({ error: 'Failed to load cost map' });
  }
});

// ── GET /api/products/last-cost-map ───────────────────────────────────────
// dealer_admin only — most-recent landed_cost per product
router.get('/last-cost-map', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db.raw(
      `
      SELECT pi.product_id, pi.landed_cost
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      WHERE pi.dealer_id = ?
      ORDER BY p.purchase_date DESC, p.created_at DESC
      `,
      [dealerId],
    );
    const map: Record<string, number> = {};
    for (const r of (rows.rows ?? []) as any[]) {
      if (!(r.product_id in map)) map[r.product_id] = Number(r.landed_cost) || 0;
    }
    res.json({ rows: map });
  } catch (err: any) {
    console.error('[products/last-cost-map]', err.message);
    res.status(500).json({ error: 'Failed to load last-cost map' });
  }
});

// ── GET /api/products/tx-check ────────────────────────────────────────────
// Returns set of product ids that appear in any sale_items / purchase_items / sales_returns
router.get('/tx-check', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const [sales, purchases, returns] = await Promise.all([
      db('sale_items').where({ dealer_id: dealerId }).distinct('product_id'),
      db('purchase_items').where({ dealer_id: dealerId }).distinct('product_id'),
      db('sales_returns').where({ dealer_id: dealerId }).distinct('product_id'),
    ]);
    const ids = new Set<string>();
    for (const r of [...sales, ...purchases, ...returns] as any[]) {
      if (r.product_id) ids.add(r.product_id);
    }
    res.json({ ids: Array.from(ids) });
  } catch (err: any) {
    console.error('[products/tx-check]', err.message);
    res.status(500).json({ error: 'Failed to load tx-check' });
  }
});

// ── GET /api/products/summary-rows ────────────────────────────────────────
// Lightweight per-product summary fields for dashboard math (no cost for salesman)
router.get('/summary-rows', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const cols = hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')
      ? ['id', 'cost_price', 'reorder_level', 'unit_type']
      : ['id', 'reorder_level', 'unit_type'];
    const rows = await db('products').where({ dealer_id: dealerId }).select(cols);
    res.json({ rows });
  } catch (err: any) {
    console.error('[products/summary-rows]', err.message);
    res.status(500).json({ error: 'Failed to load product summary' });
  }
});

// ── GET /api/products/stock-map ───────────────────────────────────────────
// Returns dealer-wide stock per product, including reservation counters
router.get('/stock-map', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db('stock')
      .where({ dealer_id: dealerId })
      .select('product_id', 'box_qty', 'sft_qty', 'piece_qty', 'total_pieces', 'reserved_box_qty', 'reserved_piece_qty', 'reserved_total_pieces');
    res.json({ rows });
  } catch (err: any) {
    console.error('[products/stock-map]', err.message);
    res.status(500).json({ error: 'Failed to load stock map' });
  }
});

// ── GET /api/products/last-purchase-map ───────────────────────────────────
// Returns a per-product map of the most recent purchase rate / landed cost /
// supplier for the dealer. Used by PurchaseForm to pre-fill rate hints.
// MUST be registered before `/:id` so Express does not capture
// "last-purchase-map" as the :id param.
router.get('/last-purchase-map', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db('purchase_items as pi')
      .innerJoin('purchases as pu', 'pu.id', 'pi.purchase_id')
      .leftJoin('suppliers as s', 's.id', 'pu.supplier_id')
      .where({ 'pi.dealer_id': dealerId })
      .orderBy('pu.purchase_date', 'desc')
      .select(
        'pi.product_id',
        'pi.purchase_rate',
        'pi.landed_cost',
        'pu.purchase_date',
        's.name as supplier_name',
      );
    const map: Record<string, any> = {};
    for (const r of rows as any[]) {
      if (map[r.product_id]) continue;
      map[r.product_id] = {
        purchase_rate: Number(r.purchase_rate) || 0,
        landed_cost: Number(r.landed_cost) || 0,
        purchase_date: r.purchase_date ?? '',
        supplier_name: r.supplier_name ?? '',
      };
    }
    res.json(map);
  } catch (err: any) {
    console.error('[products/last-purchase-map]', err.message);
    res.status(500).json({ error: 'Failed to load last-purchase map' });
  }
});

// ── GET /api/products/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const row = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();

    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ row: stripCostForSalesman(req, row) });
  } catch (err: any) {
    console.error('[products/get]', err.message);
    res.status(500).json({ error: 'Failed to load product' });
  }
});

// ── POST /api/products ─────────────────────────────────────────────────────
// P0: dealer_admin / super_admin only. Salesmen cannot create products.
router.post('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = productWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    if (!parsed.data.sku || !parsed.data.name || !parsed.data.category) {
      res.status(400).json({ error: 'sku, name, category are required' });
      return;
    }

    const payload: Record<string, unknown> = {
      dealer_id: dealerId,
      // Auto-generate barcode from SKU to mirror legacy productService.create
      barcode: parsed.data.barcode ?? parsed.data.sku,
    };
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }

    const [row] = await db(TABLE).insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A product with this SKU already exists.' });
      return;
    }
    console.error('[products/create]', err.message);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// ── PATCH /api/products/:id ────────────────────────────────────────────────
router.patch('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = productWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'No editable fields supplied' });
      return;
    }

    const [row] = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .update(payload)
      .returning('*');

    if (!row) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A product with this SKU already exists.' });
      return;
    }
    console.error('[products/update]', err.message);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// ── DELETE /api/products/:id ───────────────────────────────────────────────
// Frontend never deletes products in practice (uses toggleActive).
// Implemented for completeness; not used by UI in Phase 3D.
router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const deleted = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .delete();

    if (!deleted) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[products/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ─── Product History / Stock Summary endpoints (Phase 3U-7) ───────────────

/** Block salesman from cost / margin data. */
function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return true;
  res.status(403).json({ error: 'Requires dealer_admin role' });
  return false;
}

// GET /api/products/:id/purchase-history?dealerId=
router.get('/:id/purchase-history', async (req: Request, res: Response) => {
  const dealerId = resolveDealerScope(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  try {
    const rows = await db('purchase_items as pi')
      .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where({ 'pi.product_id': req.params.id, 'pi.dealer_id': dealerId })
      .orderBy('p.purchase_date', 'desc')
      .limit(50)
      .select(
        'pi.quantity', 'pi.purchase_rate', 'pi.landed_cost', 'pi.total', 'pi.purchase_id',
        'p.purchase_date', 's.name as supplier_name',
      );
    res.json({
      rows: rows.map((r: any) => ({
        quantity: Number(r.quantity),
        purchase_rate: Number(r.purchase_rate),
        landed_cost: Number(r.landed_cost),
        total: Number(r.total),
        purchase_id: r.purchase_id,
        purchases: { purchase_date: r.purchase_date, suppliers: { name: r.supplier_name } },
      })),
    });
  } catch (err: any) {
    console.error('[products/:id/purchase-history]', err.message);
    res.status(500).json({ error: 'Failed to load purchase history' });
  }
});

// GET /api/products/:id/sales-history?dealerId=
router.get('/:id/sales-history', async (req: Request, res: Response) => {
  const dealerId = resolveDealerScope(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where({ 'si.product_id': req.params.id, 'si.dealer_id': dealerId })
      .orderBy('s.sale_date', 'desc')
      .limit(50)
      .select(
        'si.quantity', 'si.sale_rate', 'si.total', 'si.total_sft', 'si.sale_id',
        's.sale_date', 'c.name as customer_name',
      );
    res.json({
      rows: rows.map((r: any) => ({
        quantity: Number(r.quantity),
        sale_rate: Number(r.sale_rate),
        total: Number(r.total),
        total_sft: r.total_sft != null ? Number(r.total_sft) : null,
        sale_id: r.sale_id,
        sales: { sale_date: r.sale_date, customers: { name: r.customer_name } },
      })),
    });
  } catch (err: any) {
    console.error('[products/:id/sales-history]', err.message);
    res.status(500).json({ error: 'Failed to load sales history' });
  }
});

// GET /api/products/:id/stock-summary?dealerId=
// Aggregates: stock row, total purchased, sold, returned, last purchase rate, batches.
router.get('/:id/stock-summary', async (req: Request, res: Response) => {
  const dealerId = resolveDealerScope(req, res);
  if (!dealerId) return;
  const productId = req.params.id;
  const isFinancial = hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin');
  try {
    const [stock, purchSum, soldSum, returnSum, lastPurch, batches, backorderRows, displayRow] = await Promise.all([
      db('stock')
        .where({ product_id: productId, dealer_id: dealerId })
        .first(['box_qty', 'piece_qty', 'sft_qty', 'reserved_box_qty', 'reserved_piece_qty', 'average_cost_per_unit']),
      db('purchase_items')
        .where({ product_id: productId, dealer_id: dealerId })
        .sum({ s: 'quantity' })
        .first(),
      db('sale_items')
        .where({ product_id: productId, dealer_id: dealerId })
        .sum({ s: 'quantity' })
        .first(),
      db('sales_returns')
        .where({ product_id: productId, dealer_id: dealerId })
        .sum({ s: 'qty' })
        .first(),
      isFinancial
        ? db('purchase_items as pi')
            .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
            .where({ 'pi.product_id': productId, 'pi.dealer_id': dealerId })
            .orderBy('p.purchase_date', 'desc')
            .limit(1)
            .first(['pi.landed_cost'])
        : Promise.resolve(null),
      db('product_batches')
        .where({ product_id: productId, dealer_id: dealerId })
        .orderBy('created_at', 'asc'),
      // V2 Sprint 2 — outstanding backorder qty for this product, using the
      // same backorder_qty/allocated_qty fields + formula as
      // GET /api/backorders/shortage-demand (reused, not reinvented).
      db('sale_items')
        .where({ product_id: productId, dealer_id: dealerId })
        .where('backorder_qty', '>', 0)
        .sum({ backorder_qty: 'backorder_qty', allocated_qty: 'allocated_qty' })
        .first(),
      // V2 Sprint 2 — display/showroom sample qty (display_stock, existing table).
      db('display_stock')
        .where({ product_id: productId, dealer_id: dealerId })
        .first(['display_qty']),
    ]);

    const backorderOutstanding = computeBackorderOutstanding(
      Number((backorderRows as any)?.backorder_qty ?? 0),
      Number((backorderRows as any)?.allocated_qty ?? 0),
    );

    res.json({
      stock: stock
        ? {
            box_qty: Number(stock.box_qty ?? 0),
            piece_qty: Number(stock.piece_qty ?? 0),
            sft_qty: Number(stock.sft_qty ?? 0),
            reserved_box_qty: Number(stock.reserved_box_qty ?? 0),
            reserved_piece_qty: Number(stock.reserved_piece_qty ?? 0),
            average_cost_per_unit: isFinancial ? Number(stock.average_cost_per_unit ?? 0) : 0,
          }
        : null,
      totalPurchased: Number((purchSum as any)?.s ?? 0),
      totalSold: Number((soldSum as any)?.s ?? 0),
      totalReturned: Number((returnSum as any)?.s ?? 0),
      lastPurchaseRate: lastPurch ? Number((lastPurch as any).landed_cost ?? 0) : 0,
      batches,
      // V2 Sprint 2 additions (additive — existing consumers reading only the
      // fields above are unaffected):
      backorderQty: backorderOutstanding,
      displaySampleQty: Number((displayRow as any)?.display_qty ?? 0),
    });
  } catch (err: any) {
    console.error('[products/:id/stock-summary]', err.message);
    res.status(500).json({ error: 'Failed to load stock summary' });
  }
});

// GET /api/products/:id/stock-movement?dealerId=&from=&to=
// Returns 5 grouped movement arrays for the date range.
router.get('/:id/stock-movement', async (req: Request, res: Response) => {
  const dealerId = resolveDealerScope(req, res);
  if (!dealerId) return;
  const productId = req.params.id;
  const from = (req.query.from as string) || '1970-01-01';
  const to = (req.query.to as string) || '9999-12-31';
  try {
    const [purchases, sales, salesReturns, purchaseReturns, audits] = await Promise.all([
      db('purchase_items as pi')
        .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
        .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
        .where({ 'pi.product_id': productId, 'pi.dealer_id': dealerId })
        .whereBetween('p.purchase_date', [from, to])
        .select('pi.quantity', 'p.purchase_date', 'p.invoice_number', 's.name as supplier_name'),
      db('sale_items as si')
        .innerJoin('sales as s', 's.id', 'si.sale_id')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .where({ 'si.product_id': productId, 'si.dealer_id': dealerId })
        .whereBetween('s.sale_date', [from, to])
        .select('si.quantity', 's.sale_date', 's.invoice_number', 'c.name as customer_name'),
      db('sales_returns as sr')
        .leftJoin('sales as s', 's.id', 'sr.sale_id')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .where({ 'sr.product_id': productId, 'sr.dealer_id': dealerId })
        .whereBetween('sr.return_date', [from, to])
        .select('sr.qty', 'sr.return_date', 'sr.is_broken', 'sr.sale_id', 's.invoice_number', 'c.name as customer_name'),
      db('purchase_return_items as pri')
        .innerJoin('purchase_returns as pr', 'pr.id', 'pri.purchase_return_id')
        .leftJoin('suppliers as s', 's.id', 'pr.supplier_id')
        .where({ 'pri.product_id': productId, 'pri.dealer_id': dealerId })
        .whereBetween('pr.return_date', [from, to])
        .select('pri.quantity', 'pr.return_date', 'pr.return_no', 's.name as supplier_name'),
      db('audit_logs')
        .where({ dealer_id: dealerId, table_name: 'stock' })
        .whereIn('action', ['stock_manual_add', 'stock_manual_deduct', 'stock_broken', 'stock_add', 'stock_deduct'])
        .where('created_at', '>=', `${from}T00:00:00`)
        .where('created_at', '<=', `${to}T23:59:59`)
        .select('action', 'new_data', 'created_at'),
    ]);

    const adjustments = audits
      .filter((d: any) => {
        const nd = d.new_data ?? {};
        return nd.product_id === productId || nd.adjustment_type;
      })
      .map((d: any) => {
        const nd = d.new_data ?? {};
        const qty = Number(nd.quantity) || 0;
        const isAdd = String(d.action).includes('add') || String(d.action).includes('restore');
        return {
          date: new Date(d.created_at).toISOString().slice(0, 10),
          type: 'adjustment' as const,
          label: nd.reason || nd.adjustment_type || String(d.action).replace('stock_', ''),
          party: '—',
          qtyIn: isAdd ? qty : 0,
          qtyOut: !isAdd ? qty : 0,
          reference: 'Manual',
        };
      });

    res.json({
      purchases: purchases.map((d: any) => ({
        date: d.purchase_date,
        type: 'purchase' as const,
        label: 'Purchase',
        party: d.supplier_name ?? '—',
        qtyIn: Number(d.quantity),
        qtyOut: 0,
        reference: d.invoice_number ?? '—',
      })),
      sales: sales.map((d: any) => ({
        date: d.sale_date,
        type: 'sale' as const,
        label: 'Sale',
        party: d.customer_name ?? '—',
        qtyIn: 0,
        qtyOut: Number(d.quantity),
        reference: d.invoice_number ?? '—',
      })),
      salesReturns: salesReturns.map((d: any) => ({
        date: d.return_date,
        type: 'sales_return' as const,
        label: d.is_broken ? 'Sales Return (Broken)' : 'Sales Return',
        party: d.customer_name ?? '—',
        qtyIn: d.is_broken ? 0 : Number(d.qty),
        qtyOut: 0,
        reference: d.invoice_number ?? '—',
      })),
      purchaseReturns: purchaseReturns.map((d: any) => ({
        date: d.return_date,
        type: 'purchase_return' as const,
        label: 'Purchase Return',
        party: d.supplier_name ?? '—',
        qtyIn: 0,
        qtyOut: Number(d.quantity),
        reference: d.return_no ?? '—',
      })),
      adjustments,
    });
  } catch (err: any) {
    console.error('[products/:id/stock-movement]', err.message);
    res.status(500).json({ error: 'Failed to load stock movement' });
  }
});

// ── GET /api/products/:id/last-purchase ───────────────────────────────────
// Returns the most recent purchase_items row for a product (rate + landed cost).
// Used by ProductForm to surface "last purchased at" hints in edit mode.
router.get('/:id/last-purchase', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const row = await db('purchase_items as pi')
      .innerJoin('purchases as pu', 'pu.id', 'pi.purchase_id')
      .where({ 'pi.product_id': req.params.id, 'pi.dealer_id': dealerId })
      .orderBy('pu.purchase_date', 'desc')
      .first('pi.landed_cost', 'pi.purchase_rate', 'pu.purchase_date');
    if (!row) { res.json(null); return; }
    res.json({
      landed_cost: Number(row.landed_cost) || 0,
      purchase_rate: Number(row.purchase_rate) || 0,
      purchase_date: row.purchase_date ?? null,
    });
  } catch (err: any) {
    console.error('[products/:id/last-purchase]', err.message);
    res.status(500).json({ error: 'Failed to load last purchase' });
  }
});

// (last-purchase-map route lives above /:id; see line ~299)

// ── GET /api/products/:id/price-levels ────────────────────────────────────
// V2 Sprint 2 — Product Master "Price Levels" panel.
//
// Reuses the EXISTING price_tiers / price_tier_items tables (Settings →
// Pricing Tiers) rather than adding dedicated Dealer/Retail/Wholesale/Project
// columns — those four are simply the dealer's own named tiers (or whatever
// names a dealer already uses; nothing here assumes fixed tier names).
// Read-only aggregation: for every active tier belonging to this dealer,
// return this product's rate if one has been set (else null so the UI can
// show "not set — falls back to default price"). default_sale_rate is
// included as the base/list price for reference.
//
// Writes reuse the EXISTING PUT /api/pricing-tiers/:tierId/items/:productId
// endpoint unchanged — no new write path was added.
router.get('/:id/price-levels', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const product = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .first('id', 'default_sale_rate');
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const tiers = await db('price_tiers as t')
      .leftJoin('price_tier_items as i', function () {
        this.on('i.tier_id', '=', 't.id').andOn('i.product_id', '=', db.raw('?', [req.params.id]));
      })
      .where({ 't.dealer_id': dealerId, 't.status': 'active' })
      .select('t.id as tier_id', 't.name as tier_name', 't.is_default', 'i.rate')
      .orderBy('t.is_default', 'desc')
      .orderBy('t.name', 'asc');

    res.json(shapePriceLevels(Number(product.default_sale_rate ?? 0), tiers as any[]));
  } catch (err: any) {
    console.error('[products/:id/price-levels]', err.message);
    res.status(500).json({ error: 'Failed to load price levels' });
  }
});

// ── POST /api/products/:id/cost-price ─────────────────────────────────────
// dealer_admin only. Manually sets the average_cost_per_unit on the dealer's
// stock row for this product, with a mandatory reason that lands in the
// audit log. Replaces direct supabase.from('stock').update from the
// UpdateCostPriceDialog.
router.post('/:id/cost-price', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const cost = Number(req.body?.cost);
    const reason = String(req.body?.reason ?? '').trim();
    if (!Number.isFinite(cost) || cost < 0) { res.status(400).json({ error: 'Cost must be >= 0' }); return; }
    if (!reason) { res.status(400).json({ error: 'Reason is required' }); return; }

    const stockRow = await db('stock')
      .where({ product_id: req.params.id, dealer_id: dealerId })
      .first('id', 'average_cost_per_unit');
    const previous = Number(stockRow?.average_cost_per_unit ?? 0);

    if (stockRow) {
      await db('stock')
        .where({ product_id: req.params.id, dealer_id: dealerId })
        .update({ average_cost_per_unit: cost });
    } else {
      await db('stock').insert({
        product_id: req.params.id,
        dealer_id: dealerId,
        average_cost_per_unit: cost,
        box_qty: 0,
        piece_qty: 0,
      });
    }

    // Audit
    try {
      await db('audit_logs').insert({
        dealer_id: dealerId,
        user_id: req.user?.userId ?? null,
        action: 'PRICE_CHANGE',
        table_name: 'stock',
        record_id: req.params.id,
        old_data: { average_cost_per_unit: previous },
        new_data: { average_cost_per_unit: cost, reason },
      });
    } catch (auditErr: any) {
      console.warn('[products/cost-price] audit failed:', auditErr.message);
    }

    res.json({ ok: true, previous, current: cost });
  } catch (err: any) {
    console.error('[products/cost-price]', err.message);
    res.status(500).json({ error: 'Failed to update cost price' });
  }
});

/**
 * Phase T5 — Per-product cutover to SQFT base unit.
 * POST /api/products/:id/migrate-to-sqft  body: { dealerId, dryRun?: boolean }
 * Calls PL/pgSQL `migrate_product_to_sqft(uuid, boolean)` which is dealer-scoped
 * via the product row. dealer_admin or super_admin only.
 */
router.post(
  '/:id/migrate-to-sqft',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const dealerId = (req.body?.dealerId ?? req.query.dealerId) as string | undefined;
      const dryRun = req.body?.dryRun !== false; // default true (safe)
      if (!dealerId) return res.status(400).json({ error: 'dealerId required' });

      // Verify product belongs to this dealer (defense in depth)
      const owner = await db('products')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first('id');
      if (!owner) return res.status(404).json({ error: 'product not found for dealer' });

      const result = await db.raw(
        'SELECT public.migrate_product_to_sqft(?, ?) AS data',
        [req.params.id, dryRun],
      );
      const data = result.rows?.[0]?.data ?? null;
      res.json(data);
    } catch (err: any) {
      console.error('[products/migrate-to-sqft]', err.message);
      res.status(500).json({ error: err.message || 'Migration failed' });
    }
  },
);

export default router;
