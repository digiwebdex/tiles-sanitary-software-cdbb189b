/**
 * Goods Receipt Note (GRN) routes — V2 Sprint 5C (Goods Receipt).
 *
 *   GET    /api/goods-receipts?dealerId=&search=&status=&purchaseOrderId=&page=
 *   GET    /api/goods-receipts/purchase-order/:poId/pending   (remaining/received/pending qty per PO line)
 *   GET    /api/goods-receipts/:id                            (items + PO summary)
 *   POST   /api/goods-receipts                                (create draft + items, against a PO)
 *   PUT    /api/goods-receipts/:id                             (edit — draft only, replaces items)
 *   DELETE /api/goods-receipts/:id                             (draft only)
 *   POST   /api/goods-receipts/:id/complete                    (post stock, update PO status)
 *   POST   /api/goods-receipts/:id/cancel                       (draft only)
 *
 * A genuinely new entity. `purchases.ts` already combines goods-receipt
 * quantity effects with financial effects (supplier_ledger/VAT/cash) in one
 * atomic write, but Purchase Invoice/Supplier Payment/Landed Cost/
 * Accounting Posting are all out of this sprint's scope — GRN only ever
 * moves quantity (see receivingStockPosting.ts). Backorder allocation is
 * deliberately NOT performed here (not in the sprint's own "Stock Posting"
 * list, and Sales is frozen) — see receivingStockPosting.ts's file header.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { postGoodsReceiptLine } from '../services/receivingStockPosting';
import { getDefaultWarehouseId } from '../services/warehouseTransferStock';

const router = Router();
router.use(authenticate, tenantGuard);

const PAGE_SIZE = 25;

// PO statuses a GRN may be created/completed against — explicitly excludes
// draft/pending_approval (not yet committed to the supplier), cancelled,
// closed, and fully_received (nothing left to receive).
const RECEIVABLE_PO_STATUSES = ['approved', 'sent', 'partially_received'];

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

/** Received-so-far per PO item, aggregated across completed GRNs only. */
async function loadReceivedMap(
  db: any,
  dealerId: string,
  purchaseOrderId: string,
): Promise<Map<string, number>> {
  const rows = await db('goods_receipt_items as gri')
    .innerJoin('goods_receipts as gr', 'gr.id', 'gri.goods_receipt_id')
    .where({ 'gr.dealer_id': dealerId, 'gr.purchase_order_id': purchaseOrderId, 'gr.status': 'completed' })
    .groupBy('gri.purchase_order_item_id')
    .select('gri.purchase_order_item_id')
    .sum({ received: 'gri.received_qty' });
  return new Map(rows.map((r: any) => [r.purchase_order_item_id, Number(r.received) || 0]));
}

