/**
 * Sales read routes — VPS migration phase 3G (reads only).
 *
 * Mirrors the surface of `salesService.list` and `salesService.getById` from
 * the React app, so the SalesList and detail/document views can switch off
 * Supabase. Mutations (create/update/delete) remain on Supabase for now —
 * those carry FIFO batch allocation, ledger sync, audit, notifications and
 * are scheduled for a later phase to avoid regressing live dealers.
 *
 *   GET /api/sales?dealerId=&page=1&search=&projectId=&siteId=
 *   GET /api/sales/:id
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { formatBoxPiece } from '../lib/units';
import { computeLineCogs, InvalidProductPerBoxSftError } from '../lib/cogsLine';
import { recordCustomerPayment } from '../lib/customerPayment';

const router = Router();
router.use(authenticate, tenantGuard);

const PAGE_SIZE = 25;

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

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const search = ((req.query.search as string) || '').trim();
  const projectId = (req.query.projectId as string) || null;
  const siteId = (req.query.siteId as string) || null;

  const offset = (page - 1) * PAGE_SIZE;

  try {
    const base = db('sales').where({ dealer_id: dealerId });
    if (search) base.andWhere('invoice_number', 'ilike', `%${search}%`);
    if (projectId) base.andWhere('project_id', projectId);
    if (siteId) base.andWhere('site_id', siteId);

    const [{ count: totalCount }] = await base
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const rows = await base
      .clone()
      .select('*')
      .orderBy([
        { column: 'sale_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(PAGE_SIZE)
      .offset(offset);

    // Hydrate customers + projects + sites in batch (avoid n+1)
    const custIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean)));
    const projIds = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean)));
    const siteIds = Array.from(new Set(rows.map((r) => r.site_id).filter(Boolean)));

    const [customers, projects, sites] = await Promise.all([
      custIds.length
        ? db('customers').whereIn('id', custIds).select('id', 'name', 'type', 'phone', 'address')
        : Promise.resolve([]),
      projIds.length
        ? db('projects').whereIn('id', projIds).select('id', 'project_name', 'project_code')
        : Promise.resolve([]),
      siteIds.length
        ? db('project_sites').whereIn('id', siteIds).select('id', 'site_name', 'address')
        : Promise.resolve([]),
    ]);

    const custMap = new Map(customers.map((c: any) => [c.id, c]));
    const projMap = new Map(projects.map((p: any) => [p.id, p]));
    const siteMap = new Map(sites.map((s: any) => [s.id, s]));

    const data = rows.map((r) => ({
      ...r,
      customers: r.customer_id ? custMap.get(r.customer_id) ?? null : null,
      projects: r.project_id ? projMap.get(r.project_id) ?? null : null,
      project_sites: r.site_id ? siteMap.get(r.site_id) ?? null : null,
    }));

    res.json({ data, total: Number(totalCount) || 0 });
  } catch (err) {
    console.error('[sales.list] error', err);
    res.status(500).json({ error: 'Failed to load sales' });
  }
});

// ── GET /api/sales/delivery-flags ──────────────────────────────────────────
// Returns lightweight maps used by SaleList to render delivery / challan
// status badges without scanning every sale row. Two payloads in one trip:
//   - deliveredSaleIds: sales that already have at least one delivery row
//   - challanDeliveryStatuses: { saleId → delivery_status } for active challans
router.get('/delivery-flags', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const [deliveries, challans] = await Promise.all([
      db('deliveries').where({ dealer_id: dealerId }).whereNotNull('sale_id').select('sale_id'),
      db('challans')
        .where({ dealer_id: dealerId })
        .whereNot('status', 'cancelled')
        .select('sale_id', 'delivery_status'),
    ]);
    const deliveredSaleIds = Array.from(new Set(deliveries.map((d: any) => d.sale_id).filter(Boolean)));
    const challanDeliveryStatuses: Record<string, string> = {};
    for (const c of challans) {
      if (c.sale_id) challanDeliveryStatuses[c.sale_id] = c.delivery_status ?? 'pending';
    }
    res.json({ deliveredSaleIds, challanDeliveryStatuses });
  } catch (err: any) {
    console.error('[sales.delivery-flags]', err.message);
    res.status(500).json({ error: 'Failed to load delivery flags' });
  }
});

// ── GET /api/sales/:id/returns ─────────────────────────────────────────────
// Returns the sales_returns rows linked to a sale, hydrated with the
// product display name (for the InvoicePage "Returns" panel).
router.get('/:id/returns', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('sales_returns as sr')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .where({ 'sr.sale_id': req.params.id, 'sr.dealer_id': dealerId })
      .select(
        'sr.id', 'sr.qty', 'sr.refund_amount', 'sr.return_date',
        'sr.reason', 'sr.is_broken', 'sr.product_id',
        db.raw(`json_build_object('name', p.name) as products`),
      )
      .orderBy('sr.return_date', 'desc');
    res.json(rows);
  } catch (err: any) {
    console.error('[sales.returns]', err.message);
    res.status(500).json({ error: 'Failed to load returns' });
  }
});

// ── POST /api/sales/:id/payment ────────────────────────────────────────────
// Atomic payment recording for an existing sale.
//   Body: { amount, note?, payment_mode? }
// Side effects (one transaction):
//   1. Insert customer_ledger row (type='payment')
//   2. Insert cash_ledger row (type='receipt')
//   3. UPDATE sales.paid_amount + due_amount
// Replaces the previous unsafe inline supabase update from InvoicePage.
const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional(),
  payment_mode: z.string().trim().max(50).optional(),
});
router.post('/:id/payment', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { amount, note, payment_mode } = parsed.data;

  try {
    const result = await db.transaction(async (trx) => {
      const sale = await trx('sales')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first('customer_id');
      if (!sale) throw new Error('Sale not found');
      if (!sale.customer_id) throw new Error('Sale has no customer linked');

      return recordCustomerPayment(trx, {
        dealerId,
        customerId: sale.customer_id,
        saleId: req.params.id,
        amount,
        note,
        payment_mode,
      });
    });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[sales.payment]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record payment' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { id } = req.params;

  try {
    const sale = await db('sales')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const [customer, items] = await Promise.all([
      sale.customer_id
        ? db('customers')
            .where({ id: sale.customer_id })
            .first('id', 'name', 'type', 'phone', 'address')
        : Promise.resolve(null),
      db('sale_items as si')
        .leftJoin('products as p', 'p.id', 'si.product_id')
        .where('si.sale_id', id)
        .select(
          'si.*',
          db.raw(`json_build_object(
            'name', p.name,
            'sku', p.sku,
            'unit_type', p.unit_type,
            'per_box_sft', p.per_box_sft,
            'pieces_per_box', p.pieces_per_box
          ) as products`),
        ),
    ]);

    res.json({ ...sale, customers: customer ?? null, sale_items: items });
  } catch (err) {
    console.error('[sales.getById] error', err);
    res.status(500).json({ error: 'Failed to load sale' });
  }
});

// ───────────────────────── CREATE (Phase 3L) ─────────────────────────────
//
// Ports `salesService.create()` from the React app to the VPS as an atomic
// transaction. Side-effects covered:
//   1. Find-or-create customer by name (case-insensitive).
//   2. Generate next invoice number via DB sequence (generate_next_invoice_no).
//   3. Insert sales header + sale_items rows.
//   4. For each item (non-challan mode):
//        a. FIFO batch allocation honouring customer reservations.
//        b. Atomic batch deduction via allocate_sale_batches RPC, OR
//           legacy unbatched deduction via deduct_stock_unbatched RPC.
//        c. Optional consumption of explicit reservation selections via
//           consume_reservation_for_sale RPC.
//   5. Customer-ledger sale entry + payment entry (if paid_amount > 0).
//   6. Cash-ledger receipt entry (if paid_amount > 0).
//   7. Audit log row keyed to req.user.userId.
//   8. Auto-create challan stub (challan_no via generate_next_challan_no).
//
// Notifications: NOT triggered server-side in 3L. The frontend will
// continue to fire-and-forget `notificationService.notifySaleCreated`
// from the response payload (same behaviour as Supabase path) so SMS/email
// templates and dealer settings stay on a single code path.

const saleItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Optional dual-unit fields. If omitted, derived from `quantity` + product ppb. */
  box_qty: z.coerce.number().min(0).optional(),
  piece_qty: z.coerce.number().min(0).optional(),
  /** Phase T4a — canonical SQFT qty for tile (stock_base_unit='sqft' in T5) items. */
  qty_sqft: z.coerce.number().min(0).optional().nullable(),
  sale_rate: z.coerce.number().min(0),
  /** 'per_piece' | 'per_box' | 'per_sqft'. NULL → legacy per_piece. */
  rate_unit: z.enum(['per_piece', 'per_box', 'per_sqft']).optional().nullable(),
  rate_source: z.enum(['default', 'tier', 'manual']).optional(),
  tier_id: z.string().uuid().nullable().optional(),
  original_resolved_rate: z.coerce.number().nullable().optional(),
});

