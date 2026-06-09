/**
 * Returns routes — Phase 3N (sales-returns + purchase-returns create).
 *
 *   POST /api/returns/sales       ← create a sales return (restore stock + customer/cash ledger + audit)
 *   POST /api/returns/purchases   ← create a purchase return (deduct stock + supplier/cash ledger + audit)
 *   GET  /api/returns/purchases/next-no?dealerId=
 *
 * Atomic semantics: each create wraps all side-effects in a single Knex
 * transaction so a failure rolls back partial state. Update / delete are
 * out of scope for Phase 3N (returns are append-only in current UI).
 *
 * Salesman role is sales-insert-only and does NOT manage returns. Both
 * endpoints require dealer_admin or super_admin (matches purchases.create
 * role policy and the wider receivables surface).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { restoreSaleReturnStock } from '../services/saleReturnStock';
import { deductPurchaseReturnStock } from '../services/purchaseReturnStock';

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
    res.status(403).json({ error: 'Only dealer_admin can record returns' });
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

// ────────────────────────────────────────────────────────────────────────────
// PURCHASE RETURNS
// ────────────────────────────────────────────────────────────────────────────

// ─── READS (Phase 3U-17) ────────────────────────────────────────────────

const PAGE_SIZE = 25;

router.get('/purchases', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const base = db('purchase_returns').where({ dealer_id: dealerId });
    const [{ count }] = await base
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const rows = await base
      .clone()
      .select('*')
      .orderBy([
        { column: 'return_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(PAGE_SIZE)
      .offset(offset);

    const supIds = Array.from(new Set(rows.map((r: any) => r.supplier_id).filter(Boolean)));
    const suppliers = supIds.length
      ? await db('suppliers').whereIn('id', supIds).select('id', 'name')
      : [];
    const supMap = new Map(suppliers.map((s: any) => [s.id, s]));

    const data = rows.map((r: any) => ({
      ...r,
      suppliers: r.supplier_id ? supMap.get(r.supplier_id) ?? null : null,
    }));

    res.json({ data, total: Number(count) || 0 });
  } catch (err: any) {
    console.error('[returns.purchases.list] error', err);
    res.status(500).json({ error: err?.message || 'Failed to load purchase returns' });
  }
});

router.get('/sales', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const rows = await db('sales_returns as sr')
      .leftJoin('sales as s', 's.id', 'sr.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .where('sr.dealer_id', dealerId)
      .orderBy('sr.return_date', 'desc')
      .select(
        'sr.*',
        db.raw(`json_build_object(
          'invoice_number', s.invoice_number,
          'customer_id', s.customer_id,
          'customers', json_build_object('name', c.name)
        ) as sales`),
        db.raw(`json_build_object(
          'name', p.name,
          'sku', p.sku
        ) as products`),
      );
    res.json(rows);
  } catch (err: any) {
    console.error('[returns.sales.list] error', err);
    res.status(500).json({ error: err?.message || 'Failed to load sales returns' });
  }
});

router.get('/sales/sale-items/:saleId/batches', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { saleId } = req.params;

  try {
    const sale = await db('sales').where({ id: saleId, dealer_id: dealerId }).first('id');
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    const rows = await db('sale_item_batches as sib')
      .join('sale_items as si', 'si.id', 'sib.sale_item_id')
      .join('product_batches as pb', 'pb.id', 'sib.batch_id')
      .where('si.sale_id', saleId)
      .where('sib.dealer_id', dealerId)
      .select(
        'sib.sale_item_id',
        'si.product_id',
        'sib.batch_id',
        'sib.allocated_qty',
        'pb.batch_no',
        'pb.shade_code',
        'pb.caliber',
        'pb.lot_no',
      )
      .orderBy('sib.created_at', 'asc');

    res.json({ data: rows });
  } catch (err: any) {
    console.error('[returns.sales.getSaleItemBatches] error', err);
    res.status(500).json({ error: err?.message || 'Failed to load batch allocations' });
  }
});

router.get('/sales/sale-items/:saleId', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const { saleId } = req.params;

  try {
    // Tenant guard: ensure sale belongs to this dealer
    const sale = await db('sales').where({ id: saleId, dealer_id: dealerId }).first('id');
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    const rows = await db('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .where('si.sale_id', saleId)
      .select(
        'si.*',
        db.raw(`json_build_object(
          'name', p.name,
          'sku', p.sku,
          'unit_type', p.unit_type,
          'per_box_sft', p.per_box_sft,
          'pieces_per_box', p.pieces_per_box,
          'category', p.category
        ) as products`),
      );
    res.json(rows);
  } catch (err: any) {
    console.error('[returns.sales.getSaleItems] error', err);
    res.status(500).json({ error: err?.message || 'Failed to load sale items' });
  }
});

router.get('/purchases/next-no', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const row = await db('purchase_returns')
      .where({ dealer_id: dealerId })
      .count<{ count: string }[]>('id as count');
    const count = Number(row?.[0]?.count ?? 0);
    res.json({ next_no: `PR-${String(count + 1).padStart(4, '0')}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to compute next return no' });
  }
});

const purchaseReturnSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid(),
  purchase_id: z.string().uuid().nullable().optional(),
  return_date: z.string().min(1),
  return_no: z.string().min(1),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        /** Phase T4a — canonical SQFT for tile (stock_base_unit='sqft' in T5) items. */
        qty_sqft: z.coerce.number().min(0).optional().nullable(),
        unit_price: z.coerce.number().nonnegative(),
        reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

