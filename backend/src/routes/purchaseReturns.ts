/**
 * Purchase Return routes — V2 Sprint 5E.
 *
 *   GET    /api/purchase-returns/purchases/returnable?dealerId=&supplierId=
 *   GET    /api/purchase-returns/purchase/:purchaseId/lines?dealerId=
 *   POST   /api/purchase-returns                       (create draft)
 *   PUT    /api/purchase-returns/:id                    (edit — draft only)
 *   DELETE /api/purchase-returns/:id                    (draft only)
 *   GET    /api/purchase-returns/:id                    (details — new, doesn't exist elsewhere)
 *   POST   /api/purchase-returns/:id/complete           (post stock + supplier ledger)
 *   POST   /api/purchase-returns/:id/cancel             (draft only)
 *
 * Deliberately does NOT touch `backend/src/routes/returns.ts` (the pre-V2
 * "Phase 3N" file) even though its Purchase Return section was never given
 * its own frozen V2 sprint number — that file also holds genuinely frozen
 * Sales Return code (Sprint 4D), so it is treated with the same discipline
 * as any other frozen-adjacent file. This is entirely new, additive code
 * reusing the SAME `purchase_returns`/`purchase_return_items` tables (List
 * still works via the existing `GET /api/returns/purchases`, kept
 * unmodified for backward compatibility) plus the existing, unmodified
 * `deductPurchaseReturnStock` (via the new `returnStockPosting.ts` wrapper,
 * which additionally handles Warehouse/Godown/Rack stock that the legacy
 * function predates).
 *
 * Design decisions (the user was asked via AskUserQuestion; no response
 * was given, so the recommended defaults below were used — see
 * docs/SPRINT5E_PURCHASE_RETURN.md):
 *   - A completed return posts `supplier_ledger` type='purchase_return'
 *     (NEW, positive amount — reduces what's owed), NOT the existing
 *     'debit_note' (which increases what's owed, per Sprint 5D, and stays
 *     untouched for its own purpose).
 *   - No automatic cash refund — this only adjusts the running balance.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { postPurchaseReturnLine } from '../services/returnStockPosting';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Already-returned qty per purchase_item, counting only draft/completed returns (a cancelled one releases its claim). */
async function loadReturnedMap(db: any, dealerId: string, purchaseItemIds: string[]): Promise<Map<string, number>> {
  if (purchaseItemIds.length === 0) return new Map();
  const rows = await db('purchase_return_items as pri')
    .innerJoin('purchase_returns as pr', 'pr.id', 'pri.purchase_return_id')
    .where({ 'pri.dealer_id': dealerId })
    .whereIn('pri.source_purchase_item_id', purchaseItemIds)
    .whereIn('pr.status', ['draft', 'completed'])
    .groupBy('pri.source_purchase_item_id')
    .select('pri.source_purchase_item_id as purchase_item_id')
    .sum({ returned: 'pri.quantity' });
  return new Map(rows.map((r: any) => [r.purchase_item_id, Number(r.returned) || 0]));
}

// ── GET /api/purchase-returns/purchases/returnable ──────────────────────
router.get('/purchases/returnable', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const supplierId = (req.query.supplierId as string) || '';

    let q = db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where({ 'p.dealer_id': dealerId, 'p.document_status': 'posted' });
    if (supplierId) q = q.andWhere('p.supplier_id', supplierId);

    const rows = await q.select('p.id', 'p.invoice_number', 'p.purchase_date', 'p.supplier_id', 's.name as supplier_name');
    res.json({ rows });
  } catch (err: any) {
    console.error('[purchase-returns/returnable-purchases]', err.message);
    res.status(500).json({ error: 'Failed to list returnable purchases' });
  }
});

// ── GET /api/purchase-returns/purchase/:purchaseId/lines ─────────────────
router.get('/purchase/:purchaseId/lines', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const purchase = await db('purchases').where({ id: req.params.purchaseId, dealer_id: dealerId, document_status: 'posted' }).first();
    if (!purchase) {
      res.status(404).json({ error: 'Posted purchase not found' });
      return;
    }
    const items = await db('purchase_items as pi')
      .leftJoin('products as prod', 'prod.id', 'pi.product_id')
      .leftJoin('goods_receipt_items as gri', 'gri.id', 'pi.source_goods_receipt_item_id')
      .where({ 'pi.purchase_id': purchase.id, 'pi.dealer_id': dealerId })
      .select(
        'pi.id', 'pi.product_id', 'prod.name as product_name', 'prod.sku as product_sku',
        'pi.quantity', 'pi.purchase_rate',
        'gri.warehouse_id', 'gri.godown_id', 'gri.rack_id',
      );

    const returnedMap = await loadReturnedMap(db, dealerId, items.map((i: any) => i.id));
    const lines = items.map((i: any) => {
      const returned = returnedMap.get(i.id) ?? 0;
      return {
        purchase_item_id: i.id,
        product_id: i.product_id,
        product_name: i.product_name ?? i.product_sku ?? i.product_id,
        quantity: Number(i.quantity),
        purchase_rate: Number(i.purchase_rate),
        returned_qty: returned,
        returnable_qty: Math.max(0, Number(i.quantity) - returned),
        warehouse_id: i.warehouse_id,
        godown_id: i.godown_id,
        rack_id: i.rack_id,
      };
    });
    res.json({ purchase: { id: purchase.id, invoice_number: purchase.invoice_number, purchase_date: purchase.purchase_date, supplier_id: purchase.supplier_id }, lines });
  } catch (err: any) {
    console.error('[purchase-returns/purchase-lines]', err.message);
    res.status(500).json({ error: 'Failed to load purchase lines' });
  }
});

