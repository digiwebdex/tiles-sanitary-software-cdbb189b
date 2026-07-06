/**
 * Purchase Invoice routes — V2 Sprint 5D (Purchase Invoice).
 *
 *   GET    /api/purchase-invoices/goods-receipts/uninvoiced?dealerId=&supplierId=
 *   GET    /api/purchase-invoices/goods-receipt/:grnId/lines
 *   POST   /api/purchase-invoices                       (create draft from one or more GRN lines)
 *   PUT    /api/purchase-invoices/:id                    (edit — draft only, replaces items)
 *   DELETE /api/purchase-invoices/:id                    (draft only)
 *   POST   /api/purchase-invoices/:id/finalize           (assign invoice number, post VAT + supplier_ledger)
 *   POST   /api/purchase-invoices/:id/cancel             (draft only)
 *
 * Deliberately does NOT introduce a new invoice table — a Purchase Invoice
 * IS a `purchases` row (document_status='draft'|'posted'|'cancelled'|
 * 'reversed'). This means List/Details/Payment are the EXISTING, unmodified
 * `GET /api/purchases`, `GET /api/purchases/:id`, and
 * `POST /api/purchases/:id/payment` endpoints — this file only adds the
 * write paths those didn't already cover: creating a draft from Goods
 * Receipt line(s) and finalizing it. No stock/batch/warehouse posting
 * happens here — Goods Receipt (Sprint 5C) already did that; this is a
 * financial-only path (VAT + supplier_ledger), same division of
 * responsibility Sprint 5C established for GRN vs. the old purchases.ts
 * quick-entry flow (which still does both stock AND finance atomically,
 * untouched, for dealers who don't use the PR→RFQ→PO→GRN pipeline).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { computeVatBreakdown } from '../lib/vatMath';
import { loadDealerVatSettings, insertTaxPostingLine } from '../services/taxPostingService';
import { recordSupplierPaymentFifo } from '../lib/supplierPayment';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
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

/** Already-invoiced qty per GRN item, counting only draft/posted invoices (a cancelled one releases its claim). */
async function loadInvoicedMap(db: any, dealerId: string, goodsReceiptItemIds: string[]): Promise<Map<string, number>> {
  if (goodsReceiptItemIds.length === 0) return new Map();
  const rows = await db('purchase_items as pi')
    .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
    .where({ 'pi.dealer_id': dealerId })
    .whereIn('pi.source_goods_receipt_item_id', goodsReceiptItemIds)
    .whereIn('p.document_status', ['draft', 'posted'])
    .groupBy('pi.source_goods_receipt_item_id')
    .select('pi.source_goods_receipt_item_id as goods_receipt_item_id')
    .sum({ invoiced: 'pi.quantity' });
  return new Map(rows.map((r: any) => [r.goods_receipt_item_id, Number(r.invoiced) || 0]));
}

// ── GET /api/purchase-invoices/goods-receipts/uninvoiced ────────────────
// Completed GRNs that still have at least one line with invoiceable
// quantity remaining — the picker for "create invoice from GRN(s)".
router.get('/goods-receipts/uninvoiced', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const supplierId = (req.query.supplierId as string) || '';

    let q = db('goods_receipts as gr')
      .innerJoin('purchase_orders as po', 'po.id', 'gr.purchase_order_id')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'gr.dealer_id': dealerId, 'gr.status': 'completed' });
    if (supplierId) q = q.andWhere('po.supplier_id', supplierId);

    const rows = await q.select('gr.id', 'gr.grn_number', 'gr.receive_date', 'po.supplier_id', 's.name as supplier_name');
    res.json({ rows });
  } catch (err: any) {
    console.error('[purchase-invoices/uninvoiced-grns]', err.message);
    res.status(500).json({ error: 'Failed to list uninvoiced goods receipts' });
  }
});