const reservationSelectionSchema = z.object({
  reservation_id: z.string().uuid(),
  consume_qty: z.coerce.number().positive(),
});

const createSaleSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  customer_name: z.string().trim().min(1).max(200),
  sale_date: z.string().min(1),
  sale_type: z.enum(['direct_invoice', 'challan_mode']).default('direct_invoice'),
  discount: z.coerce.number().min(0).default(0),
  discount_reference: z.string().trim().max(100).optional().nullable(),
  client_reference: z.string().trim().max(100).optional().nullable(),
  fitter_reference: z.string().trim().max(100).optional().nullable(),
  paid_amount: z.coerce.number().min(0).default(0),
  payment_mode: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  allow_backorder: z.boolean().optional(),
  mixed_batch_acknowledged: z.boolean().optional(),
  reservation_selections: z.record(z.string(), z.array(reservationSelectionSchema)).optional(),
  project_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  items: z.array(saleItemSchema).min(1),
});

router.post('/', async (req: Request, res: Response) => {
  // RBAC: super_admin, dealer_admin, salesman (insert-only) all allowed.
  const roles = (req.user?.roles ?? []) as string[];
  if (
    !roles.includes('super_admin') &&
    !roles.includes('dealer_admin') &&
    !roles.includes('salesman')
  ) {
    res.status(403).json({ error: 'Not allowed to create sales' });
    return;
  }

  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = req.user?.userId ?? null;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ua = (req.headers['user-agent'] as string) || null;

  try {
    // ── 1. Find or create customer by name (case-insensitive) ──
    const customerName = input.customer_name.trim();
    let customerId: string;
    const existing = await db('customers')
      .where({ dealer_id: dealerId })
      .andWhereRaw('LOWER(name) = LOWER(?)', [customerName])
      .first('id');

    if (existing) {
      customerId = existing.id;
    } else {
      const [created] = await db('customers')
        .insert({
          dealer_id: dealerId,
          name: customerName,
          type: 'customer',
          status: 'active',
        })
        .returning('id');
      customerId = created.id;
    }

    // ── 2. Determine backorder mode ──
    let backorderEnabled = !!input.allow_backorder;
    if (!backorderEnabled) {
      const dealer = await db('dealers').where({ id: dealerId }).first('allow_backorder');
      backorderEnabled = (dealer as any)?.allow_backorder === true;
    }

    // ── 3. Pre-fetch products + stock ──
    const productIds = Array.from(new Set(input.items.map((i) => i.product_id)));
    const [products, stocks] = await Promise.all([
      db('products')
        .whereIn('id', productIds)
        .andWhere({ dealer_id: dealerId })
        .select('id', 'unit_type', 'per_box_sft', 'name', 'pieces_per_box'),
      db('stock')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', productIds)
        .select(
          'product_id',
          'average_cost_per_unit',
          'box_qty',
          'piece_qty',
          'reserved_box_qty',
          'reserved_piece_qty',
          'total_pieces',
          'reserved_total_pieces',
        ),
    ]);

    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found for this dealer' });
      return;
    }
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const stockMap = new Map(stocks.map((s: any) => [s.product_id, s]));

    // ── 4. Compute totals + per-line backorder qty ──
    let totalBox = 0;
    let totalSft = 0;
    let totalPiece = 0;
    let totalCogs = 0;
    let hasBackorder = false;

    const itemsCalc = input.items.map((item) => {
      const product: any = productMap.get(item.product_id);
      const stock: any = stockMap.get(item.product_id);
      const avgCost = stock ? Number(stock.average_cost_per_unit) : 0;
      const unitType = product?.unit_type ?? 'piece';
      const perBoxSft = Number(product?.per_box_sft ?? 0);
      const ppb = Math.max(1, Math.floor(Number(product?.pieces_per_box ?? 1)) || 1);

      // Resolve box_qty / piece_qty — caller may pass explicit dual-unit
      // values (Box+Pc UI), or only legacy `quantity`. Backwards-compatible.
      let boxQty: number;
      let pieceQty: number;
      if (item.box_qty != null || item.piece_qty != null) {
        boxQty = Number(item.box_qty ?? 0);
        pieceQty = Number(item.piece_qty ?? 0);
      } else if (unitType === 'box_sft') {
        // Tile: legacy quantity is in boxes (may be decimal SFT-equivalent).
        boxQty = Math.floor(item.quantity);
        const frac = item.quantity - boxQty;
        pieceQty = Math.round(frac * ppb);
      } else {
        boxQty = 0;
        pieceQty = item.quantity;
      }
      const totalPiecesItem = boxQty * ppb + pieceQty;

      // Re-derive `quantity` so legacy code paths (allocator, totals) stay correct.
      // For tiles we send a decimal box-equivalent; for piece units we send pieces.
      const effectiveQty =
        unitType === 'box_sft' ? boxQty + pieceQty / ppb : pieceQty || item.quantity;

      const totalQty =
        unitType === 'box_sft' ? Number(stock?.box_qty ?? 0) : Number(stock?.piece_qty ?? 0);
      const reservedQty =
        unitType === 'box_sft'
          ? Number(stock?.reserved_box_qty ?? 0)
          : Number(stock?.reserved_piece_qty ?? 0);
      const availableQty = totalQty - reservedQty;
      const shortage = Math.max(0, effectiveQty - availableQty);

      if (shortage > 0 && !backorderEnabled) {
        const ppbForMsg = ppb;
        const availDisplay =
          unitType === 'box_sft'
            ? formatBoxPiece(
                Number(stock?.total_pieces ?? availableQty * ppb) -
                  Number(stock?.reserved_total_pieces ?? 0),
                ppbForMsg,
              )
            : `${availableQty} pcs`;
        const reqDisplay =
          unitType === 'box_sft' ? formatBoxPiece(totalPiecesItem, ppbForMsg) : `${pieceQty} pcs`;
        throw new Error(
          `Insufficient stock for ${product?.name ?? 'product'}. Available: ${availDisplay}, Requested: ${reqDisplay}. Enable "Allow Sale Below Stock" in dealer settings.`,
        );
      }
      if (shortage > 0) hasBackorder = true;

      let itemTotal: number;
      let itemSft: number | null = null;
      if (unitType === 'box_sft') {
        totalBox += effectiveQty;
        itemSft = effectiveQty * perBoxSft;
        totalSft += itemSft;
        itemTotal = itemSft * item.sale_rate;
      } else {
        totalPiece += effectiveQty;
        itemTotal = effectiveQty * item.sale_rate;
      }

      // Phase 1A — dimensionally correct COGS via computeLineCogs.
      // Tile (box_sft):  effectiveQty (boxes) × perBoxSft (sft/box) × avgCost (৳/sft) = ৳
      // Piece:           effectiveQty (pieces) × avgCost (৳/piece) = ৳
      // Throws InvalidProductPerBoxSftError if a tile product is missing per_box_sft.
      totalCogs += computeLineCogs({
        unitType,
        effectiveQty,
        perBoxSft,
        avgCost,
      });

      return {
        ...item,
        quantity: effectiveQty,
        box_qty: boxQty,
        piece_qty: pieceQty,
        total_pieces: totalPiecesItem,
        pieces_per_box: ppb,
        unitType: unitType as 'box_sft' | 'piece',
        perBoxSft,
        total: itemTotal,
        total_sft: itemSft,
        available_qty_at_sale: availableQty,
        backorder_qty: shortage,
        fulfillment_status: shortage > 0 ? 'pending' : 'in_stock',
      };
    });

    const subtotal = itemsCalc.reduce((s, i) => s + i.total, 0);
    const totalAmount = subtotal - input.discount;
    const dueAmount = totalAmount - input.paid_amount;
    const grossProfit = totalAmount - totalCogs;
    const isChallanMode = input.sale_type === 'challan_mode';

    // ── 5. Generate invoice number (RPC, runs its own tx) ──
    const invoiceRes = await db.raw<{ rows: { generate_next_invoice_no: string }[] }>(
      'SELECT public.generate_next_invoice_no(?) AS generate_next_invoice_no',
      [dealerId],
    );
    const invoiceNumber = invoiceRes.rows[0]?.generate_next_invoice_no
      ?? `INV-${String(Date.now()).slice(-5)}`;

    // ── 6. Atomic transaction: header + items + stock + ledger + audit ──
    const saleId: string = await db.transaction(async (trx) => {
      // Sale header
      const [sale] = await trx('sales')
        .insert({
          dealer_id: dealerId,
          customer_id: customerId,
          invoice_number: invoiceNumber,
          sale_date: input.sale_date,
          total_amount: totalAmount,
          discount: input.discount,
          discount_reference: input.discount_reference?.trim() || null,
          client_reference: input.client_reference?.trim() || null,
          fitter_reference: input.fitter_reference?.trim() || null,
          paid_amount: input.paid_amount,
          due_amount: dueAmount,
          cogs: totalCogs,
          // Phase 1A: stamp the COGS provenance so reports can distinguish
          // post-fix (dimensionally correct) rows from legacy_pre_fix rows
          // that were written by the pre-Phase-1A code path.
          cogs_method: 'post_fix',
          profit: grossProfit,
          gross_profit: grossProfit,
          net_profit: grossProfit,
          total_box: totalBox,
          total_sft: totalSft,
          total_piece: totalPiece,
          notes: input.notes?.trim() || null,
          payment_mode: input.payment_mode || null,
          created_by: userId,
          sale_type: input.sale_type,
          sale_status: isChallanMode ? 'draft' : 'invoiced',
          has_backorder: hasBackorder,
          project_id: input.project_id ?? null,
          site_id: input.site_id ?? null,
        })
        .returning('id');
      const newSaleId = sale.id;

      // Sale items
      const itemRows = itemsCalc.map((item) => ({
        sale_id: newSaleId,
        dealer_id: dealerId,
        product_id: item.product_id,
        quantity: item.quantity,
        qty_sqft: (item as any).qty_sqft ?? null,
        box_qty: item.box_qty,
        piece_qty: item.piece_qty,
        total_pieces: item.total_pieces,
        sale_rate: item.sale_rate,
        rate_unit: (item as any).rate_unit ?? null,
        total: item.total,
        total_sft: item.total_sft,
        available_qty_at_sale: item.available_qty_at_sale,
        backorder_qty: item.backorder_qty,
        allocated_qty: 0,
        fulfillment_status: item.fulfillment_status,
        rate_source: item.rate_source ?? 'default',
        tier_id: item.tier_id ?? null,
        original_resolved_rate: item.original_resolved_rate ?? null,
      }));
      const insertedItems = await trx('sale_items')
        .insert(itemRows)
        .returning(['id', 'product_id']);
      // Map by index to preserve ordering for duplicate products
      const saleItemIdsByIndex: string[] = insertedItems.map((r: any) => r.id);

      if (!isChallanMode) {
        // ── Per-item: batch allocation + stock deduction ──
        for (let idx = 0; idx < itemsCalc.length; idx++) {
          const item = itemsCalc[idx];
          const saleItemId = saleItemIdsByIndex[idx];
          const deductQty = Math.min(item.quantity, item.available_qty_at_sale);
          if (deductQty <= 0) continue;

          // Capture stock_before for stock_ledger audit (locks row).
          const stockBeforeRow = await trx('stock')
            .where({ dealer_id: dealerId, product_id: item.product_id })
            .forUpdate()
            .first('total_pieces');
          const stockBeforePieces = Number(stockBeforeRow?.total_pieces ?? 0);

          // Plan FIFO allocation honouring customer reservations
          const batches = await trx('product_batches')
            .where({ dealer_id: dealerId, product_id: item.product_id, status: 'active' })
            .orderBy('created_at', 'asc')
            .forUpdate()
            .select(
              'id',
              'batch_no',
              'shade_code',
              'caliber',
              'lot_no',
              'box_qty',
              'piece_qty',
              'reserved_box_qty',
              'reserved_piece_qty',
            );

          if (batches.length === 0) {
            // Legacy/unbatched: deduct aggregate stock only via RPC (locks row)
            await trx.raw(
              'SELECT public.deduct_stock_unbatched(?, ?, ?, ?, ?)',
              [item.product_id, dealerId, item.unitType, item.perBoxSft ?? 0, deductQty],
            );
          } else {
            // Customer's own reservations on each batch (treat as available to them)
            const customerRes = await trx('stock_reservations')
              .where({
                product_id: item.product_id,
                dealer_id: dealerId,
                customer_id: customerId,
                status: 'active',
              })
              .select('batch_id', 'reserved_qty', 'fulfilled_qty', 'released_qty');
            const customerBatchHold = new Map<string, number>();
            for (const r of customerRes) {
              if (!r.batch_id) continue;
              const remaining =
                Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty);
              customerBatchHold.set(
                r.batch_id,
                (customerBatchHold.get(r.batch_id) ?? 0) + remaining,
              );
            }

            const allocations: { batch_id: string; allocated_qty: number }[] = [];
            let remaining = deductQty;
            for (const batch of batches) {
              if (remaining <= 0) break;
              const totalQty =
                item.unitType === 'box_sft' ? Number(batch.box_qty) : Number(batch.piece_qty);
              const reservedQty =
                item.unitType === 'box_sft'
                  ? Number(batch.reserved_box_qty ?? 0)
                  : Number(batch.reserved_piece_qty ?? 0);
              const ownHold = customerBatchHold.get(batch.id) ?? 0;
              const freeQty = totalQty - reservedQty + ownHold;
              if (freeQty <= 0) continue;
              const allocateQty = Math.min(remaining, freeQty);
              allocations.push({ batch_id: batch.id, allocated_qty: allocateQty });
              remaining -= allocateQty;
            }

            if (allocations.length > 0) {
              await trx.raw(
                'SELECT public.allocate_sale_batches(?, ?, ?, ?, ?, ?::jsonb)',
                [
                  dealerId,
                  saleItemId,
                  item.product_id,
                  item.unitType,
                  item.perBoxSft ?? 0,
                  JSON.stringify(allocations),
                ],
              );
            }

            // If allocations didn't cover everything (shouldn't usually happen
            // because we already gated on availableQty), fall back to
            // unbatched deduction for the remainder.
            const allocated = allocations.reduce((s, a) => s + a.allocated_qty, 0);
            const stillNeeded = deductQty - allocated;
            if (stillNeeded > 0) {
              await trx.raw(
                'SELECT public.deduct_stock_unbatched(?, ?, ?, ?, ?)',
                [item.product_id, dealerId, item.unitType, item.perBoxSft ?? 0, stillNeeded],
              );
            }
          }

          // Consume explicitly selected reservations
          const sels = input.reservation_selections?.[item.product_id];
          if (sels && sels.length > 0) {
            for (const sel of sels) {
              await trx.raw(
                'SELECT public.consume_reservation_for_sale(?, ?, ?, ?)',
                [sel.reservation_id, dealerId, saleItemId, sel.consume_qty],
              );
            }
          }

          // ── Stock ledger audit row (sale_out) ──
          const stockAfterRow = await trx('stock')
            .where({ dealer_id: dealerId, product_id: item.product_id })
            .first('total_pieces');
          const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);
          await trx('stock_ledger').insert({
            dealer_id: dealerId,
            product_id: item.product_id,
            txn_type: 'sale_out',
            reference_table: 'sales',
            reference_id: newSaleId,
            reference_no: invoiceNumber,
            box_qty: -Number(item.box_qty),
            piece_qty: -Number(item.piece_qty),
            pieces_per_box: item.pieces_per_box,
            total_pieces: -Number(item.total_pieces),
            stock_before_pieces: stockBeforePieces,
            stock_after_pieces: stockAfterPieces,
            stock_before_display: formatBoxPiece(stockBeforePieces, item.pieces_per_box),
            stock_after_display: formatBoxPiece(stockAfterPieces, item.pieces_per_box),
            created_by: userId,
          });
        }

        // ── Ledger entries ──
        await trx('customer_ledger').insert({
          dealer_id: dealerId,
          customer_id: customerId,
          sale_id: newSaleId,
          type: 'sale',
          amount: totalAmount,
          description: `Sale ${invoiceNumber}${hasBackorder ? ' (Backorder)' : ''}`,
          entry_date: input.sale_date,
        });

        if (input.paid_amount > 0) {
          await trx('customer_ledger').insert({
            dealer_id: dealerId,
            customer_id: customerId,
            sale_id: newSaleId,
            type: 'payment',
            amount: input.paid_amount,
            description: `Payment received for ${invoiceNumber}`,
            entry_date: input.sale_date,
          });

          await trx('cash_ledger').insert({
            dealer_id: dealerId,
            type: 'receipt',
            amount: input.paid_amount,
            description: `Payment received: ${invoiceNumber}`,
            reference_type: 'sales',
            reference_id: newSaleId,
            entry_date: input.sale_date,
          });
        }
      }

      // ── Audit log ──
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'sale_create',
        table_name: 'sales',
        record_id: newSaleId,
        new_data: {
          invoice_number: invoiceNumber,
          customer_id: customerId,
          total_amount: totalAmount,
          item_count: input.items.length,
          has_backorder: hasBackorder,
          backorder_items: itemsCalc
            .filter((i) => i.backorder_qty > 0)
            .map((i) => ({ product_id: i.product_id, backorder_qty: i.backorder_qty })),
        },
        ip_address: ip,
        user_agent: ua,
      });

      return newSaleId;
    });

    // ── 7. Auto-create challan stub (outside main tx; same DB) ──
    try {
      const challanRes = await db.raw<{ rows: { generate_next_challan_no: string }[] }>(
        'SELECT public.generate_next_challan_no(?) AS generate_next_challan_no',
        [dealerId],
      );
      const challanNo = challanRes.rows[0]?.generate_next_challan_no
        ?? `CH-${String(Date.now()).slice(-5)}`;

      await db('challans').insert({
        dealer_id: dealerId,
        sale_id: saleId,
        challan_no: challanNo,
        challan_date: input.sale_date,
        status: 'pending',
        delivery_status: 'pending',
        created_by: userId,
        show_price: false,
      });
    } catch (e) {
      // Don't block on challan stub creation; logged for ops.
      console.warn('[sales.create] challan stub creation failed', e);
    }

    // Return the created sale row
    const created = await db('sales').where({ id: saleId }).first();
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[sales.create] error', err);
    // Phase 1A — surface tile-product master-data issues as a clean 400
    // instead of an opaque 500. The InvalidProductPerBoxSftError is
    // thrown by computeLineCogs when a 'box_sft' product has a missing or
    // non-positive per_box_sft. Operators must fix the product master.
    if (err instanceof InvalidProductPerBoxSftError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res
      .status(500)
      .json({ error: err?.message || 'Failed to create sale' });
  }
});

