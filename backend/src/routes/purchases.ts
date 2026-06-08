/**
 * Purchases routes — Phase 3H (reads) + Phase 3K (create).
 *
 *   GET  /api/purchases?dealerId=&page=1&search=
 *   GET  /api/purchases/:id
 *   POST /api/purchases                          ← Phase 3K (atomic mutation)
 *
 * Phase 3K: `POST /api/purchases` ports `purchaseService.create()` from the
 * React app to the VPS, wrapping ALL side-effects in a single Knex
 * transaction so a failure rolls back partial state. Side-effects covered:
 *
 *   1. Look up products (unit_type, per_box_sft).
 *   2. Compute base + landed cost per item.
 *   3. Insert `purchases` header.
 *   4. Insert `purchase_items` rows.
 *   5. For each item: find-or-create `product_batches` row (null-safe match
 *      on shade / caliber / lot_no), top-up qty, link the purchase_item to
 *      its batch.
 *   6. Add aggregate `stock` (creating a row if needed) + recompute
 *      `average_cost_per_unit` (weighted by SFT for box_sft, by qty for piece).
 *   7. Allocate newly-received stock to any pending backorder `sale_items`
 *      for that product (FIFO by sale_items.created_at), creating
 *      `backorder_allocations` rows and updating sale fulfillment status +
 *      `sales.has_backorder` flag.
 *   8. Insert `supplier_ledger` (purchase, negative) and `cash_ledger`
 *      (purchase, negative) entries.
 *   9. Write a single `audit_logs` row keyed to req.user.userId.
 *
 * Update / Delete are NOT in scope for Phase 3K — those would need to
 * reverse all of the above (release allocations, restore batches, reverse
 * ledger entries) and will land in a follow-up.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { formatBoxPiece } from '../lib/units';
import { attachPurchasePaymentSummaries, buildPurchasePaymentSummary, sumPurchaseLedgerPayments } from '../lib/purchasePaymentSummary';
import { recordSupplierPayment } from '../lib/supplierPayment';
import { requireRole } from '../middleware/roles';
import {
  isPostingEngineEnabled,
  mirrorToPostingTables,
} from '../services/posting/PostingOrchestrator';
import { buildPurchaseLedgerLines } from '../services/posting/LedgerPostingEngine';
import {
  buildPurchaseStockLines,
  type PurchaseStockPostedItem,
} from '../services/posting/StockPostingEngine';

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

// ─────────────────────────── READS (Phase 3H) ────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const search = ((req.query.search as string) || '').trim();
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const base = db('purchases').where({ dealer_id: dealerId });
    if (search) base.andWhere('invoice_number', 'ilike', `%${search}%`);

    const [{ count: totalCount }] = await base
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const rows = await base
      .clone()
      .select('*')
      .orderBy([
        { column: 'purchase_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(PAGE_SIZE)
      .offset(offset);

    const enriched = await attachPurchasePaymentSummaries(dealerId, rows);

    const supIds = Array.from(new Set(enriched.map((r) => r.supplier_id).filter(Boolean)));
    const suppliers = supIds.length
      ? await db('suppliers').whereIn('id', supIds).select('id', 'name')
      : [];
    const supMap = new Map(suppliers.map((s: any) => [s.id, s]));

    const data = enriched.map((r) => ({
      ...r,
      suppliers: r.supplier_id ? supMap.get(r.supplier_id) ?? null : null,
    }));

    res.json({ data, total: Number(totalCount) || 0 });
  } catch (err) {
    console.error('[purchases.list] error', err);
    res.status(500).json({ error: 'Failed to load purchases' });
  }
});

// ───────────────────────── DRAFTS (Phase 3U-31) ─────────────────────────
// Registered before `/:id` so the literal path wins the routing match.

router.get('/drafts/list', async (req: Request, res: Response) => {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Drafts are dealer_admin-only' });
    return;
  }
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('purchase_drafts')
      .where({ dealer_id: dealerId })
      .orderBy('updated_at', 'desc')
      .limit(50)
      .select('id', 'label', 'payload', 'created_at', 'updated_at', 'created_by');
    res.json({ data: rows });
  } catch (err) {
    console.error('[purchases.drafts.list] error', err);
    res.status(500).json({ error: 'Failed to load drafts' });
  }
});

const draftBodySchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().max(120).optional().nullable(),
  payload: z.record(z.any()),
});

router.post('/drafts', async (req: Request, res: Response) => {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Drafts are dealer_admin-only' });
    return;
  }
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = draftBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { id, label, payload } = parsed.data;
  const userId = req.user?.userId ?? null;
  try {
    if (id) {
      const updated = await db('purchase_drafts')
        .where({ id, dealer_id: dealerId })
        .update({ label: label ?? null, payload, updated_at: db.fn.now() })
        .returning(['id', 'label', 'payload', 'updated_at']);
      if (!updated.length) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      res.json(updated[0]);
      return;
    }
    const [row] = await db('purchase_drafts')
      .insert({ dealer_id: dealerId, created_by: userId, label: label ?? null, payload })
      .returning(['id', 'label', 'payload', 'updated_at']);
    res.status(201).json(row);
  } catch (err) {
    console.error('[purchases.drafts.save] error', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

router.delete('/drafts/:id', async (req: Request, res: Response) => {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Drafts are dealer_admin-only' });
    return;
  }
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const n = await db('purchase_drafts')
      .where({ id: req.params.id, dealer_id: dealerId })
      .del();
    if (!n) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[purchases.drafts.delete] error', err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});


// ── POST /api/purchases/:id/payment ───────────────────────────────────────
const purchasePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional(),
  paid_account_id: z.string().uuid().optional().nullable(),
});

router.post('/:id/payment', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = purchasePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await db.transaction(async (trx) =>
      recordSupplierPayment(trx, {
        dealerId,
        purchaseId: req.params.id,
        amount: parsed.data.amount,
        note: parsed.data.note,
        paid_account_id: parsed.data.paid_account_id,
      }),
    );
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[purchases.payment]', err.message);
    res.status(400).json({ error: err.message || 'Failed to record payment' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { id } = req.params;

  try {
    const purchase = await db('purchases')
      .where({ id, dealer_id: dealerId })
      .first();
    if (!purchase) {
      res.status(404).json({ error: 'Purchase not found' });
      return;
    }

    const [supplier, items] = await Promise.all([
      purchase.supplier_id
        ? db('suppliers').where({ id: purchase.supplier_id }).first('id', 'name')
        : Promise.resolve(null),
      db('purchase_items as pi')
        .leftJoin('products as p', 'p.id', 'pi.product_id')
        .where('pi.purchase_id', id)
        .select(
          'pi.*',
          db.raw(`json_build_object(
            'name', p.name,
            'sku', p.sku,
            'unit_type', p.unit_type,
            'per_box_sft', p.per_box_sft
          ) as products`),
        ),
    ]);

    const paidMap = await sumPurchaseLedgerPayments(dealerId, [id]);
    const paymentSummary = buildPurchasePaymentSummary(purchase, paidMap.get(id) || 0);

    const paymentHistory = await db('supplier_ledger')
      .where({ dealer_id: dealerId, purchase_id: id, type: 'payment' })
      .orderBy('entry_date', 'desc')
      .orderBy('created_at', 'desc')
      .select('id', 'amount', 'description', 'entry_date', 'created_at');

    res.json({
      ...purchase,
      ...paymentSummary,
      suppliers: supplier ?? null,
      purchase_items: items,
      payment_history: paymentHistory,
    });
  } catch (err) {
    console.error('[purchases.getById] error', err);
    res.status(500).json({ error: 'Failed to load purchase' });
  }
});

// ───────────────────────── CREATE (Phase 3K) ─────────────────────────────

const purchaseItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Phase T4a — canonical SQFT qty for tile products (stock_base_unit='sqft' in T5).
   *  NULL = piece-mode item; legacy `quantity` is canonical. */
  qty_sqft: z.coerce.number().min(0).optional().nullable(),
  purchase_rate: z.coerce.number().min(0),
  /** 'per_piece' | 'per_box' | 'per_sqft'. NULL → legacy per_piece. */
  rate_unit: z.enum(['per_piece', 'per_box', 'per_sqft']).optional().nullable(),
  offer_price: z.coerce.number().min(0).default(0),
  transport_cost: z.coerce.number().min(0).default(0),
  labor_cost: z.coerce.number().min(0).default(0),
  other_cost: z.coerce.number().min(0).default(0),
  batch_no: z.string().trim().max(50).optional().nullable(),
  lot_no: z.string().trim().max(50).optional().nullable(),
  shade_code: z.string().trim().max(30).optional().nullable(),
  caliber: z.string().trim().max(30).optional().nullable(),
});

const createPurchaseSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid(),
  invoice_number: z.string().trim().max(50).optional().nullable(),
  purchase_date: z.string().min(1),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Phase 3U-31: voucher-level discount applied after item totals. */
  voucher_discount: z.coerce.number().min(0).optional().default(0),
  /** Phase 3U-31: amount paid at the time of creating the purchase. */
  paid_on_create: z.coerce.number().min(0).optional().default(0),
  /** NULL = cash; otherwise a bank_accounts.id. */
  paid_account_id: z.string().uuid().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1),
});

type ItemIn = z.infer<typeof purchaseItemSchema>;

function calcBaseCost(item: ItemIn, unitType: string, perBoxSft: number | null): number {
  if (unitType === 'box_sft' && perBoxSft) {
    return item.quantity * perBoxSft * item.purchase_rate;
  }
  return item.quantity * item.purchase_rate;
}

function calcLanded(base: number, item: ItemIn): number {
  return base + item.transport_cost + item.labor_cost + item.other_cost;
}

function calcTotalSft(qty: number, unitType: string, perBoxSft: number | null): number | null {
  if (unitType === 'box_sft' && perBoxSft) return qty * perBoxSft;
  return null;
}

function generateAutoBatchNo(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `AUTO-${date}-${suffix}`;
}