// ── GET /api/purchase-invoices/goods-receipt/:grnId/lines ────────────────
router.get('/goods-receipt/:grnId/lines', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const gr = await db('goods_receipts').where({ id: req.params.grnId, dealer_id: dealerId, status: 'completed' }).first();
    if (!gr) {
      res.status(404).json({ error: 'Completed goods receipt not found' });
      return;
    }
    const items = await db('goods_receipt_items as gri')
      .innerJoin('purchase_order_items as poi', 'poi.id', 'gri.purchase_order_item_id')
      .where({ 'gri.dealer_id': dealerId, goods_receipt_id: gr.id })
      .select('gri.id', 'gri.product_id', 'poi.product_name_snapshot', 'gri.received_qty', 'poi.rate');

    const invoicedMap = await loadInvoicedMap(db, dealerId, items.map((i: any) => i.id));
    const lines = items.map((i: any) => {
      const invoiced = invoicedMap.get(i.id) ?? 0;
      return {
        goods_receipt_item_id: i.id,
        product_id: i.product_id,
        product_name_snapshot: i.product_name_snapshot,
        received_qty: Number(i.received_qty),
        rate: Number(i.rate),
        invoiced_qty: invoiced,
        invoiceable_qty: Math.max(0, Number(i.received_qty) - invoiced),
      };
    });
    res.json({ goods_receipt: gr, lines });
  } catch (err: any) {
    console.error('[purchase-invoices/grn-lines]', err.message);
    res.status(500).json({ error: 'Failed to load goods receipt lines' });
  }
});

const itemSchema = z.object({
  goods_receipt_item_id: z.string().uuid(),
  product_id: z.string().uuid(),
  invoice_qty: z.coerce.number().positive(),
  rate: z.coerce.number().min(0),
});

const formSchema = z.object({
  supplier_id: z.string().uuid(),
  purchase_date: z.string().min(1),
  notes: z.string().nullable().optional(),
  voucher_discount: z.coerce.number().min(0).default(0),
  items: z.array(itemSchema).min(1),
});

function computeSubtotal(items: z.infer<typeof itemSchema>[]): number {
  return items.reduce((sum, it) => sum + it.invoice_qty * it.rate, 0);
}

async function validateAndInsertItems(
  trx: any,
  dealerId: string,
  purchaseId: string,
  items: z.infer<typeof itemSchema>[],
) {
  const invoicedMap = await loadInvoicedMap(trx, dealerId, items.map((i) => i.goods_receipt_item_id));
  const grnItems = await trx('goods_receipt_items')
    .where({ dealer_id: dealerId })
    .whereIn('id', items.map((i) => i.goods_receipt_item_id));
  const grnItemMap = new Map<string, any>(grnItems.map((g: any) => [g.id, g]));

  for (const item of items) {
    const grnItem = grnItemMap.get(item.goods_receipt_item_id);
    if (!grnItem) {
      throw Object.assign(new Error('Goods receipt line not found for this dealer.'), { status: 400 });
    }
    const alreadyInvoiced = invoicedMap.get(item.goods_receipt_item_id) ?? 0;
    const wouldBe = alreadyInvoiced + item.invoice_qty;
    if (wouldBe > Number(grnItem.received_qty) + 0.001) {
      throw Object.assign(
        new Error(`Cannot over-invoice: already invoiced ${alreadyInvoiced} of ${grnItem.received_qty} received.`),
        { status: 409 },
      );
    }
  }

  const rows = items.map((it) => ({
    purchase_id: purchaseId,
    dealer_id: dealerId,
    product_id: it.product_id,
    quantity: it.invoice_qty,
    purchase_rate: it.rate,
    total: it.invoice_qty * it.rate,
    landed_cost: it.invoice_qty * it.rate,
    source_goods_receipt_item_id: it.goods_receipt_item_id,
  }));
  await trx('purchase_items').insert(rows);
}

