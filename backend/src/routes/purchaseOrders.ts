/**
 * Purchase Order routes — V2 Sprint 5B (Purchase Order).
 *
 *   GET    /api/purchase-orders?dealerId=&search=&status=&supplierId=&page=
 *   GET    /api/purchase-orders/last-purchase-rate?dealerId=&supplierId=&productId=
 *   GET    /api/purchase-orders/:id                    (items + approval history)
 *   POST   /api/purchase-orders                        (create draft + items)
 *   PUT    /api/purchase-orders/:id                     (edit — draft only, replaces items)
 *   DELETE /api/purchase-orders/:id                     (draft only)
 *   POST   /api/purchase-orders/:id/clone               (clone → new draft PO)
 *   POST   /api/purchase-orders/:id/submit              (draft → pending_approval, assigns po_number)
 *   POST   /api/purchase-orders/:id/approve             (dealer_admin; pending_approval → approved)
 *   POST   /api/purchase-orders/:id/reject              (dealer_admin; pending_approval → draft)
 *   POST   /api/purchase-orders/:id/send                (approved → sent)
 *   POST   /api/purchase-orders/:id/mark-partially-received  (administrative status only — no stock effect)
 *   POST   /api/purchase-orders/:id/mark-fully-received      (administrative status only — no stock effect)
 *   POST   /api/purchase-orders/:id/close               (sent/partially_received/fully_received → closed)
 *   POST   /api/purchase-orders/:id/cancel              (draft/pending_approval/approved/sent → cancelled)
 *   POST   /api/purchase-orders/from-rfq/:rfqId         (RFQ → PO conversion; one PO per distinct selected supplier)
 *   POST   /api/purchase-orders/:id/email               (send a text/HTML summary to the supplier's email)
 *
 * A genuinely new entity — no Purchase Order concept existed before this
 * sprint (the existing `purchases` table is the GRN+Invoice-equivalent: it
 * deducts/adds stock and posts ledger entries immediately on create). This
 * file NEVER touches `stock`, `product_batches`, `supplier_ledger`, or any
 * posting table — Goods Receipt, Batch Receiving, Purchase Invoice, Supplier
 * Payment, Landed Cost, and Accounting Posting are all explicitly out of
 * scope. `mark-partially-received`/`mark-fully-received` are administrative
 * status markers only, matching the precedent `sales_orders.delivery_readiness`
 * set in migration 090 before Delivery execution existed.
 *
 * Reject models the "8 statuses don't include Rejected" ambiguity in the
 * sprint brief as: reject sends a pending_approval PO back to 'draft' for
 * revision (recorded in `purchase_order_approvals`), not a 9th status.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { sendEmail } from '../services/notificationService';

const router = Router();
router.use(authenticate, tenantGuard);

const PAGE_SIZE = 25;

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

async function recordHistory(
  trx: any,
  dealerId: string,
  purchaseOrderId: string,
  action: 'submitted' | 'approved' | 'rejected' | 'sent' | 'cancelled' | 'closed',
  actorId: string | null,
  note: string | null,
) {
  await trx('purchase_order_approvals').insert({
    dealer_id: dealerId,
    purchase_order_id: purchaseOrderId,
    action,
    actor_id: actorId,
    note: note || null,
  });
}

const itemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name_snapshot: z.string().min(1),
  product_sku_snapshot: z.string().nullable().optional(),
  unit_type: z.enum(['box_sft', 'piece']).optional().nullable(),
  per_box_sft: z.number().nullable().optional(),
  ordered_qty: z.coerce.number().positive(),
  rate: z.coerce.number().min(0),
  rate_unit: z.enum(['per_piece', 'per_box', 'per_sqft']).optional().nullable(),
  notes: z.string().nullable().optional(),
});

const formSchema = z.object({
  supplier_id: z.string().uuid(),
  order_date: z.string().min(1),
  expected_delivery_date: z.string().nullable().optional(),
  discount_type: z.enum(['flat', 'percent']).default('flat'),
  discount_value: z.coerce.number().min(0).default(0),
  notes: z.string().nullable().optional(),
  terms_text: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

type ItemIn = z.infer<typeof formSchema>['items'][number];

function calcLineTotal(it: ItemIn): number {
  return it.ordered_qty * it.rate;
}

function calcTotals(items: ItemIn[], discountType: 'flat' | 'percent', discountValue: number) {
  const subtotal = items.reduce((sum, it) => sum + calcLineTotal(it), 0);
  const discount = discountType === 'percent' ? subtotal * (discountValue / 100) : discountValue;
  const total = Math.max(0, subtotal - discount);
  return { subtotal: Math.round(subtotal * 100) / 100, total: Math.round(total * 100) / 100 };
}

async function insertItems(trx: any, dealerId: string, purchaseOrderId: string, items: ItemIn[]) {
  const rows = items.map((it, idx) => ({
    dealer_id: dealerId,
    purchase_order_id: purchaseOrderId,
    product_id: it.product_id || null,
    product_name_snapshot: it.product_name_snapshot,
    product_sku_snapshot: it.product_sku_snapshot || null,
    unit_type: it.unit_type || null,
    per_box_sft: it.per_box_sft ?? null,
    ordered_qty: it.ordered_qty,
    rate: it.rate,
    rate_unit: it.rate_unit || null,
    line_total: calcLineTotal(it),
    notes: it.notes || null,
    sort_order: idx,
  }));
  await trx('purchase_order_items').insert(rows);
}

// ── GET /api/purchase-orders ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const search = ((req.query.search as string) || '').trim();
    const status = (req.query.status as string) || '';
    const supplierId = (req.query.supplierId as string) || '';

    let q = db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where('po.dealer_id', dealerId);
    if (status) q = q.andWhere('po.status', status);
    if (supplierId) q = q.andWhere('po.supplier_id', supplierId);
    if (search) {
      q = q.andWhere((b) => b.whereILike('po.po_number', `%${search}%`).orWhereILike('s.name', `%${search}%`));
    }

    const countQ = q.clone().clearSelect().clearOrder().count<{ count: string }[]>('po.id as count');
    const rowsQ = q
      .clone()
      .select('po.*', 's.name as supplier_name')
      .orderBy('po.created_at', 'desc')
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const [countRow] = await countQ;
    const rows = await rowsQ;
    res.json({ rows, total: Number(countRow?.count ?? 0) });
  } catch (err: any) {
    console.error('[purchase-orders/list]', err.message);
    res.status(500).json({ error: 'Failed to list purchase orders' });
  }
});

// ── GET /api/purchase-orders/last-purchase-rate — Supplier Integration ──
// Adapts the same DISTINCT ON pattern autoPo.ts uses for its suggestions,
// scoped to a single (supplier, product) pair instead of "last supplier for
// every low-stock product." Read-only; does not modify autoPo.ts.
router.get('/last-purchase-rate', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const supplierId = req.query.supplierId as string;
    const productId = req.query.productId as string;
    if (!supplierId || !productId) {
      res.status(400).json({ error: 'supplierId and productId are required' });
      return;
    }

    const row = await db('purchase_items as pi')
      .innerJoin('purchases as pu', 'pu.id', 'pi.purchase_id')
      .where({ 'pi.dealer_id': dealerId, 'pu.supplier_id': supplierId, 'pi.product_id': productId })
      .orderBy('pu.purchase_date', 'desc')
      .orderBy('pu.created_at', 'desc')
      .first('pi.purchase_rate as last_rate', 'pu.purchase_date as last_purchase_date');

    res.json({
      last_purchase_rate: row ? Number(row.last_rate) : null,
      last_purchase_date: row ? row.last_purchase_date : null,
    });
  } catch (err: any) {
    console.error('[purchase-orders/last-purchase-rate]', err.message);
    res.status(500).json({ error: 'Failed to load last purchase rate' });
  }
});

// ── GET /api/purchase-orders/:id ─────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const po = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'po.id': req.params.id, 'po.dealer_id': dealerId })
      .select('po.*', 's.name as supplier_name', 's.phone as supplier_phone', 's.email as supplier_email')
      .first();
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    const items = await db('purchase_order_items')
      .where({ dealer_id: dealerId, purchase_order_id: req.params.id })
      .orderBy('sort_order', 'asc');
    const history = await db('purchase_order_approvals')
      .where({ dealer_id: dealerId, purchase_order_id: req.params.id })
      .orderBy('created_at', 'desc');
    res.json({ ...po, items, approval_history: history });
  } catch (err: any) {
    console.error('[purchase-orders/get]', err.message);
    res.status(500).json({ error: 'Failed to load purchase order' });
  }
});

// ── POST /api/purchase-orders ────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, order_date, expected_delivery_date, discount_type, discount_value, notes, terms_text, items } = parsed.data;
    const createdBy = req.user?.userId ?? null;
    const { subtotal, total } = calcTotals(items, discount_type, discount_value);

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .insert({
          dealer_id: dealerId,
          supplier_id,
          order_date,
          expected_delivery_date: expected_delivery_date || null,
          discount_type,
          discount_value,
          subtotal,
          total_amount: total,
          notes: notes || null,
          terms_text: terms_text || null,
          created_by: createdBy,
        })
        .returning('*');
      await insertItems(trx, dealerId, po.id, items);
      return po;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/create]', err.message);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

// ── PUT /api/purchase-orders/:id — edit (draft only) ─────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, order_date, expected_delivery_date, discount_type, discount_value, notes, terms_text, items } = parsed.data;
    const { subtotal, total } = calcTotals(items, discount_type, discount_value);

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchase_orders').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only a draft purchase order can be edited.');
      }

      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({
          supplier_id, order_date, expected_delivery_date: expected_delivery_date || null,
          discount_type, discount_value, subtotal, total_amount: total,
          notes: notes || null, terms_text: terms_text || null, updated_at: new Date(),
        })
        .returning('*');

      await trx('purchase_order_items').where({ purchase_order_id: po.id, dealer_id: dealerId }).delete();
      await insertItems(trx, dealerId, po.id, items);
      return po;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/update]', err.message);
    res.status(err.message?.includes('draft') ? 409 : 500).json({ error: err.message || 'Failed to update purchase order' });
  }
});

// ── DELETE /api/purchase-orders/:id — draft only ─────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const deleted = await db('purchase_orders')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .delete();
    if (!deleted) {
      res.status(409).json({ error: 'Only a draft purchase order can be deleted.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[purchase-orders/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/clone ──────────────────────────────────
router.post('/:id/clone', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const createdBy = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const source = await trx('purchase_orders').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!source) return null;
      const sourceItems = await trx('purchase_order_items').where({ purchase_order_id: source.id, dealer_id: dealerId });

      const [clone] = await trx('purchase_orders')
        .insert({
          dealer_id: dealerId,
          supplier_id: source.supplier_id,
          order_date: new Date().toISOString().slice(0, 10),
          expected_delivery_date: null,
          discount_type: source.discount_type,
          discount_value: source.discount_value,
          subtotal: source.subtotal,
          total_amount: source.total_amount,
          notes: source.notes,
          terms_text: source.terms_text,
          cloned_from_id: source.id,
          created_by: createdBy,
        })
        .returning('*');

      if (sourceItems.length) {
        await trx('purchase_order_items').insert(
          sourceItems.map((it: any, idx: number) => ({
            dealer_id: dealerId,
            purchase_order_id: clone.id,
            product_id: it.product_id,
            product_name_snapshot: it.product_name_snapshot,
            product_sku_snapshot: it.product_sku_snapshot,
            unit_type: it.unit_type,
            per_box_sft: it.per_box_sft,
            ordered_qty: it.ordered_qty,
            rate: it.rate,
            rate_unit: it.rate_unit,
            line_total: it.line_total,
            notes: it.notes,
            sort_order: idx,
          })),
        );
      }
      return clone;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/clone]', err.message);
    res.status(500).json({ error: 'Failed to clone purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/submit — draft → pending_approval ─────
router.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchase_orders').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only a draft purchase order can be submitted for approval.');
      }
      const itemCount = await trx('purchase_order_items')
        .where({ purchase_order_id: existing.id, dealer_id: dealerId })
        .count<{ count: string }[]>('* as count');
      if (Number(itemCount[0]?.count ?? 0) === 0) {
        throw new Error('Cannot submit a purchase order with no items.');
      }

      const numResult = await trx.raw('SELECT generate_next_purchase_order_no(?::uuid) AS no', [dealerId]);
      const poNumber = String(numResult.rows?.[0]?.no ?? '');
      const now = new Date();

      const [po] = await trx('purchase_orders')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({ status: 'pending_approval', po_number: poNumber, submitted_by: actorId, submitted_at: now, updated_at: now })
        .returning('*');
      await recordHistory(trx, dealerId, po.id, 'submitted', actorId, null);
      return po;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/submit]', err.message);
    res.status(err.message?.includes('draft') || err.message?.includes('no items') ? 409 : 500)
      .json({ error: err.message || 'Failed to submit purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/approve — dealer_admin only ───────────
const noteSchema = z.object({ note: z.string().trim().max(1000).optional().nullable() });

router.post('/:id/approve', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = noteSchema.safeParse(req.body ?? {});
    const note = parsed.success ? parsed.data.note ?? null : null;
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId, status: 'pending_approval' })
        .update({ status: 'approved', approved_by: actorId, approved_at: new Date(), updated_at: new Date() })
        .returning('*');
      if (po) await recordHistory(trx, dealerId, po.id, 'approved', actorId, note);
      return po;
    });

    if (!row) {
      res.status(409).json({ error: 'Only a pending-approval purchase order can be approved.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/approve]', err.message);
    res.status(500).json({ error: 'Failed to approve purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/reject — dealer_admin only ────────────
// Sends the PO back to 'draft' (see file header note) — not a 9th status.
const rejectSchema = z.object({ reason: z.string().trim().min(1, 'A rejection reason is required').max(1000) });

router.post('/:id/reject', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId, status: 'pending_approval' })
        .update({ status: 'draft', po_number: null, submitted_by: null, submitted_at: null, updated_at: new Date() })
        .returning('*');
      if (po) await recordHistory(trx, dealerId, po.id, 'rejected', actorId, parsed.data.reason);
      return po;
    });

    if (!row) {
      res.status(409).json({ error: 'Only a pending-approval purchase order can be rejected.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/reject]', err.message);
    res.status(500).json({ error: 'Failed to reject purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/send — approved → sent ────────────────
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId, status: 'approved' })
        .update({ status: 'sent', sent_by: actorId, sent_at: new Date(), updated_at: new Date() })
        .returning('*');
      if (po) await recordHistory(trx, dealerId, po.id, 'sent', actorId, null);
      return po;
    });

    if (!row) {
      res.status(409).json({ error: 'Only an approved purchase order can be marked as sent.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/send]', err.message);
    res.status(500).json({ error: 'Failed to mark purchase order as sent' });
  }
});

// ── POST /api/purchase-orders/:id/mark-partially-received ───────────────
// Administrative status marker only — no stock/batch effect (Goods Receipt
// is explicitly out of scope for this sprint).
router.post('/:id/mark-partially-received', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('purchase_orders')
      .where({ id: req.params.id, dealer_id: dealerId })
      .whereIn('status', ['sent', 'partially_received'])
      .update({ status: 'partially_received', updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a sent purchase order can be marked as partially received.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/mark-partially-received]', err.message);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/mark-fully-received ────────────────────
router.post('/:id/mark-fully-received', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('purchase_orders')
      .where({ id: req.params.id, dealer_id: dealerId })
      .whereIn('status', ['sent', 'partially_received'])
      .update({ status: 'fully_received', updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a sent or partially-received purchase order can be marked as fully received.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/mark-fully-received]', err.message);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/close ──────────────────────────────────
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId })
        .whereIn('status', ['sent', 'partially_received', 'fully_received'])
        .update({ status: 'closed', closed_by: actorId, closed_at: new Date(), updated_at: new Date() })
        .returning('*');
      if (po) await recordHistory(trx, dealerId, po.id, 'closed', actorId, null);
      return po;
    });

    if (!row) {
      res.status(409).json({ error: 'Purchase order cannot be closed in its current state.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/close]', err.message);
    res.status(500).json({ error: 'Failed to close purchase order' });
  }
});

// ── POST /api/purchase-orders/:id/cancel ─────────────────────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = rejectSchema.partial().safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason ?? null : null;
    const actorId = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [po] = await trx('purchase_orders')
        .where({ id: req.params.id, dealer_id: dealerId })
        .whereIn('status', ['draft', 'pending_approval', 'approved', 'sent'])
        .update({ status: 'cancelled', cancelled_by: actorId, cancelled_at: new Date(), cancel_reason: reason, updated_at: new Date() })
        .returning('*');
      if (po) await recordHistory(trx, dealerId, po.id, 'cancelled', actorId, reason);
      return po;
    });

    if (!row) {
      res.status(409).json({ error: 'Purchase order cannot be cancelled in its current state.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-orders/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel purchase order' });
  }
});

// ── POST /api/purchase-orders/from-rfq/:rfqId — RFQ → PO conversion ─────
// A PO is single-supplier (matches `purchases.supplier_id`), but an RFQ's
// selected suppliers can differ per line — so this creates ONE PO PER
// DISTINCT selected supplier, each carrying only its own lines at the
// quoted rate. Preserves the RFQ's comparison history and audit trail via
// `source_rfq_id` / `source_rfq_item_id` — never mutates the RFQ itself.
router.post('/from-rfq/:rfqId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const createdBy = req.user?.userId ?? null;

    const rows = await db.transaction(async (trx) => {
      const rfq = await trx('rfqs').where({ id: req.params.rfqId, dealer_id: dealerId }).first();
      if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 });
      if (rfq.status !== 'approved') {
        throw Object.assign(new Error('Only an approved RFQ can be converted to a Purchase Order.'), { status: 409 });
      }

      const items = await trx('rfq_items')
        .where({ rfq_id: rfq.id, dealer_id: dealerId })
        .whereNotNull('selected_supplier_id');
      if (items.length === 0) {
        throw Object.assign(new Error('This RFQ has no line with a selected supplier.'), { status: 409 });
      }

      const itemIds = items.map((i: any) => i.id);
      const responses = await trx('rfq_responses')
        .where({ rfq_id: rfq.id, dealer_id: dealerId })
        .whereIn('rfq_item_id', itemIds);
      const responseMap = new Map(responses.map((r: any) => [`${r.rfq_item_id}:${r.supplier_id}`, r]));

      const bySupplier = new Map<string, any[]>();
      for (const item of items) {
        const arr = bySupplier.get(item.selected_supplier_id) || [];
        arr.push(item);
        bySupplier.set(item.selected_supplier_id, arr);
      }

      const created: any[] = [];
      for (const [supplierId, supplierItems] of bySupplier) {
        const lineItems: ItemIn[] = supplierItems.map((it: any) => {
          const resp = responseMap.get(`${it.id}:${supplierId}`);
          return {
            product_id: it.product_id,
            product_name_snapshot: it.product_name_snapshot,
            ordered_qty: Number(it.qty),
            rate: resp ? Number(resp.quoted_rate) : 0,
          } as ItemIn;
        });
        const { subtotal, total } = calcTotals(lineItems, 'flat', 0);

        const [po] = await trx('purchase_orders')
          .insert({
            dealer_id: dealerId,
            supplier_id: supplierId,
            order_date: new Date().toISOString().slice(0, 10),
            discount_type: 'flat',
            discount_value: 0,
            subtotal,
            total_amount: total,
            notes: rfq.notes,
            source_rfq_id: rfq.id,
            source_purchase_request_id: rfq.purchase_request_id,
            created_by: createdBy,
          })
          .returning('*');

        const itemRows = supplierItems.map((it: any, idx: number) => {
          const resp = responseMap.get(`${it.id}:${supplierId}`);
          return {
            dealer_id: dealerId,
            purchase_order_id: po.id,
            product_id: it.product_id,
            product_name_snapshot: it.product_name_snapshot,
            ordered_qty: it.qty,
            rate: resp ? resp.quoted_rate : 0,
            line_total: resp ? Number(it.qty) * Number(resp.quoted_rate) : 0,
            source_rfq_item_id: it.id,
            sort_order: idx,
          };
        });
        await trx('purchase_order_items').insert(itemRows);
        created.push(po);
      }
      return created;
    });

    res.status(201).json({ rows });
  } catch (err: any) {
    console.error('[purchase-orders/from-rfq]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to convert RFQ to purchase order(s)' });
  }
});

// ── POST /api/purchase-orders/:id/email — text/HTML summary to the supplier
// Reuses the existing dealer-aware SMTP transport (notificationService.sendEmail).
// No file attachment — that infrastructure does not exist anywhere in this
// codebase today (see Sprint 5B inspection notes); this sends the same kind
// of formatted summary body every other email-based notification here sends.
const emailSchema = z.object({
  to: z.string().trim().email().optional(),
});

router.post('/:id/email', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = emailSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const po = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'po.id': req.params.id, 'po.dealer_id': dealerId })
      .select('po.*', 's.name as supplier_name', 's.email as supplier_email')
      .first();
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    const to = parsed.data.to || po.supplier_email;
    if (!to) {
      res.status(400).json({ error: 'No email address available for this supplier — provide one explicitly.' });
      return;
    }

    const items = await db('purchase_order_items')
      .where({ dealer_id: dealerId, purchase_order_id: po.id })
      .orderBy('sort_order', 'asc');

    const rowsHtml = items
      .map((it: any) => `<tr><td>${it.product_name_snapshot}</td><td style="text-align:right">${Number(it.ordered_qty)}</td><td style="text-align:right">${Number(it.rate).toFixed(2)}</td><td style="text-align:right">${Number(it.line_total).toFixed(2)}</td></tr>`)
      .join('');
    const html = `<p>Dear ${po.supplier_name || 'Supplier'},</p><p>Please find our purchase order details below.</p>
      <p><b>PO Number:</b> ${po.po_number ?? 'Draft'}<br/><b>Order Date:</b> ${po.order_date}</p>
      <table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <p><b>Total Amount: ${Number(po.total_amount).toFixed(2)}</b></p>
      ${po.notes ? `<p>Notes: ${po.notes}</p>` : ''}`;
    const text = `Purchase Order ${po.po_number ?? 'Draft'} — Total: ${Number(po.total_amount).toFixed(2)}. ${items.length} item(s).`;

    const sent = await sendEmail({
      to,
      subject: `Purchase Order ${po.po_number ?? ''} from your dealer`,
      text,
      html,
      dealerId,
    });

    if (!sent) {
      res.status(502).json({ error: 'Email could not be sent — check SMTP settings for this dealer.' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[purchase-orders/email]', err.message);
    res.status(500).json({ error: 'Failed to email purchase order' });
  }
});

export default router;