const itemSchema = z.object({
  purchase_order_item_id: z.string().uuid(),
  product_id: z.string().uuid(),
  received_qty: z.coerce.number().positive(),
  batch_no: z.string().trim().max(50).nullable().optional(),
  lot_no: z.string().trim().max(50).nullable().optional(),
  shade_code: z.string().trim().max(30).nullable().optional(),
  caliber: z.string().trim().max(30).nullable().optional(),
  manufacturing_date: z.string().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  godown_id: z.string().uuid().nullable().optional(),
  rack_id: z.string().uuid().nullable().optional(),
  bin_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const formSchema = z.object({
  purchase_order_id: z.string().uuid(),
  receive_date: z.string().min(1),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

async function insertItems(trx: any, dealerId: string, goodsReceiptId: string, items: z.infer<typeof itemSchema>[]) {
  const rows = items.map((it, idx) => ({
    dealer_id: dealerId,
    goods_receipt_id: goodsReceiptId,
    purchase_order_item_id: it.purchase_order_item_id,
    product_id: it.product_id,
    received_qty: it.received_qty,
    batch_no: it.batch_no || null,
    lot_no: it.lot_no || null,
    shade_code: it.shade_code || null,
    caliber: it.caliber || null,
    manufacturing_date: it.manufacturing_date || null,
    warehouse_id: it.warehouse_id || null,
    godown_id: it.godown_id || null,
    rack_id: it.rack_id || null,
    bin_id: it.bin_id || null,
    notes: it.notes || null,
    sort_order: idx,
  }));
  await trx('goods_receipt_items').insert(rows);
}

// ── GET /api/goods-receipts ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const search = ((req.query.search as string) || '').trim();
    const status = (req.query.status as string) || '';
    const purchaseOrderId = (req.query.purchaseOrderId as string) || '';

    let q = db('goods_receipts as gr')
      .leftJoin('purchase_orders as po', 'po.id', 'gr.purchase_order_id')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where('gr.dealer_id', dealerId);
    if (status) q = q.andWhere('gr.status', status);
    if (purchaseOrderId) q = q.andWhere('gr.purchase_order_id', purchaseOrderId);
    if (search) {
      q = q.andWhere((b: any) => b.whereILike('gr.grn_number', `%${search}%`).orWhereILike('po.po_number', `%${search}%`).orWhereILike('s.name', `%${search}%`));
    }

    const countQ = q.clone().clearSelect().clearOrder().count<{ count: string }[]>('gr.id as count');
    const rowsQ = q
      .clone()
      .select('gr.*', 'po.po_number', 's.name as supplier_name')
      .orderBy('gr.created_at', 'desc')
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const [countRow] = await countQ;
    const rows = await rowsQ;
    res.json({ rows, total: Number(countRow?.count ?? 0) });
  } catch (err: any) {
    console.error('[goods-receipts/list]', err.message);
    res.status(500).json({ error: 'Failed to list goods receipts' });
  }
});

// ── GET /api/goods-receipts/purchase-order/:poId/pending ────────────────
// Remaining/Received/Pending quantity per PO line — used both to prefill
// "Receive Purchase Order" and to render the Purchase Receiving summary.
router.get('/purchase-order/:poId/pending', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const po = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'po.id': req.params.poId, 'po.dealer_id': dealerId })
      .select('po.*', 's.name as supplier_name')
      .first();
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }

    const items = await db('purchase_order_items').where({ purchase_order_id: po.id, dealer_id: dealerId }).orderBy('sort_order', 'asc');
    const receivedMap = await loadReceivedMap(db, dealerId, po.id);

    const lines = items.map((it: any) => {
      const received = receivedMap.get(it.id) ?? 0;
      const pending = Math.max(0, Number(it.ordered_qty) - received);
      return {
        purchase_order_item_id: it.id,
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        unit_type: it.unit_type,
        per_box_sft: it.per_box_sft,
        rate: it.rate,
        ordered_qty: Number(it.ordered_qty),
        received_qty: received,
        pending_qty: pending,
      };
    });

    res.json({ purchase_order: po, lines, receivable: RECEIVABLE_PO_STATUSES.includes(po.status) });
  } catch (err: any) {
    console.error('[goods-receipts/pending]', err.message);
    res.status(500).json({ error: 'Failed to load pending receipt lines' });
  }
});

// ── GET /api/goods-receipts/:id ──────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const gr = await db('goods_receipts as gr')
      .leftJoin('purchase_orders as po', 'po.id', 'gr.purchase_order_id')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'gr.id': req.params.id, 'gr.dealer_id': dealerId })
      .select('gr.*', 'po.po_number', 'po.status as purchase_order_status', 's.name as supplier_name')
      .first();
    if (!gr) {
      res.status(404).json({ error: 'Goods receipt not found' });
      return;
    }
    const items = await db('goods_receipt_items as gri')
      .leftJoin('products as p', 'p.id', 'gri.product_id')
      .leftJoin('warehouses as w', 'w.id', 'gri.warehouse_id')
      .leftJoin('godowns as g', 'g.id', 'gri.godown_id')
      .leftJoin('racks as r', 'r.id', 'gri.rack_id')
      .leftJoin('bins as b', 'b.id', 'gri.bin_id')
      .where({ 'gri.dealer_id': dealerId, goods_receipt_id: req.params.id })
      .orderBy('sort_order', 'asc')
      .select(
        'gri.*',
        'p.sku as product_sku',
        'w.name as warehouse_name',
        'g.name as godown_name',
        'r.name as rack_name',
        'b.bin_code as bin_code',
      );
    res.json({ ...gr, items });
  } catch (err: any) {
    console.error('[goods-receipts/get]', err.message);
    res.status(500).json({ error: 'Failed to load goods receipt' });
  }
});