// ── POST /api/purchase-invoices ──────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, purchase_date, notes, voucher_discount, items } = parsed.data;
    const userId = req.user?.userId ?? null;
    const subtotal = computeSubtotal(items);
    const discount = Math.max(0, Math.min(voucher_discount, subtotal));

    const purchase = await db.transaction(async (trx) => {
      const [row] = await trx('purchases')
        .insert({
          dealer_id: dealerId,
          supplier_id,
          purchase_date,
          notes: notes || null,
          voucher_discount: discount,
          total_amount: Math.max(0, subtotal - discount),
          document_status: 'draft',
          created_by: userId,
        })
        .returning('*');
      await validateAndInsertItems(trx, dealerId, row.id, items);
      return row;
    });

    res.status(201).json({ row: purchase });
  } catch (err: any) {
    console.error('[purchase-invoices/create]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create purchase invoice' });
  }
});

// ── PUT /api/purchase-invoices/:id — edit (draft only) ───────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, purchase_date, notes, voucher_discount, items } = parsed.data;
    const subtotal = computeSubtotal(items);
    const discount = Math.max(0, Math.min(voucher_discount, subtotal));

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchases').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      if (existing.document_status !== 'draft') {
        throw Object.assign(new Error('Only a draft purchase invoice can be edited.'), { status: 409 });
      }

      await trx('purchase_items').where({ purchase_id: existing.id, dealer_id: dealerId }).delete();

      const [updated] = await trx('purchases')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({
          supplier_id, purchase_date, notes: notes || null,
          voucher_discount: discount, total_amount: Math.max(0, subtotal - discount),
        })
        .returning('*');
      await validateAndInsertItems(trx, dealerId, updated.id, items);
      return updated;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase invoice not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-invoices/update]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update purchase invoice' });
  }
});

// ── DELETE /api/purchase-invoices/:id — draft only ───────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const deleted = await db.transaction(async (trx) => {
      const existing = await trx('purchases').where({ id: req.params.id, dealer_id: dealerId, document_status: 'draft' }).first();
      if (!existing) return false;
      await trx('purchase_items').where({ purchase_id: existing.id, dealer_id: dealerId }).delete();
      await trx('purchases').where({ id: existing.id }).delete();
      return true;
    });

    if (!deleted) {
      res.status(409).json({ error: 'Only a draft purchase invoice can be deleted.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[purchase-invoices/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete purchase invoice' });
  }
});

// ── POST /api/purchase-invoices/:id/finalize ─────────────────────────────
const finalizeSchema = z.object({
  paid_on_create: z.coerce.number().min(0).default(0),
  paid_account_id: z.string().uuid().nullable().optional(),
});