const itemSchema = z.object({
  purchase_item_id: z.string().uuid(),
  product_id: z.string().uuid(),
  return_qty: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0),
  reason: z.string().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  godown_id: z.string().uuid().nullable().optional(),
  rack_id: z.string().uuid().nullable().optional(),
});

const formSchema = z.object({
  supplier_id: z.string().uuid(),
  purchase_id: z.string().uuid().nullable().optional(),
  return_date: z.string().min(1),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

async function nextReturnNo(trx: any, dealerId: string): Promise<string> {
  // Mirrors the legacy PR-NNNN convention in returns.ts (count-based, not
  // re-implemented as date-scoped) so both creation paths share one visible
  // numbering space.
  const [row] = await trx('purchase_returns').where({ dealer_id: dealerId }).count('id as count');
  return `PR-${String(Number((row as any)?.count ?? 0) + 1).padStart(4, '0')}`;
}

async function validateAndInsertItems(trx: any, dealerId: string, purchaseReturnId: string, items: z.infer<typeof itemSchema>[]) {
  const returnedMap = await loadReturnedMap(trx, dealerId, items.map((i) => i.purchase_item_id));
  const purchaseItems = await trx('purchase_items').where({ dealer_id: dealerId }).whereIn('id', items.map((i) => i.purchase_item_id));
  const purchaseItemMap = new Map<string, any>(purchaseItems.map((p: any) => [p.id, p]));

  for (const item of items) {
    const purchaseItem = purchaseItemMap.get(item.purchase_item_id);
    if (!purchaseItem) {
      throw Object.assign(new Error('Purchase line not found for this dealer.'), { status: 400 });
    }
    const alreadyReturned = returnedMap.get(item.purchase_item_id) ?? 0;
    const wouldBe = alreadyReturned + item.return_qty;
    if (wouldBe > Number(purchaseItem.quantity) + 0.001) {
      throw Object.assign(
        new Error(`Cannot over-return: already returned ${alreadyReturned} of ${purchaseItem.quantity} purchased.`),
        { status: 409 },
      );
    }
  }

  const rows = items.map((it) => ({
    purchase_return_id: purchaseReturnId,
    dealer_id: dealerId,
    product_id: it.product_id,
    quantity: it.return_qty,
    unit_price: it.unit_price,
    total: round2(it.return_qty * it.unit_price),
    reason: it.reason || null,
    source_purchase_item_id: it.purchase_item_id,
    warehouse_id: it.warehouse_id || null,
    godown_id: it.godown_id || null,
    rack_id: it.rack_id || null,
  }));
  await trx('purchase_return_items').insert(rows);
}

// ── POST /api/purchase-returns ───────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, purchase_id, return_date, notes, items } = parsed.data;
    const userId = req.user?.userId ?? null;
    const totalAmount = round2(items.reduce((sum, it) => sum + it.return_qty * it.unit_price, 0));

    const row = await db.transaction(async (trx) => {
      const returnNo = await nextReturnNo(trx, dealerId);
      const [created] = await trx('purchase_returns')
        .insert({
          dealer_id: dealerId,
          supplier_id,
          purchase_id: purchase_id || null,
          return_no: returnNo,
          return_date,
          status: 'draft',
          total_amount: totalAmount,
          notes: notes || null,
          created_by: userId,
        })
        .returning('*');
      await validateAndInsertItems(trx, dealerId, created.id, items);
      return created;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[purchase-returns/create]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create purchase return' });
  }
});

// ── GET /api/purchase-returns/:id — details ──────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db('purchase_returns as pr')
      .leftJoin('suppliers as s', 's.id', 'pr.supplier_id')
      .leftJoin('purchases as p', 'p.id', 'pr.purchase_id')
      .where({ 'pr.id': req.params.id, 'pr.dealer_id': dealerId })
      .select('pr.*', 's.name as supplier_name', 'p.invoice_number as source_invoice_number')
      .first();
    if (!row) {
      res.status(404).json({ error: 'Purchase return not found' });
      return;
    }
    const items = await db('purchase_return_items as pri')
      .leftJoin('products as prod', 'prod.id', 'pri.product_id')
      .where({ 'pri.purchase_return_id': row.id, 'pri.dealer_id': dealerId })
      .select('pri.*', 'prod.name as product_name', 'prod.sku as product_sku');

    res.json({ row: { ...row, items } });
  } catch (err: any) {
    console.error('[purchase-returns/detail]', err.message);
    res.status(500).json({ error: 'Failed to load purchase return' });
  }
});

