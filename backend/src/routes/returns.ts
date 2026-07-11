/**
 * Returns routes — Phase 3N (sales-returns + purchase-returns create).
 *
 *   POST /api/returns/sales       ← create a sales return (restore stock + customer/cash ledger + audit)
 *   POST /api/returns/purchases   ← create a purchase return (deduct stock + supplier/cash ledger + audit)
 *   GET  /api/returns/purchases/next-no?dealerId=
 *   GET  /api/returns/credit-note-balance?customerId=   (V2 Sprint 4D)
 *   POST /api/returns/credit-note/apply                 (V2 Sprint 4D)
 *   POST /api/returns/sales/:id/link-exchange            (V2 Sprint 4D — "Exchange")
 *
 * Atomic semantics: each create wraps all side-effects in a single Knex
 * transaction so a failure rolls back partial state. Update / delete are
 * out of scope for Phase 3N (returns are append-only in current UI).
 *
 * Salesman role is sales-insert-only and does NOT manage returns. Both
 * endpoints require dealer_admin or super_admin (matches purchases.create
 * role policy and the wider receivables surface).
 *
 * V2 Sprint 4D — "Credit Note" is modeled as a sales_return whose
 * refund_mode='credit': no cash/bank posting happens (see the branch in
 * POST /sales below); the customer_ledger 'refund' row, which already
 * inserts unconditionally, IS the credit. creditNoteService.ts tracks how
 * much of a customer's aggregate credit-note balance has since been
 * applied to an invoice. "Exchange" is modeled as a Return whose
 * exchange_sale_id links to a separately-created new Sale (via the
 * existing, unmodified POST /api/sales) — link-exchange records that link
 * and, in the same action, draws down available credit-note balance
 * against the new sale.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { restoreSaleReturnStock } from '../services/saleReturnStock';
import { deductPurchaseReturnStock } from '../services/purchaseReturnStock';
import { normalizePaymentMode, paymentModeRequiresBankAccount } from '../lib/paymentModes';
import { getCreditNoteBalance, applyCreditNoteToSale } from '../services/creditNoteService';

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
          'category', p.category,
          'warranty', p.warranty
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
  /** V2 Sprint 4D — required when refund_mode needs a bank account (bank/cheque/card). */
  refund_paid_account_id: z.string().uuid().nullable().optional(),
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

  // V2 Sprint 4D — refund_mode branching: 'credit' means no cash/bank moves
  // (the customer_ledger 'refund' row already inserted below is the Credit
  // Note itself); everything else needs a real cash_ledger/bank_ledger entry.
  const refundMode = normalizePaymentMode(input.refund_mode) ?? (input.refund_mode?.trim().toLowerCase() === 'credit' ? 'credit' : null);
  if (
    Number(input.refund_amount) > 0 &&
    refundMode &&
    refundMode !== 'credit' &&
    paymentModeRequiresBankAccount(refundMode) &&
    !input.refund_paid_account_id
  ) {
    res.status(400).json({ error: 'Bank account is required for bank, cheque, or card refunds' });
    return;
  }

  try {
    // All validation runs INSIDE the transaction under a row lock on the sale,
    // so concurrent returns for the same sale serialise (prevents double-return
    // and over-refund races). Validation failures throw an error carrying a
    // statusCode that the catch block maps to the right HTTP status.
    const returnId = await db.transaction(async (trx) => {
      const sale = await trx('sales')
        .where({ id: input.sale_id, dealer_id: dealerId })
        .forUpdate()
        .first(
          'id',
          'customer_id',
          'total_amount',
          'invoice_number',
          'due_amount',
          'paid_amount',
          'discount',
          'document_status',
          'sale_status',
        );
      if (!sale) {
        throw Object.assign(new Error('Sale not found'), { statusCode: 404 });
      }
      // State guard: a reversed/cancelled sale has already had its stock and
      // ledger fully unwound — returning against it would double-refund and
      // phantom-restore stock.
      if (sale.document_status === 'reversed' || sale.sale_status === 'cancelled') {
        throw Object.assign(
          new Error('Cannot record a return against a reversed or cancelled sale'),
          { statusCode: 409 },
        );
      }
      if (Number(input.refund_amount) > Number(sale.total_amount)) {
        throw Object.assign(
          new Error('Refund amount cannot exceed original sale amount'),
          { statusCode: 400 },
        );
      }

      const saleItem = await trx('sale_items')
        .where({ sale_id: input.sale_id, product_id: input.product_id })
        .first('id', 'quantity', 'backorder_qty', 'allocated_qty', 'fulfillment_status');
      if (!saleItem) {
        throw Object.assign(new Error('Product not found in this sale'), { statusCode: 400 });
      }

      // Cumulative quantity guard (under the sale lock).
      const qtyAgg = await trx('sales_returns')
        .where({ sale_id: input.sale_id, product_id: input.product_id })
        .sum<{ sum: string }[]>('qty as sum');
      const alreadyReturned = Number(qtyAgg?.[0]?.sum ?? 0);
      if (alreadyReturned + Number(input.qty) > Number(saleItem.quantity)) {
        throw Object.assign(new Error('Return quantity exceeds sold quantity'), { statusCode: 400 });
      }

      // Cumulative refund guard: total refunded across all returns for this sale
      // must never exceed the original sale amount.
      const refundAgg = await trx('sales_returns')
        .where({ sale_id: input.sale_id })
        .sum<{ sum: string }[]>('refund_amount as sum');
      const alreadyRefunded = Number(refundAgg?.[0]?.sum ?? 0);
      if (alreadyRefunded + Number(input.refund_amount) > Number(sale.total_amount)) {
        throw Object.assign(
          new Error('Cumulative refund would exceed original sale amount'),
          { statusCode: 400 },
        );
      }

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
          refund_paid_account_id: input.refund_paid_account_id || null,
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

      // V2 Sprint 4D — refund_mode branching. 'credit' (Credit Note): no
      // cash/bank movement — the customer_ledger 'refund' row above already
      // is the credit; creditNoteService tracks how much of it gets applied
      // to a future invoice. Bank/cheque/card: post to bank_ledger instead
      // of cash_ledger. Everything else (cash, or a mobile-wallet mode):
      // cash_ledger, same as before, now tagged with the actual mode.
      if (Number(input.refund_amount) > 0 && refundMode !== 'credit') {
        const description = `Refund for return: ${sale.invoice_number}`;
        if (refundMode && paymentModeRequiresBankAccount(refundMode)) {
          await trx('bank_ledger').insert({
            dealer_id: dealerId,
            bank_account_id: input.refund_paid_account_id,
            type: 'refund',
            amount: -Number(input.refund_amount),
            description,
            reference_type: 'sales_returns',
            reference_id: rid,
            entry_date: input.return_date,
            payment_mode: refundMode,
          });
        } else {
          await trx('cash_ledger').insert({
            dealer_id: dealerId,
            type: 'refund',
            amount: -Number(input.refund_amount),
            description,
            reference_type: 'sales_returns',
            reference_id: rid,
            entry_date: input.return_date,
            ...(refundMode ? { payment_mode: refundMode } : {}),
          });
        }
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
          refund_paid_account_id: input.refund_paid_account_id ?? null,
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
    if (err?.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[returns.sales.create] error', err);
    res.status(500).json({ error: err?.message || 'Failed to create sales return' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CREDIT NOTE (V2 Sprint 4D) — reuses the 'credit' refund_mode above; these
// endpoints only report/apply the resulting balance, never create it.
// ────────────────────────────────────────────────────────────────────────────

router.get('/credit-note-balance', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const customerId = (req.query.customerId as string | undefined) || '';
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  try {
    const balance = await getCreditNoteBalance(dealerId, customerId);
    res.json({ balance });
  } catch (err: any) {
    console.error('[returns.credit-note-balance]', err.message);
    res.status(500).json({ error: 'Failed to load credit note balance' });
  }
});

const applyCreditNoteSchema = z.object({
  customer_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
});

router.post('/credit-note/apply', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = applyCreditNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { customer_id, sale_id, amount } = parsed.data;
  try {
    const result = await db.transaction((trx) =>
      applyCreditNoteToSale(trx, { dealerId, customerId: customer_id, saleId: sale_id, amount, appliedBy: req.user?.userId ?? null }),
    );
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[returns.credit-note-apply]', err.message);
    res.status(400).json({ error: err.message || 'Failed to apply credit note' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// EXCHANGE (V2 Sprint 4D) — "model Exchange as linked Return + New Sale".
// The new sale is created via the existing, unmodified POST /api/sales; this
// endpoint only records the audit link and — in the same action, since that
// is what "Exchange" means to a user — draws down the customer's available
// credit-note balance against that new sale (same math/table as the
// standalone Credit Note apply above, so the same return's value can never
// be spent twice).
// ────────────────────────────────────────────────────────────────────────────

const linkExchangeSchema = z.object({
  saleId: z.string().uuid(),
});

router.post('/sales/:id/link-exchange', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const parsed = linkExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const { saleId } = parsed.data;

  try {
    const result = await db.transaction(async (trx) => {
      const ret = await trx('sales_returns as sr')
        .join('sales as s', 's.id', 'sr.sale_id')
        .where({ 'sr.id': req.params.id, 's.dealer_id': dealerId })
        .first('sr.id', 'sr.refund_amount', 's.customer_id');
      if (!ret) throw Object.assign(new Error('Sales return not found'), { statusCode: 404 });
      if (!ret.customer_id) {
        throw Object.assign(new Error('Return has no linked customer — cannot exchange'), { statusCode: 400 });
      }

      await trx('sales_returns').where({ id: req.params.id }).update({ exchange_sale_id: saleId });

      const newSale = await trx('sales')
        .where({ id: saleId, dealer_id: dealerId, customer_id: ret.customer_id })
        .first('due_amount');
      if (!newSale) throw Object.assign(new Error('New sale not found for this customer'), { statusCode: 404 });

      const balance = await getCreditNoteBalance(dealerId, ret.customer_id);
      const applyAmount = Math.min(balance, Number(newSale.due_amount) || 0);
      if (applyAmount <= 0) return { applied: 0 };

      const applied = await applyCreditNoteToSale(trx, {
        dealerId,
        customerId: ret.customer_id,
        saleId,
        amount: applyAmount,
        appliedBy: req.user?.userId ?? null,
      });
      return { applied: applyAmount, newDue: applied.newDue };
    });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    if (err?.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('[returns.link-exchange]', err.message);
    res.status(500).json({ error: err.message || 'Failed to link exchange' });
  }
});

export default router;