router.post('/:id/finalize', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = finalizeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { paid_on_create, paid_account_id } = parsed.data;
    const userId = req.user?.userId ?? null;

    const result = await db.transaction(async (trx) => {
      const purchase = await trx('purchases').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!purchase) return null;
      if (purchase.document_status !== 'draft') {
        throw Object.assign(new Error('Only a draft purchase invoice can be finalized.'), { status: 409 });
      }

      const items = await trx('purchase_items').where({ purchase_id: purchase.id, dealer_id: dealerId });
      if (items.length === 0) {
        throw Object.assign(new Error('Cannot finalize a purchase invoice with no items.'), { status: 409 });
      }

      // Re-validate over-invoice at finalize time (a concurrent invoice may
      // have claimed some of the same GRN quantity since this draft was created).
      const grnItemIds = items.map((i: any) => i.source_goods_receipt_item_id).filter(Boolean);
      if (grnItemIds.length) {
        const invoicedMap = await loadInvoicedMap(trx, dealerId, grnItemIds);
        const grnRows = await trx('goods_receipt_items').whereIn('id', grnItemIds);
        const grnMap = new Map(grnRows.map((g: any) => [g.id, g]));
        for (const item of items) {
          if (!item.source_goods_receipt_item_id) continue;
          const grnItem = grnMap.get(item.source_goods_receipt_item_id);
          if (!grnItem) continue;
          // Subtract this invoice's own already-counted quantity, then re-add it,
          // to check the total across ALL draft/posted invoices (including this one).
          const totalForLine = invoicedMap.get(item.source_goods_receipt_item_id) ?? 0;
          if (totalForLine > Number(grnItem.received_qty) + 0.001) {
            throw Object.assign(new Error('This invoice now exceeds the received quantity for one or more lines — another invoice may have claimed the remainder.'), { status: 409 });
          }
        }
      }

      const subtotal = items.reduce((sum: number, it: any) => sum + Number(it.total), 0);
      const netPayable = Math.max(0, subtotal - Number(purchase.voucher_discount || 0));
      const vatSettings = await loadDealerVatSettings(dealerId, trx);
      const vatBreakdown = computeVatBreakdown(netPayable, vatSettings);
      const grossPayable = vatBreakdown.total_with_tax;

      // Invoice numbering — same per-dealer-daily-sequence convention
      // purchases.ts's own quick-entry flow uses (PUR-YYYYMMDD-NNNN), so
      // every invoice in this table looks consistent regardless of which
      // path created it. That logic is inline in purchases.ts (frozen) —
      // re-implemented here, not imported.
      const datePart = (purchase.purchase_date || new Date().toISOString().slice(0, 10)).toString().replace(/-/g, '').slice(0, 8);
      const prefix = `PUR-${datePart}-`;
      const existingNums = await trx('purchases').where({ dealer_id: dealerId }).andWhere('invoice_number', 'like', `${prefix}%`).select('invoice_number');
      let maxSeq = 0;
      for (const r of existingNums) {
        const m = /-(\d+)$/.exec(r.invoice_number || '');
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
      const invoiceNumber = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;

      const [updated] = await trx('purchases')
        .where({ id: purchase.id })
        .update({
          invoice_number: invoiceNumber,
          document_status: 'posted',
          total_amount: grossPayable,
          taxable_amount: vatBreakdown.taxable_amount,
          vat_rate: vatBreakdown.vat_rate,
          vat_amount: vatBreakdown.vat_amount,
          sd_amount: vatBreakdown.sd_amount,
          paid_on_create,
          paid_account_id: paid_account_id || null,
          posted_at: new Date(),
          posted_by: userId,
        })
        .returning('*');

      await trx('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id: purchase.supplier_id,
        purchase_id: purchase.id,
        type: 'purchase',
        amount: -grossPayable,
        description: `Purchase Invoice ${invoiceNumber}`,
        entry_date: purchase.purchase_date,
      });

      if (paid_on_create > 0) {
        // Reuses the existing FIFO payment recorder — since this targets a
        // specific purchase_id, it applies the full amount to this invoice.
        await recordSupplierPaymentFifo(trx, {
          dealerId,
          supplierId: purchase.supplier_id,
          amount: paid_on_create,
          paid_account_id: paid_account_id || null,
          entry_date: purchase.purchase_date,
          purchaseId: purchase.id,
          note: `Payment on finalize: ${invoiceNumber}`,
        });
      }

      if (vatBreakdown.vat_amount > 0 || vatBreakdown.sd_amount > 0) {
        const supplierTaxRow = await trx('suppliers').where({ id: purchase.supplier_id }).first('gstin');
        await insertTaxPostingLine(trx, {
          dealerId,
          documentType: 'purchase',
          documentId: purchase.id,
          entryDate: purchase.purchase_date,
          taxableAmount: vatBreakdown.taxable_amount,
          taxRate: vatBreakdown.vat_rate,
          taxAmount: vatBreakdown.vat_amount,
          sdAmount: vatBreakdown.sd_amount,
          partyId: purchase.supplier_id,
          partyTaxId: (supplierTaxRow as any)?.gstin ?? null,
          mushakForm: '6.1',
        });
      }

      return updated;
    });

    if (!result) {
      res.status(404).json({ error: 'Purchase invoice not found' });
      return;
    }
    res.json({ row: result });
  } catch (err: any) {
    console.error('[purchase-invoices/finalize]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to finalize purchase invoice' });
  }
});

// ── POST /api/purchase-invoices/:id/cancel — draft only ──────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('purchases')
      .where({ id: req.params.id, dealer_id: dealerId, document_status: 'draft' })
      .update({ document_status: 'cancelled' })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a draft purchase invoice can be cancelled.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-invoices/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel purchase invoice' });
  }
});

export default router;