// ── PUT /api/purchase-returns/:id — edit (draft only) ────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, purchase_id, return_date, notes, items } = parsed.data;
    const totalAmount = round2(items.reduce((sum, it) => sum + it.return_qty * it.unit_price, 0));

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchase_returns').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw Object.assign(new Error('Only a draft purchase return can be edited.'), { status: 409 });
      }
      await trx('purchase_return_items').where({ purchase_return_id: existing.id, dealer_id: dealerId }).delete();

      const [updated] = await trx('purchase_returns')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({ supplier_id, purchase_id: purchase_id || null, return_date, notes: notes || null, total_amount: totalAmount })
        .returning('*');
      await validateAndInsertItems(trx, dealerId, updated.id, items);
      return updated;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase return not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-returns/update]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to update purchase return' });
  }
});

// ── DELETE /api/purchase-returns/:id — draft only ────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const deleted = await db.transaction(async (trx) => {
      const existing = await trx('purchase_returns').where({ id: req.params.id, dealer_id: dealerId, status: 'draft' }).first();
      if (!existing) return false;
      await trx('purchase_return_items').where({ purchase_return_id: existing.id, dealer_id: dealerId }).delete();
      await trx('purchase_returns').where({ id: existing.id }).delete();
      return true;
    });

    if (!deleted) {
      res.status(409).json({ error: 'Only a draft purchase return can be deleted.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[purchase-returns/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete purchase return' });
  }
});

// ── POST /api/purchase-returns/:id/complete ──────────────────────────────
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const result = await db.transaction(async (trx) => {
      const ret = await trx('purchase_returns').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!ret) return null;
      if (ret.status !== 'draft') {
        throw Object.assign(new Error('Only a draft purchase return can be completed.'), { status: 409 });
      }
      const items = await trx('purchase_return_items').where({ purchase_return_id: ret.id, dealer_id: dealerId });
      if (items.length === 0) {
        throw Object.assign(new Error('Cannot complete a purchase return with no items.'), { status: 409 });
      }

      // Re-validate over-return at completion time (race-condition guard,
      // mirroring Purchase Invoice's finalize-time re-check).
      const sourceIds = items.map((i: any) => i.source_purchase_item_id).filter(Boolean);
      if (sourceIds.length) {
        const returnedMap = await loadReturnedMap(trx, dealerId, sourceIds);
        const purchaseItems = await trx('purchase_items').whereIn('id', sourceIds);
        const purchaseItemMap = new Map(purchaseItems.map((p: any) => [p.id, p]));
        for (const item of items) {
          if (!item.source_purchase_item_id) continue;
          const purchaseItem = purchaseItemMap.get(item.source_purchase_item_id) as any;
          if (!purchaseItem) continue;
          const totalForLine = returnedMap.get(item.source_purchase_item_id) ?? 0;
          if (totalForLine > Number(purchaseItem.quantity) + 0.001) {
            throw Object.assign(new Error('This return now exceeds the purchased quantity for one or more lines — another return may have claimed the remainder.'), { status: 409 });
          }
        }
      }

      for (const item of items) {
        await postPurchaseReturnLine(trx, {
          dealerId,
          purchaseReturnId: ret.id,
          returnNo: ret.return_no,
          userId,
          line: {
            productId: item.product_id,
            quantity: Number(item.quantity),
            warehouseId: item.warehouse_id,
            godownId: item.godown_id,
            rackId: item.rack_id,
          },
        });
      }

      await trx('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id: ret.supplier_id,
        purchase_return_id: ret.id,
        type: 'purchase_return',
        amount: Number(ret.total_amount),
        description: `Purchase Return ${ret.return_no}`,
        entry_date: ret.return_date,
      });

      const [updated] = await trx('purchase_returns')
        .where({ id: ret.id })
        .update({ status: 'completed' })
        .returning('*');
      return updated;
    });

    if (!result) {
      res.status(404).json({ error: 'Purchase return not found' });
      return;
    }
    res.json({ row: result });
  } catch (err: any) {
    console.error('[purchase-returns/complete]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to complete purchase return' });
  }
});

// ── POST /api/purchase-returns/:id/cancel — draft only ───────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('purchase_returns')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .update({ status: 'cancelled' })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a draft purchase return can be cancelled.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-returns/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel purchase return' });
  }
});

export default router;