router.post('/purchases', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = purchaseReturnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = req.user?.userId ?? null;
  const { ip, ua } = clientMeta(req);

  try {
    const itemsCalc = input.items.map((it) => ({
      ...it,
      total: Number(it.quantity) * Number(it.unit_price),
    }));
    const totalAmount = itemsCalc.reduce((s, it) => s + it.total, 0);

    // Verify supplier
    const supplier = await db('suppliers')
      .where({ id: input.supplier_id, dealer_id: dealerId })
      .first('id');
    if (!supplier) {
      res.status(400).json({ error: 'Supplier not found for this dealer' });
      return;
    }

    const returnId = await db.transaction(async (trx) => {
      const [header] = await trx('purchase_returns')
        .insert({
          dealer_id: dealerId,
          purchase_id: input.purchase_id || null,
          supplier_id: input.supplier_id,
          return_date: input.return_date,
          return_no: input.return_no,
          total_amount: totalAmount,
          notes: input.notes || null,
          status: 'completed',
          created_by: userId,
        })
        .returning('id');
      const rid = header.id;

      const itemRows = itemsCalc.map((it) => ({
        purchase_return_id: rid,
        dealer_id: dealerId,
        product_id: it.product_id,
        quantity: it.quantity,
        qty_sqft: (it as any).qty_sqft ?? null,
        unit_price: it.unit_price,
        total: it.total,
        reason: it.reason || null,
      }));
      await trx('purchase_return_items').insert(itemRows);

      // Deduct stock from batches FIFO (P3-04)
      for (const it of itemsCalc) {
        await deductPurchaseReturnStock(trx, {
          dealerId,
          productId: it.product_id,
          quantity: it.quantity,
          purchaseReturnId: rid,
          returnNo: input.return_no,
          userId,
        });
      }

      // Supplier ledger — refund (+amount means supplier owes us back / reduces our payable)
      await trx('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id: input.supplier_id,
        type: 'refund',
        amount: totalAmount,
        description: `Purchase Return ${input.return_no}`,
        entry_date: input.return_date,
      });

      // Cash ledger — refund inflow
      await trx('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'refund',
        amount: totalAmount,
        description: `Purchase Return: ${input.return_no}`,
        reference_type: 'purchase_returns',
        reference_id: rid,
        entry_date: input.return_date,
      });

      // Audit
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'purchase_return_create',
        table_name: 'purchase_returns',
        record_id: rid,
        new_data: {
          supplier_id: input.supplier_id,
          return_no: input.return_no,
          total_amount: totalAmount,
          item_count: input.items.length,
        },
        ip_address: ip,
        user_agent: ua,
      });

      return rid;
    });

    const created = await db('purchase_returns').where({ id: returnId }).first();
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[returns.purchase.create] error', err);
    if (err?.message?.includes('Insufficient')) {
      res.status(400).json({ error: err.message, code: 'INSUFFICIENT_STOCK' });
      return;
    }
    res.status(500).json({ error: err?.message || 'Failed to create purchase return' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SALES RETURNS
// ────────────────────────────────────────────────────────────────────────────

const salesReturnSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid(),
  product_id: z.string().uuid(),
  qty: z.coerce.number().positive(),
  /** Phase T4a — canonical SQFT for tile (stock_base_unit='sqft' in T5) items. */
  qty_sqft: z.coerce.number().min(0).optional().nullable(),
  reason: z.string().nullable().optional(),
  is_broken: z.boolean(),
  refund_amount: z.coerce.number().nonnegative(),
  refund_mode: z.string().nullable().optional(),
  return_date: z.string().min(1),
});