// ── POST /api/goods-receipts ─────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { purchase_order_id, receive_date, notes, items } = parsed.data;
    const createdBy = req.user?.userId ?? null;

    const po = await db('purchase_orders').where({ id: purchase_order_id, dealer_id: dealerId }).first();
    if (!po) {
      res.status(400).json({ error: 'Purchase order not found for this dealer' });
      return;
    }
    if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
      res.status(409).json({ error: `Cannot receive against a purchase order in "${po.status}" status.` });
      return;
    }

    const row = await db.transaction(async (trx) => {
      const [gr] = await trx('goods_receipts')
        .insert({
          dealer_id: dealerId,
          purchase_order_id,
          receive_date,
          notes: notes || null,
          created_by: createdBy,
        })
        .returning('*');
      await insertItems(trx, dealerId, gr.id, items);
      return gr;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[goods-receipts/create]', err.message);
    res.status(500).json({ error: 'Failed to create goods receipt' });
  }
});

// ── PUT /api/goods-receipts/:id — edit (draft only) ──────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { purchase_order_id, receive_date, notes, items } = parsed.data;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('goods_receipts').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only a draft goods receipt can be edited.');
      }

      const [gr] = await trx('goods_receipts')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({ purchase_order_id, receive_date, notes: notes || null, updated_at: new Date() })
        .returning('*');

      await trx('goods_receipt_items').where({ goods_receipt_id: gr.id, dealer_id: dealerId }).delete();
      await insertItems(trx, dealerId, gr.id, items);
      return gr;
    });

    if (!row) {
      res.status(404).json({ error: 'Goods receipt not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[goods-receipts/update]', err.message);
    res.status(err.message?.includes('draft') ? 409 : 500).json({ error: err.message || 'Failed to update goods receipt' });
  }
});

// ── DELETE /api/goods-receipts/:id — draft only ──────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const deleted = await db('goods_receipts')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .delete();
    if (!deleted) {
      res.status(409).json({ error: 'Only a draft goods receipt can be deleted.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[goods-receipts/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete goods receipt' });
  }
});