// ─────────────────────── UPDATE / DELETE (Phase 3M) ──────────────────────
//
// PUT /api/sales/:id — full-replace edit. Mirrors `salesService.update()`:
//   1. Fetch existing sale + items.
//   2. Restore old stock (batched portion via restore_sale_batches RPC,
//      then unbatched remainder via direct stock add).
//   3. Delete old ledger entries + old sale_items.
//   4. Find/create customer; recompute totals from new items.
//   5. Update sales header; insert new sale_items.
//   6. Re-deduct stock (FIFO via allocate_sale_batches OR
//      deduct_stock_unbatched for legacy products).
//   7. Re-create customer/cash ledger entries.
//   8. Audit log row.
//
// DELETE /api/sales/:id — cancel + delete. Mirrors `salesService.cancelSale()`:
//   Guards: not delivered, no deliveries, no payment recorded.
//   Reverses: batch allocations, unbatched stock, backorder allocations,
//   sale_item_batches, ledger entries, related challans (cancelled),
//   sale_items, and finally the sales row. Single transaction.

router.put('/:id', async (req: Request, res: Response) => {
  const roles = (req.user?.roles ?? []) as string[];
  // Salesman is INSERT-only; updates require dealer_admin or super_admin.
  if (!roles.includes('super_admin') && !roles.includes('dealer_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can edit sales' });
    return;
  }

  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { id: saleId } = req.params;

  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = req.user?.userId ?? null;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ua = (req.headers['user-agent'] as string) || null;

  try {
    // ── Pre-tx: load existing sale + verify dealer ──
    const oldSale = await db('sales')
      .where({ id: saleId, dealer_id: dealerId })
      .first();
    if (!oldSale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    const oldItems = await db('sale_items')
      .where({ sale_id: saleId })
      .select('id', 'product_id', 'quantity', 'available_qty_at_sale', 'box_qty', 'piece_qty', 'total_pieces');

    // ── Pre-tx: customer find/create ──
    const customerName = input.customer_name.trim();
    let customerId: string;
    const existing = await db('customers')
      .where({ dealer_id: dealerId })
      .andWhereRaw('LOWER(name) = LOWER(?)', [customerName])
      .first('id');
    if (existing) {
      customerId = existing.id;
    } else {
      const [created] = await db('customers')
        .insert({
          dealer_id: dealerId,
          name: customerName,
          type: 'customer',
          status: 'active',
        })
        .returning('id');
      customerId = created.id;
    }

    // ── Pre-tx: products + stock for new items (avg cost) ──
    const productIds = Array.from(new Set(input.items.map((i) => i.product_id)));
    const [products, stocks] = await Promise.all([
      db('products')
        .whereIn('id', productIds)
        .andWhere({ dealer_id: dealerId })
        .select('id', 'unit_type', 'per_box_sft', 'pieces_per_box'),
      db('stock')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', productIds)
        .select('product_id', 'average_cost_per_unit'),
    ]);
    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found for this dealer' });
      return;
    }
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const stockMap = new Map(stocks.map((s: any) => [s.product_id, s]));

    // ── Recompute totals (no shortage check on update — match old behaviour) ──
    let totalBox = 0, totalSft = 0, totalPiece = 0, totalCogs = 0;
    const itemsCalc = input.items.map((item) => {
      const product: any = productMap.get(item.product_id);
      const stock: any = stockMap.get(item.product_id);
      const avgCost = stock ? Number(stock.average_cost_per_unit) : 0;
      const unitType = (product?.unit_type ?? 'piece') as 'box_sft' | 'piece';
      const perBoxSft = Number(product?.per_box_sft ?? 0);
      const ppb = Math.max(1, Math.floor(Number(product?.pieces_per_box ?? 1)) || 1);

      let boxQty: number;
      let pieceQty: number;
      if (item.box_qty != null || item.piece_qty != null) {
        boxQty = Number(item.box_qty ?? 0);
        pieceQty = Number(item.piece_qty ?? 0);
      } else if (unitType === 'box_sft') {
        boxQty = Math.floor(item.quantity);
        pieceQty = Math.round((item.quantity - boxQty) * ppb);
      } else {
        boxQty = 0;
        pieceQty = item.quantity;
      }
      const totalPiecesItem = boxQty * ppb + pieceQty;
      const effectiveQty =
        unitType === 'box_sft' ? boxQty + pieceQty / ppb : pieceQty || item.quantity;

      let itemTotal: number;
      let itemSft: number | null = null;
      if (unitType === 'box_sft') {
        totalBox += effectiveQty;
        itemSft = effectiveQty * perBoxSft;
        totalSft += itemSft;
        itemTotal = itemSft * item.sale_rate;
      } else {
        totalPiece += effectiveQty;
        itemTotal = effectiveQty * item.sale_rate;
      }
      // Phase 1A — dimensionally correct COGS via computeLineCogs (same
      // formula as the POST path; identical guard for missing per_box_sft).
      totalCogs += computeLineCogs({
        unitType,
        effectiveQty,
        perBoxSft,
        avgCost,
      });
      return {
        ...item,
        quantity: effectiveQty,
        box_qty: boxQty,
        piece_qty: pieceQty,
        total_pieces: totalPiecesItem,
        pieces_per_box: ppb,
        unitType,
        perBoxSft,
        total: itemTotal,
        total_sft: itemSft,
      };
    });

    const subtotal = itemsCalc.reduce((s, i) => s + i.total, 0);
    const totalAmount = subtotal - input.discount;
    const dueAmount = totalAmount - input.paid_amount;
    const grossProfit = totalAmount - totalCogs;

    // ── Atomic transaction ──
    await db.transaction(async (trx) => {
      // 1. Restore old stock (batched + unbatched) + write stock_ledger restore row
      for (const it of oldItems) {
        const prod: any = await trx('products')
          .where({ id: it.product_id })
          .first('unit_type', 'per_box_sft', 'pieces_per_box');
        const unitType = (prod?.unit_type ?? 'piece') as 'box_sft' | 'piece';
        const perBoxSft = Number(prod?.per_box_sft ?? 0);
        const ppb = Math.max(1, Math.floor(Number(prod?.pieces_per_box ?? 1)) || 1);

        const stockBeforeRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: it.product_id })
          .forUpdate()
          .first('total_pieces');
        const stockBeforePieces = Number(stockBeforeRow?.total_pieces ?? 0);

        const batchAllocs = await trx('sale_item_batches')
          .where({ sale_item_id: it.id })
          .select('allocated_qty');
        const batchAllocated = batchAllocs.reduce(
          (s: number, a: any) => s + Number(a.allocated_qty),
          0,
        );

        // Atomic batch restore (also restores aggregate for batched portion +
        // deletes sale_item_batches rows; total_pieces handled inside RPC).
        await trx.raw(
          'SELECT public.restore_sale_batches(?, ?, ?, ?, ?)',
          [it.id, it.product_id, dealerId, unitType, perBoxSft],
        );

        // Restore unbatched portion (legacy stock)
        const unbatchedQty = Number(it.quantity) - batchAllocated;
        if (unbatchedQty > 0) {
          const restorePieces = unitType === 'box_sft' ? unbatchedQty * ppb : unbatchedQty;
          if (unitType === 'box_sft') {
            const stockRow = await trx('stock')
              .where({ product_id: it.product_id, dealer_id: dealerId })
              .first();
            if (stockRow) {
              const newBox = Number(stockRow.box_qty) + unbatchedQty;
              await trx('stock')
                .where({ id: stockRow.id })
                .update({
                  box_qty: newBox,
                  sft_qty: newBox * perBoxSft,
                  total_pieces: Number(stockRow.total_pieces ?? 0) + restorePieces,
                });
            }
          } else {
            await trx('stock')
              .where({ product_id: it.product_id, dealer_id: dealerId })
              .increment({ piece_qty: unbatchedQty, total_pieces: restorePieces });
          }
        }

        // stock_ledger restore audit row
        const stockAfterRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: it.product_id })
          .first('total_pieces');
        const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);
        await trx('stock_ledger').insert({
          dealer_id: dealerId,
          product_id: it.product_id,
          txn_type: 'sale_update_in',
          reference_table: 'sales',
          reference_id: saleId,
          reference_no: oldSale.invoice_number,
          box_qty: Number(it.box_qty ?? 0),
          piece_qty: Number(it.piece_qty ?? 0),
          pieces_per_box: ppb,
          total_pieces: Number(it.total_pieces ?? Number(it.quantity) * ppb),
          stock_before_pieces: stockBeforePieces,
          stock_after_pieces: stockAfterPieces,
          stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
          stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
          created_by: userId,
        });
      }

      // 2. Delete old ledger entries
      await trx('customer_ledger')
        .where({ sale_id: saleId, dealer_id: dealerId })
        .delete();
      await trx('cash_ledger')
        .where({ reference_id: saleId, dealer_id: dealerId })
        .delete();

      // 3. Delete old sale_items (also cleans sale_item_batches if any
      // remain, via FK cascade — but restore_sale_batches already cleaned).
      await trx('sale_items').where({ sale_id: saleId }).delete();

      // 4. Update sales header
      await trx('sales')
        .where({ id: saleId })
        .update({
          customer_id: customerId,
          sale_date: input.sale_date,
          total_amount: totalAmount,
          discount: input.discount,
          discount_reference: input.discount_reference?.trim() || null,
          client_reference: input.client_reference?.trim() || null,
          fitter_reference: input.fitter_reference?.trim() || null,
          paid_amount: input.paid_amount,
          due_amount: dueAmount,
          cogs: totalCogs,
          // Phase 1A — re-stamp provenance on every update. A row that was
          // 'legacy_pre_fix' is promoted to 'post_fix' once it is edited
          // because the new totals were computed by computeLineCogs.
          cogs_method: 'post_fix',
          profit: grossProfit,
          gross_profit: grossProfit,
          net_profit: grossProfit,
          total_box: totalBox,
          total_sft: totalSft,
          total_piece: totalPiece,
          notes: input.notes?.trim() || null,
          payment_mode: input.payment_mode || null,
        });

      // 5. Insert new sale_items
      const itemRows = itemsCalc.map((item) => ({
        sale_id: saleId,
        dealer_id: dealerId,
        product_id: item.product_id,
        quantity: item.quantity,
        qty_sqft: (item as any).qty_sqft ?? null,
        box_qty: item.box_qty,
        piece_qty: item.piece_qty,
        total_pieces: item.total_pieces,
        sale_rate: item.sale_rate,
        rate_unit: (item as any).rate_unit ?? null,
        total: item.total,
        total_sft: item.total_sft,
        rate_source: item.rate_source ?? 'default',
        tier_id: item.tier_id ?? null,
        original_resolved_rate: item.original_resolved_rate ?? null,
      }));
      const insertedItems = await trx('sale_items')
        .insert(itemRows)
        .returning(['id', 'product_id']);
      const saleItemIdsByIndex: string[] = insertedItems.map((r: any) => r.id);

      // 6. Re-deduct stock per item (FIFO or unbatched)
      for (let idx = 0; idx < itemsCalc.length; idx++) {
        const item = itemsCalc[idx];
        const saleItemId = saleItemIdsByIndex[idx];
        const deductQty = item.quantity;
        if (deductQty <= 0) continue;

        const stockBeforeRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: item.product_id })
          .forUpdate()
          .first('total_pieces');
        const stockBeforePieces = Number(stockBeforeRow?.total_pieces ?? 0);

        const batches = await trx('product_batches')
          .where({ dealer_id: dealerId, product_id: item.product_id, status: 'active' })
          .orderBy('created_at', 'asc')
          .forUpdate()
          .select('id', 'box_qty', 'piece_qty', 'reserved_box_qty', 'reserved_piece_qty');

        if (batches.length === 0) {
          await trx.raw(
            'SELECT public.deduct_stock_unbatched(?, ?, ?, ?, ?)',
            [item.product_id, dealerId, item.unitType, item.perBoxSft ?? 0, deductQty],
          );
        } else {
          const allocations: { batch_id: string; allocated_qty: number }[] = [];
          let remaining = deductQty;
          for (const batch of batches) {
            if (remaining <= 0) break;
            const totalQty =
              item.unitType === 'box_sft' ? Number(batch.box_qty) : Number(batch.piece_qty);
            const reservedQty =
              item.unitType === 'box_sft'
                ? Number(batch.reserved_box_qty ?? 0)
                : Number(batch.reserved_piece_qty ?? 0);
            const freeQty = totalQty - reservedQty;
            if (freeQty <= 0) continue;
            const allocateQty = Math.min(remaining, freeQty);
            allocations.push({ batch_id: batch.id, allocated_qty: allocateQty });
            remaining -= allocateQty;
          }
          if (allocations.length > 0) {
            await trx.raw(
              'SELECT public.allocate_sale_batches(?, ?, ?, ?, ?, ?::jsonb)',
              [
                dealerId,
                saleItemId,
                item.product_id,
                item.unitType,
                item.perBoxSft ?? 0,
                JSON.stringify(allocations),
              ],
            );
          }
          const allocated = allocations.reduce((s, a) => s + a.allocated_qty, 0);
          const stillNeeded = deductQty - allocated;
          if (stillNeeded > 0) {
            await trx.raw(
              'SELECT public.deduct_stock_unbatched(?, ?, ?, ?, ?)',
              [item.product_id, dealerId, item.unitType, item.perBoxSft ?? 0, stillNeeded],
            );
          }
        }

        // Stock ledger audit row (sale_update_out)
        const stockAfterRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: item.product_id })
          .first('total_pieces');
        const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);
        await trx('stock_ledger').insert({
          dealer_id: dealerId,
          product_id: item.product_id,
          txn_type: 'sale_update_out',
          reference_table: 'sales',
          reference_id: saleId,
          reference_no: oldSale.invoice_number,
          box_qty: -Number(item.box_qty),
          piece_qty: -Number(item.piece_qty),
          pieces_per_box: item.pieces_per_box,
          total_pieces: -Number(item.total_pieces),
          stock_before_pieces: stockBeforePieces,
          stock_after_pieces: stockAfterPieces,
          stock_before_display: formatBoxPiece(stockBeforePieces, item.pieces_per_box),
          stock_after_display: formatBoxPiece(stockAfterPieces, item.pieces_per_box),
          created_by: userId,
        });
      }

      // 7. Re-create ledger entries
      await trx('customer_ledger').insert({
        dealer_id: dealerId,
        customer_id: customerId,
        sale_id: saleId,
        type: 'sale',
        amount: totalAmount,
        description: `Sale ${oldSale.invoice_number} (edited)`,
        entry_date: input.sale_date,
      });

      if (input.paid_amount > 0) {
        await trx('customer_ledger').insert({
          dealer_id: dealerId,
          customer_id: customerId,
          sale_id: saleId,
          type: 'payment',
          amount: input.paid_amount,
          description: `Payment for ${oldSale.invoice_number} (edited)`,
          entry_date: input.sale_date,
        });
        await trx('cash_ledger').insert({
          dealer_id: dealerId,
          type: 'receipt',
          amount: input.paid_amount,
          description: `Payment: ${oldSale.invoice_number} (edited)`,
          reference_type: 'sales',
          reference_id: saleId,
          entry_date: input.sale_date,
        });
      }

      // 8. Audit log
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'sale_update',
        table_name: 'sales',
        record_id: saleId,
        old_data: {
          total_amount: Number(oldSale.total_amount),
          customer_id: oldSale.customer_id,
          paid_amount: Number(oldSale.paid_amount),
        },
        new_data: {
          total_amount: totalAmount,
          customer_id: customerId,
          paid_amount: input.paid_amount,
        },
        ip_address: ip,
        user_agent: ua,
      });
    });

    res.json({ id: saleId });
  } catch (err: any) {
    console.error('[sales.update] error', err);
    // Phase 1A — surface tile-product master-data issues as a clean 400.
    if (err instanceof InvalidProductPerBoxSftError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: err?.message || 'Failed to update sale' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const roles = (req.user?.roles ?? []) as string[];
  // Only dealer_admin / super_admin can cancel/delete sales.
  if (!roles.includes('super_admin') && !roles.includes('dealer_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can delete sales' });
    return;
  }

  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { id: saleId } = req.params;
  const userId = req.user?.userId ?? null;
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    null;
  const ua = (req.headers['user-agent'] as string) || null;

  try {
    // ── Pre-tx: load + guards ──
    const sale = await db('sales')
      .where({ id: saleId, dealer_id: dealerId })
      .first();
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const items = await db('sale_items')
      .where({ sale_id: saleId })
      .select('id', 'product_id', 'quantity', 'available_qty_at_sale', 'box_qty', 'piece_qty', 'total_pieces');

    const challans = await db('challans')
      .where({ sale_id: saleId, dealer_id: dealerId })
      .select('id', 'status', 'delivery_status');
    const hasDelivered = challans.some(
      (c: any) => c.delivery_status === 'delivered' || c.status === 'delivered',
    );
    if (hasDelivered) {
      res.status(400).json({ error: 'Cannot delete a sale that has been delivered' });
      return;
    }

    const [{ count: deliveryCount }] = await db('deliveries')
      .where({ sale_id: saleId, dealer_id: dealerId })
      .count<{ count: string }[]>('id as count');
    if (Number(deliveryCount) > 0) {
      res.status(400).json({ error: 'Cannot delete a sale with existing deliveries' });
      return;
    }

    if (Number(sale.paid_amount) > 0 && sale.sale_status === 'invoiced') {
      res.status(400).json({
        error: 'Cannot delete a sale with payments recorded. Record a sales return instead.',
      });
      return;
    }

    // ── Atomic transaction ──
    await db.transaction(async (trx) => {
      // 1. Restore stock per item (batched via RPC + unbatched remainder) + ledger
      for (const it of items) {
        const prod: any = await trx('products')
          .where({ id: it.product_id })
          .first('unit_type', 'per_box_sft', 'pieces_per_box');
        const unitType = (prod?.unit_type ?? 'piece') as 'box_sft' | 'piece';
        const perBoxSft = Number(prod?.per_box_sft ?? 0);
        const ppb = Math.max(1, Math.floor(Number(prod?.pieces_per_box ?? 1)) || 1);

        const stockBeforeRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: it.product_id })
          .forUpdate()
          .first('total_pieces');
        const stockBeforePieces = Number(stockBeforeRow?.total_pieces ?? 0);

        const batchAllocs = await trx('sale_item_batches')
          .where({ sale_item_id: it.id })
          .select('allocated_qty');
        const batchAllocated = batchAllocs.reduce(
          (s: number, a: any) => s + Number(a.allocated_qty),
          0,
        );

        await trx.raw(
          'SELECT public.restore_sale_batches(?, ?, ?, ?, ?)',
          [it.id, it.product_id, dealerId, unitType, perBoxSft],
        );

        const deductedQty = Math.min(
          Number(it.quantity),
          Number(it.available_qty_at_sale ?? it.quantity),
        );
        const unbatchedQty = deductedQty - batchAllocated;
        if (unbatchedQty > 0) {
          const restorePieces = unitType === 'box_sft' ? unbatchedQty * ppb : unbatchedQty;
          if (unitType === 'box_sft') {
            const stockRow = await trx('stock')
              .where({ product_id: it.product_id, dealer_id: dealerId })
              .first();
            if (stockRow) {
              const newBox = Number(stockRow.box_qty) + unbatchedQty;
              await trx('stock')
                .where({ id: stockRow.id })
                .update({
                  box_qty: newBox,
                  sft_qty: newBox * perBoxSft,
                  total_pieces: Number(stockRow.total_pieces ?? 0) + restorePieces,
                });
            }
          } else {
            await trx('stock')
              .where({ product_id: it.product_id, dealer_id: dealerId })
              .increment({ piece_qty: unbatchedQty, total_pieces: restorePieces });
          }
        }

        // stock_ledger restore audit row (sale_cancel_in)
        const stockAfterRow = await trx('stock')
          .where({ dealer_id: dealerId, product_id: it.product_id })
          .first('total_pieces');
        const stockAfterPieces = Number(stockAfterRow?.total_pieces ?? 0);
        await trx('stock_ledger').insert({
          dealer_id: dealerId,
          product_id: it.product_id,
          txn_type: 'sale_cancel_in',
          reference_table: 'sales',
          reference_id: saleId,
          reference_no: sale.invoice_number,
          box_qty: Number(it.box_qty ?? 0),
          piece_qty: Number(it.piece_qty ?? 0),
          pieces_per_box: ppb,
          total_pieces: Number(it.total_pieces ?? Number(it.quantity) * ppb),
          stock_before_pieces: stockBeforePieces,
          stock_after_pieces: stockAfterPieces,
          stock_before_display: formatBoxPiece(stockBeforePieces, ppb),
          stock_after_display: formatBoxPiece(stockAfterPieces, ppb),
          created_by: userId,
        });
      }

      // 2. Delete backorder allocations
      const saleItemIds = items.map((i: any) => i.id).filter(Boolean);
      if (saleItemIds.length > 0) {
        await trx('backorder_allocations').whereIn('sale_item_id', saleItemIds).delete();
        // sale_item_batches already cleaned by restore_sale_batches but be defensive
        await trx('sale_item_batches').whereIn('sale_item_id', saleItemIds).delete();
      }

      // 3. Delete ledger entries
      await trx('customer_ledger')
        .where({ sale_id: saleId, dealer_id: dealerId })
        .delete();
      await trx('cash_ledger')
        .where({ reference_id: saleId, dealer_id: dealerId })
        .delete();

      // 4. Cancel related challans
      for (const ch of challans) {
        if (ch.status !== 'cancelled') {
          await trx('challans').where({ id: ch.id }).update({ status: 'cancelled' });
        }
      }

      // 5. Delete sale_items + sales row
      await trx('sale_items').where({ sale_id: saleId }).delete();
      await trx('sales').where({ id: saleId }).delete();

      // 6. Audit
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'sale_cancel_delete',
        table_name: 'sales',
        record_id: saleId,
        old_data: {
          invoice_number: sale.invoice_number,
          total_amount: Number(sale.total_amount),
          customer_id: sale.customer_id,
          items_reversed: items.length,
          had_backorder: sale.has_backorder,
        },
        ip_address: ip,
        user_agent: ua,
      });
    });

    res.status(204).end();
  } catch (err: any) {
    console.error('[sales.cancelSale] error', err);
    res.status(500).json({ error: err?.message || 'Failed to cancel sale' });
  }
});

export default router;