router.post('/', async (req: Request, res: Response) => {
  // Salesman is insert-only on sales-side but per access constraints they
  // do NOT manage purchases. Restrict to dealer_admin / super_admin.
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can record purchases' });
    return;
  }

  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = createPurchaseSchema.safeParse(req.body);
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
    // 1. Pre-fetch products (outside tx; read-only)
    const productIds = Array.from(new Set(input.items.map((i) => i.product_id)));
    const products = await db('products')
      .whereIn('id', productIds)
      .andWhere({ dealer_id: dealerId })
      .select('id', 'unit_type', 'per_box_sft', 'pieces_per_box');

    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found for this dealer' });
      return;
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Verify supplier belongs to dealer
    const supplier = await db('suppliers')
      .where({ id: input.supplier_id, dealer_id: dealerId })
      .first('id');
    if (!supplier) {
      res.status(400).json({ error: 'Supplier not found for this dealer' });
      return;
    }

    // 2. Compute item totals
    const itemsCalc = input.items.map((item) => {
      const product = productMap.get(item.product_id)!;
      const unitType = product.unit_type ?? 'piece';
      const perBoxSft = product.per_box_sft ?? null;
      const piecesPerBox = Math.max(1, Math.floor(Number(product.pieces_per_box) || 1));
      const base = calcBaseCost(item, unitType, perBoxSft);
      const landed = calcLanded(base, item);
      const totalSft = calcTotalSft(item.quantity, unitType, perBoxSft);
      // Canonical pieces delta. For tiles (box_sft) item.quantity = boxes, piece_qty=0.
      // For piece-unit products, item.quantity = pieces, ppb=1.
      const boxQty = unitType === 'box_sft' ? item.quantity : 0;
      const pieceQty = unitType === 'box_sft' ? 0 : item.quantity;
      const totalPieces = boxQty * piecesPerBox + pieceQty;
      return { src: item, product, unitType, perBoxSft, piecesPerBox, landed, totalSft, boxQty, pieceQty, totalPieces };
    });
    const totalAmount = itemsCalc.reduce((s, x) => s + x.landed, 0);

    // Phase 3U-31: voucher discount + paid_on_create normalization
    const voucherDiscount = Math.max(
      0,
      Math.min(input.voucher_discount ?? 0, totalAmount),
    );
    const netPayable = Math.max(0, totalAmount - voucherDiscount);
    const paidOnCreate = Math.max(0, Math.min(input.paid_on_create ?? 0, netPayable));
    const paidAccountId = input.paid_account_id ?? null;

    // Validate paid_account_id belongs to dealer (if provided)
    if (paidAccountId) {
      const bank = await db("bank_accounts")
        .where({ id: paidAccountId, dealer_id: dealerId })
        .first("id");
      if (!bank) {
        res.status(400).json({ error: "paid_account_id not found for this dealer" });
        return;
      }
    }

    // 3-9: Atomic transaction
    const purchaseId = await db.transaction(async (trx) => {
      // Resolve invoice number — auto-generate if not provided, ensure unique per dealer.
      let invoiceNumber: string | null = input.invoice_number?.trim() || null;
      if (invoiceNumber) {
        const dup = await trx('purchases')
          .where({ dealer_id: dealerId, invoice_number: invoiceNumber })
          .first('id');
        if (dup) {
          const err: any = new Error('DUPLICATE_INVOICE');
          err.code = 'DUPLICATE_INVOICE';
          throw err;
        }
      } else {
        // Auto-generate: PUR-YYYYMMDD-NNNN (per-dealer daily sequence)
        const datePart = (input.purchase_date || new Date().toISOString().slice(0, 10))
          .replace(/-/g, '')
          .slice(0, 8);
        const prefix = `PUR-${datePart}-`;
        // Find max existing seq for today
        const rows = await trx('purchases')
          .where({ dealer_id: dealerId })
          .andWhere('invoice_number', 'like', `${prefix}%`)
          .select('invoice_number');
        let maxSeq = 0;
        for (const r of rows) {
          const m = /-(\d+)$/.exec(r.invoice_number || '');
          if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        }
        // Retry up to 5 times in case of race
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = `${prefix}${String(maxSeq + 1 + attempt).padStart(4, '0')}`;
          const exists = await trx('purchases')
            .where({ dealer_id: dealerId, invoice_number: candidate })
            .first('id');
          if (!exists) {
            invoiceNumber = candidate;
            break;
          }
        }
        if (!invoiceNumber) {
          throw new Error('Failed to generate unique invoice number');
        }
      }

      // Insert purchase header
      const [purchase] = await trx('purchases')
        .insert({
          dealer_id: dealerId,
          supplier_id: input.supplier_id,
          invoice_number: invoiceNumber,
          purchase_date: input.purchase_date,
          total_amount: totalAmount,
          voucher_discount: voucherDiscount,
          paid_on_create: paidOnCreate,
          paid_account_id: paidAccountId,
          notes: input.notes?.trim() || null,
          created_by: userId,
        })
        .returning('id');
      const purchaseRowId = purchase.id;
      // Make resolved invoice number available to downstream code that reads input.invoice_number
      (input as any).invoice_number = invoiceNumber;


      // Insert purchase_items
      const itemRows = itemsCalc.map((x) => ({
        purchase_id: purchaseRowId,
        dealer_id: dealerId,
        product_id: x.src.product_id,
        quantity: x.src.quantity,
        qty_sqft: x.src.qty_sqft ?? null,
        box_qty: x.boxQty,
        piece_qty: x.pieceQty,
        total_pieces: x.totalPieces,
        purchase_rate: x.src.purchase_rate,
        rate_unit: x.src.rate_unit ?? null,
        offer_price: x.src.offer_price,
        transport_cost: x.src.transport_cost,
        labor_cost: x.src.labor_cost,
        other_cost: x.src.other_cost,
        landed_cost: x.landed,
        total_sft: x.totalSft,
        total: x.landed,
      }));
      const inserted = await trx('purchase_items').insert(itemRows).returning(['id', 'product_id']);
      // Map by index to preserve duplicate-product ordering
      const itemIdsByIndex: string[] = inserted.map((r: any) => r.id);

      const allocationsToRun: { productId: string; qty: number; purchaseItemId: string }[] = [];
      const postingStockItems: PurchaseStockPostedItem[] = [];

      // Per-item: batch + stock + avg cost
      for (let idx = 0; idx < itemsCalc.length; idx++) {
        const x = itemsCalc[idx];
        const purchaseItemId = itemIdsByIndex[idx];
        const item = x.src;

        // ── Find-or-create batch (null-safe match) ──
        const batchNo = (item.batch_no || '').trim() || generateAutoBatchNo();
        const shade = (item.shade_code || '').trim() || null;
        const caliber = (item.caliber || '').trim() || null;
        const lotNo = (item.lot_no || '').trim() || null;

        const batchQ = trx('product_batches')
          .where({
            dealer_id: dealerId,
            product_id: item.product_id,
            batch_no: batchNo,
          })
          .forUpdate();
        if (shade === null) batchQ.whereNull('shade_code');
        else batchQ.andWhere('shade_code', shade);
        if (caliber === null) batchQ.whereNull('caliber');
        else batchQ.andWhere('caliber', caliber);
        if (lotNo === null) batchQ.whereNull('lot_no');
        else batchQ.andWhere('lot_no', lotNo);

        const existingBatch = await batchQ.first();

        let batchId: string;
        if (existingBatch) {
          if (x.unitType === 'box_sft') {
            const newBox = Number(existingBatch.box_qty) + item.quantity;
            await trx('product_batches')
              .where({ id: existingBatch.id })
              .update({
                box_qty: newBox,
                sft_qty: newBox * (x.perBoxSft ?? 0),
                total_pieces: Number(existingBatch.total_pieces) + x.totalPieces,
                status: 'active',
              });
          } else {
            await trx('product_batches')
              .where({ id: existingBatch.id })
              .update({
                piece_qty: Number(existingBatch.piece_qty) + item.quantity,
                total_pieces: Number(existingBatch.total_pieces) + x.totalPieces,
                status: 'active',
              });
          }
          batchId = existingBatch.id;
        } else {
          const newRow: any = {
            dealer_id: dealerId,
            product_id: item.product_id,
            batch_no: batchNo,
            lot_no: lotNo,
            shade_code: shade,
            caliber: caliber,
            box_qty: 0,
            piece_qty: 0,
            sft_qty: 0,
            total_pieces: x.totalPieces,
            pieces_per_box_snapshot: x.piecesPerBox,
            status: 'active',
          };
          if (x.unitType === 'box_sft') {
            newRow.box_qty = item.quantity;
            newRow.sft_qty = item.quantity * (x.perBoxSft ?? 0);
          } else {
            newRow.piece_qty = item.quantity;
          }
          const [created] = await trx('product_batches').insert(newRow).returning('id');
          batchId = created.id;
        }

        // Link purchase_item → batch
        await trx('purchase_items').where({ id: purchaseItemId }).update({ batch_id: batchId });

        postingStockItems.push({
          purchaseItemId,
          productId: item.product_id,
          productBatchId: batchId,
          quantity: item.quantity,
          unitType: x.unitType,
          totalPieces: x.totalPieces,
          totalSft: x.totalSft,
          landedCost: x.landed,
        });

        // ── Aggregate stock add ──
        const stockRow = await trx('stock')
          .where({ product_id: item.product_id, dealer_id: dealerId })
          .forUpdate()
          .first();

        const stockBeforePieces = stockRow ? Number(stockRow.total_pieces) || 0 : 0;
        const stockAfterPieces = stockBeforePieces + x.totalPieces;

        if (!stockRow) {
          const newStock: any = {
            dealer_id: dealerId,
            product_id: item.product_id,
            box_qty: 0,
            piece_qty: 0,
            sft_qty: 0,
            total_pieces: x.totalPieces,
            average_cost_per_unit: 0,
          };
          if (x.unitType === 'box_sft') {
            newStock.box_qty = item.quantity;
            newStock.sft_qty = item.quantity * (x.perBoxSft ?? 0);
          } else {
            newStock.piece_qty = item.quantity;
          }
          // Initial average cost
          if (x.unitType === 'box_sft' && x.totalSft && x.totalSft > 0) {
            newStock.average_cost_per_unit = Math.round((x.landed / x.totalSft) * 100) / 100;
          } else if (item.quantity > 0) {
            newStock.average_cost_per_unit = Math.round((x.landed / item.quantity) * 100) / 100;
          }
          await trx('stock').insert(newStock);
        } else {
          // Compute new average cost (weighted with existing stock)
          const currentQtyBase =
            x.unitType === 'box_sft' ? Number(stockRow.sft_qty) : Number(stockRow.piece_qty);
          const currentTotal = currentQtyBase * Number(stockRow.average_cost_per_unit);
          const incomingQtyBase =
            x.unitType === 'box_sft' && x.totalSft ? x.totalSft : item.quantity;
          const incomingTotal = x.landed;
          const newQtyBase = currentQtyBase + incomingQtyBase;
          const newAvg = newQtyBase > 0 ? (currentTotal + incomingTotal) / newQtyBase : 0;

          if (x.unitType === 'box_sft') {
            const newBox = Number(stockRow.box_qty) + item.quantity;
            await trx('stock')
              .where({ id: stockRow.id })
              .update({
                box_qty: newBox,
                sft_qty: newBox * (x.perBoxSft ?? 0),
                total_pieces: stockAfterPieces,
                average_cost_per_unit: Math.round(newAvg * 100) / 100,
              });
          } else {
            await trx('stock')
              .where({ id: stockRow.id })
              .update({
                piece_qty: Number(stockRow.piece_qty) + item.quantity,
                total_pieces: stockAfterPieces,
                average_cost_per_unit: Math.round(newAvg * 100) / 100,
              });
          }
        }

        // ── stock_ledger audit row ──
        await trx('stock_ledger').insert({
          dealer_id: dealerId,
          product_id: item.product_id,
          txn_type: 'purchase_in',
          reference_table: 'purchases',
          reference_id: purchaseRowId,
          reference_no: input.invoice_number?.trim() || null,
          box_qty: x.boxQty,
          piece_qty: x.pieceQty,
          pieces_per_box: x.piecesPerBox,
          total_pieces: x.totalPieces,
          stock_before_pieces: stockBeforePieces,
          stock_after_pieces: stockAfterPieces,
          stock_before_display: formatBoxPiece(stockBeforePieces, x.piecesPerBox),
          stock_after_display: formatBoxPiece(stockAfterPieces, x.piecesPerBox),
          created_by: userId,
        });

        allocationsToRun.push({
          productId: item.product_id,
          qty: item.quantity,
          purchaseItemId,
        });
      }

      // ── Backorder allocation (FIFO) ──
      // After stock has been topped up, allocate to any pending sale_items
      // for this product that still have backorder_qty > 0.
      for (const alloc of allocationsToRun) {
        let remaining = alloc.qty;
        const pending = await trx('sale_items')
          .where({ dealer_id: dealerId, product_id: alloc.productId })
          .andWhere('backorder_qty', '>', 0)
          .orderBy('created_at', 'asc')
          .select('id', 'quantity', 'backorder_qty', 'allocated_qty', 'sale_id')
          .forUpdate();

        const touchedSaleIds = new Set<string>();
        for (const si of pending) {
          if (remaining <= 0) break;
          const curBack = Number(si.backorder_qty);
          const curAlloc = Number(si.allocated_qty);
          const unallocated = curBack - curAlloc;
          if (unallocated <= 0) continue;

          const allocateNow = Math.min(unallocated, remaining);
          const newAllocated = curAlloc + allocateNow;
          const newBackorder = curBack - allocateNow;
          const totalQty = Number(si.quantity);

          let newStatus: string;
          if (newBackorder <= 0) newStatus = 'in_stock';
          else if (newAllocated <= 0) newStatus = 'pending';
          else if (newAllocated >= newBackorder) newStatus = 'ready_for_delivery';
          else newStatus = 'partially_allocated';

          await trx('sale_items').where({ id: si.id }).update({
            allocated_qty: newAllocated,
            backorder_qty: newBackorder,
            fulfillment_status: newStatus,
          });

          await trx('backorder_allocations').insert({
            dealer_id: dealerId,
            product_id: alloc.productId,
            sale_item_id: si.id,
            purchase_item_id: alloc.purchaseItemId,
            allocated_qty: allocateNow,
          });

          remaining -= allocateNow;
          touchedSaleIds.add(si.sale_id);
        }

        // Refresh has_backorder flag on touched sales
        for (const saleId of touchedSaleIds) {
          const items = await trx('sale_items')
            .where({ sale_id: saleId })
            .select('backorder_qty', 'fulfillment_status');
          const hasBackorder = items.some(
            (i: any) =>
              Number(i.backorder_qty) > 0 ||
              !['in_stock', 'fulfilled', 'ready_for_delivery'].includes(i.fulfillment_status),
          );
          await trx('sales').where({ id: saleId }).update({ has_backorder: hasBackorder });
        }
      }

      // ── Supplier ledger (Phase 3U-31 aware) ──
      // We owe the supplier the net (after voucher discount).
      const invoiceLabel = input.invoice_number || purchaseRowId;
      const supplierDesc = voucherDiscount > 0
        ? `Purchase ${invoiceLabel} (disc ${voucherDiscount})`
        : `Purchase ${invoiceLabel}`;
      const paymentDesc = `Payment on purchase ${invoiceLabel}`;
      await trx('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id: input.supplier_id,
        purchase_id: purchaseRowId,
        type: 'purchase',
        amount: -netPayable,
        description: supplierDesc,
        entry_date: input.purchase_date,
      });

      // If we paid something at create time, record offsetting payment +
      // cash/bank debit. Otherwise, leave cash untouched (the bill is unpaid).
      if (paidOnCreate > 0) {
        // Supplier ledger payment entry (positive reduces what we owe)
        await trx('supplier_ledger').insert({
          dealer_id: dealerId,
          supplier_id: input.supplier_id,
          purchase_id: purchaseRowId,
          type: 'payment',
          amount: paidOnCreate,
          description: paymentDesc,
          entry_date: input.purchase_date,
        });

        if (paidAccountId) {
          await trx('bank_ledger').insert({
            dealer_id: dealerId,
            bank_account_id: paidAccountId,
            type: 'payment',
            amount: -paidOnCreate,
            description: `Purchase payment: ${invoiceLabel}`,
            reference_type: 'purchases',
            reference_id: purchaseRowId,
            entry_date: input.purchase_date,
            created_by: userId,
          });
        } else {
          await trx('cash_ledger').insert({
            dealer_id: dealerId,
            type: 'payment',
            amount: -paidOnCreate,
            description: `Purchase payment: ${invoiceLabel}`,
            reference_type: 'purchases',
            reference_id: purchaseRowId,
            entry_date: input.purchase_date,
          });
        }
      }

      // Phase 2 (P2-05): mirror stock + ledger effects into posting tables when enabled.
      if (isPostingEngineEnabled()) {
        await mirrorToPostingTables(
          {
            trx,
            dealerId,
            documentType: 'purchase',
            documentId: purchaseRowId,
            eventType: 'posted',
            entryDate: input.purchase_date,
            postedBy: userId,
            idempotencyKey: `purchase:post:${purchaseRowId}`,
          },
          [
            ...buildPurchaseStockLines({
              purchaseId: purchaseRowId,
              entryDate: input.purchase_date,
              items: postingStockItems,
            }),
            ...buildPurchaseLedgerLines({
              purchaseId: purchaseRowId,
              supplierId: input.supplier_id,
              entryDate: input.purchase_date,
              netPayable,
              paidOnCreate,
              paidAccountId,
              description: supplierDesc,
              paymentDescription: paymentDesc,
            }),
          ],
        );
      }

      // ── Audit log ──
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'purchase_create',
        table_name: 'purchases',
        record_id: purchaseRowId,
        new_data: {
          supplier_id: input.supplier_id,
          invoice_number: input.invoice_number,
          total_amount: totalAmount,
          item_count: input.items.length,
        },
        ip_address: ip,
        user_agent: ua,
      });

      return purchaseRowId;
    });

    // Return the created purchase header (post-tx read)
    const created = await db('purchases').where({ id: purchaseId }).first();
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[purchases.create] error', err);
    if (err?.code === 'DUPLICATE_INVOICE' || err?.code === '23505') {
      res.status(409).json({
        error: 'Reference No already used. Leave blank to auto-generate, or enter a different one.',
      });
      return;
    }
    res
      .status(500)
      .json({ error: err?.message || 'Failed to create purchase' });
  }
});


export default router;