// ── POST /api/goods-receipts/:id/complete ────────────────────────────────
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const result = await db.transaction(async (trx) => {
      const gr = await trx('goods_receipts').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!gr) return null;
      if (gr.status !== 'draft') {
        throw Object.assign(new Error('Only a draft goods receipt can be completed.'), { status: 409 });
      }

      const po = await trx('purchase_orders').where({ id: gr.purchase_order_id, dealer_id: dealerId }).forUpdate().first();
      if (!po) throw Object.assign(new Error('Purchase order not found'), { status: 400 });
      if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
        throw Object.assign(new Error(`Cannot receive against a purchase order in "${po.status}" status.`), { status: 409 });
      }

      const items = await trx('goods_receipt_items').where({ goods_receipt_id: gr.id, dealer_id: dealerId }).orderBy('sort_order', 'asc');
      if (items.length === 0) {
        throw Object.assign(new Error('Cannot complete a goods receipt with no items.'), { status: 409 });
      }

      const poItems = await trx('purchase_order_items').where({ purchase_order_id: po.id, dealer_id: dealerId });
      const poItemMap = new Map(poItems.map((i: any) => [i.id, i]));
      const receivedMap = await loadReceivedMap(trx, dealerId, po.id);

      // ── Over-Receive prevention (Quantity validation) ──
      for (const item of items) {
        const poItem = poItemMap.get(item.purchase_order_item_id);
        if (!poItem) {
          throw Object.assign(new Error('This line does not belong to the selected purchase order.'), { status: 400 });
        }
        if (Number(item.received_qty) <= 0) {
          throw Object.assign(new Error('Received quantity must be greater than zero.'), { status: 400 });
        }
        const alreadyReceived = receivedMap.get(item.purchase_order_item_id) ?? 0;
        const wouldBe = alreadyReceived + Number(item.received_qty);
        if (wouldBe > Number(poItem.ordered_qty) + 0.001) {
          throw Object.assign(
            new Error(`Cannot over-receive: ${poItem.product_name_snapshot} — ordered ${poItem.ordered_qty}, already received ${alreadyReceived}, this receipt would bring it to ${wouldBe}.`),
            { status: 409 },
          );
        }
      }

      const grnNumberResult = await trx.raw('SELECT generate_next_grn_no(?::uuid) AS no', [dealerId]);
      const grnNumber = String(grnNumberResult.rows?.[0]?.no ?? '');
      const defaultWarehouseId = await getDefaultWarehouseId(trx, dealerId);

      for (const item of items) {
        const poItem = poItemMap.get(item.purchase_order_item_id)!;
        const warehouseId = item.warehouse_id || defaultWarehouseId;
        await postGoodsReceiptLine(trx, {
          dealerId,
          goodsReceiptId: gr.id,
          grnNumber,
          entryDate: gr.receive_date,
          userId,
          line: {
            goodsReceiptItemId: item.id,
            productId: item.product_id,
            quantity: Number(item.received_qty),
            rate: Number(poItem.rate),
            batchNo: item.batch_no,
            lotNo: item.lot_no,
            shadeCode: item.shade_code,
            caliber: item.caliber,
            warehouseId,
            godownId: item.godown_id,
            rackId: item.rack_id,
          },
        });
        if (!item.warehouse_id && warehouseId) {
          await trx('goods_receipt_items').where({ id: item.id }).update({ warehouse_id: warehouseId });
        }
      }

      // ── PO Integration: recompute status from aggregate received-vs-ordered ──
      const updatedReceivedMap = await loadReceivedMap(trx, dealerId, po.id);
      const allFullyReceived = poItems.every((i: any) => (updatedReceivedMap.get(i.id) ?? 0) >= Number(i.ordered_qty) - 0.001);
      const anyReceived = poItems.some((i: any) => (updatedReceivedMap.get(i.id) ?? 0) > 0);
      const newPoStatus = allFullyReceived ? 'fully_received' : anyReceived ? 'partially_received' : po.status;

      const [updatedGr] = await trx('goods_receipts')
        .where({ id: gr.id })
        .update({ status: 'completed', completed_by: userId, completed_at: new Date(), grn_number: grnNumber, updated_at: new Date() })
        .returning('*');

      if (newPoStatus !== po.status) {
        await trx('purchase_orders').where({ id: po.id }).update({ status: newPoStatus, updated_at: new Date() });
      }
      await trx('purchase_order_approvals').insert({
        dealer_id: dealerId,
        purchase_order_id: po.id,
        action: 'received',
        actor_id: userId,
        note: `${grnNumber}: received ${items.length} line item(s).`,
      });

      return updatedGr;
    });

    if (!result) {
      res.status(404).json({ error: 'Goods receipt not found' });
      return;
    }
    res.json({ row: result });
  } catch (err: any) {
    console.error('[goods-receipts/complete]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to complete goods receipt' });
  }
});

// ── POST /api/goods-receipts/:id/cancel — draft only ─────────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const [row] = await db('goods_receipts')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .update({ status: 'cancelled', cancelled_by: userId, cancelled_at: new Date(), updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a draft goods receipt can be cancelled.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[goods-receipts/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel goods receipt' });
  }
});

export default router;