router.post('/sales', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const parsed = salesReturnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = req.user?.userId ?? null;
  const { ip, ua } = clientMeta(req);

  try {
    // Pre-tx validations (read-only)
    const sale = await db('sales')
      .where({ id: input.sale_id, dealer_id: dealerId })
      .first('id', 'customer_id', 'total_amount', 'invoice_number', 'due_amount', 'paid_amount', 'discount');
    if (!sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }
    if (Number(input.refund_amount) > Number(sale.total_amount)) {
      res.status(400).json({ error: 'Refund amount cannot exceed original sale amount' });
      return;
    }

    const saleItem = await db('sale_items')
      .where({ sale_id: input.sale_id, product_id: input.product_id })
      .first('id', 'quantity', 'backorder_qty', 'allocated_qty', 'fulfillment_status');
    if (!saleItem) {
      res.status(400).json({ error: 'Product not found in this sale' });
      return;
    }

    const existing = await db('sales_returns')
      .where({ sale_id: input.sale_id, product_id: input.product_id })
      .sum<{ sum: string }[]>('qty as sum');
    const alreadyReturned = Number(existing?.[0]?.sum ?? 0);
    if (alreadyReturned + Number(input.qty) > Number(saleItem.quantity)) {
      res.status(400).json({ error: 'Return quantity exceeds sold quantity' });
      return;
    }

    const returnId = await db.transaction(async (trx) => {
      let cogsReversal = 0;

      const [header] = await trx('sales_returns')
        .insert({
          dealer_id: dealerId,
          sale_id: input.sale_id,
          product_id: input.product_id,
          qty: input.qty,
          qty_sqft: input.qty_sqft ?? null,
          reason: input.reason || null,
          is_broken: input.is_broken,
          refund_amount: input.refund_amount,
          refund_mode: input.refund_mode || null,
          return_date: input.return_date,
          created_by: userId,
          cogs_reversal: 0,
        })
        .returning('id');
      const rid = header.id;

      // Restore stock with batch-aware LIFO (P3-01) + compute COGS reversal (P3-02)
      if (!input.is_broken) {
        const stockResult = await restoreSaleReturnStock(trx, {
          dealerId,
          saleItemId: saleItem.id,
          productId: input.product_id,
          returnQty: Number(input.qty),
          saleReturnId: rid,
          invoiceNumber: sale.invoice_number,
          userId,
        });
        cogsReversal = stockResult.cogsReversal;
        await trx('sales_returns').where({ id: rid }).update({ cogs_reversal: cogsReversal });
      }

      // Backorder cleanup if this sale_item still had backorder tracking
      if (!['in_stock', 'fulfilled'].includes(saleItem.fulfillment_status)) {
        // Release any backorder_allocations for this sale_item
        await trx('backorder_allocations').where({ sale_item_id: saleItem.id }).del();

        const newBackorder = Math.max(0, Number(saleItem.backorder_qty) - Number(input.qty));
        const newAllocated = Math.min(Number(saleItem.allocated_qty), newBackorder);
        let newStatus: string;
        if (newBackorder <= 0) newStatus = 'in_stock';
        else if (newAllocated >= newBackorder) newStatus = 'ready_for_delivery';
        else if (newAllocated > 0) newStatus = 'partially_allocated';
        else newStatus = 'pending';

        await trx('sale_items').where({ id: saleItem.id }).update({
          backorder_qty: newBackorder,
          allocated_qty: newAllocated,
          fulfillment_status: newStatus,
        });

        // Refresh has_backorder on parent sale
        const items = await trx('sale_items')
          .where({ sale_id: input.sale_id })
          .select('backorder_qty', 'fulfillment_status');
        const hasBackorder = items.some(
          (i: any) =>
            Number(i.backorder_qty) > 0 ||
            !['in_stock', 'fulfilled', 'ready_for_delivery'].includes(i.fulfillment_status),
        );
        await trx('sales').where({ id: input.sale_id }).update({ has_backorder: hasBackorder });
      }

      // Customer ledger — positive refund amount reduces customer balance (type-based)
      await trx('customer_ledger').insert({
        dealer_id: dealerId,
        customer_id: sale.customer_id,
        sale_id: input.sale_id,
        sales_return_id: rid,
        type: 'refund',
        amount: Number(input.refund_amount),
        description: `Return${input.is_broken ? ' (broken)' : ''}: ${
          input.reason || 'No reason'
        } [${sale.invoice_number}]`,
        entry_date: input.return_date,
      });

      // Sync invoice due/paid when a refund reduces what the customer owes
      if (Number(input.refund_amount) > 0) {
        const refund = Number(input.refund_amount);
        const due = Number(sale.due_amount) || 0;
        const paid = Number(sale.paid_amount) || 0;
        const dueReduction = Math.min(refund, due);
        const paidReduction = Math.max(0, refund - dueReduction);
        await trx('sales').where({ id: input.sale_id }).update({
          due_amount: Math.max(0, due - dueReduction),
          paid_amount: Math.max(0, paid - paidReduction),
        });
      }

      // Cash ledger — outflow if refund actually paid
      if (Number(input.refund_amount) > 0) {
        await trx('cash_ledger').insert({
          dealer_id: dealerId,
          type: 'refund',
          amount: -Number(input.refund_amount),
          description: `Refund for return: ${sale.invoice_number}`,
          reference_type: 'sales_returns',
          reference_id: rid,
          entry_date: input.return_date,
        });
      }

      // Audit
      await trx('audit_logs').insert({
        dealer_id: dealerId,
        user_id: userId,
        action: 'refund',
        table_name: 'sales_returns',
        record_id: rid,
        new_data: {
          sale_id: input.sale_id,
          product_id: input.product_id,
          qty: input.qty,
          is_broken: input.is_broken,
          refund_amount: input.refund_amount,
          refund_mode: input.refund_mode,
          cogs_reversal: cogsReversal,
        },
        ip_address: ip,
        user_agent: ua,
      });

      return rid;
    });

    const created = await db('sales_returns').where({ id: returnId }).first();
    res.status(201).json(created);
  } catch (err: any) {
    console.error('[returns.sales.create] error', err);
    res.status(500).json({ error: err?.message || 'Failed to create sales return' });
  }
});

export default router;
