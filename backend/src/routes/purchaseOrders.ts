/**
 * /api/purchase-orders — formal purchase orders (advance orders to suppliers).
 *
 *   GET    /            list (optional ?status=)
 *   POST   /            create with items
 *   GET    /:id         detail with items
 *   PATCH  /:id         update status / expected date / advance / notes
 *   POST   /:id/convert mark received + create a purchase draft from the items
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard, requireDealer } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard, requireDealer);

const READ_ROLES = ['dealer_admin', 'manager', 'accountant', 'salesman'] as const;
const WRITE_ROLES = ['dealer_admin', 'manager'] as const;

router.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = req.dealerId!;
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const base = db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where('po.dealer_id', dealerId)
      .select(
        'po.id', 'po.po_number', 'po.supplier_id', 'po.order_date',
        'po.expected_delivery_date', 'po.status', 'po.advance_paid',
        'po.total_amount', 'po.notes', 'po.converted_draft_id', 'po.created_at',
        's.name as supplier_name',
      )
      .orderBy('po.created_at', 'desc');
    if (status) base.andWhere('po.status', status);
    const rows = await base;

    type PoRow = { id: string } & Record<string, unknown>;
    const poRows = rows as PoRow[];
    const counts = (await db('purchase_order_items')
      .select('po_id')
      .count('* as count')
      .whereIn('po_id', poRows.map((r) => r.id))
      .groupBy('po_id')) as { po_id: string; count: string }[];
    const countMap = new Map(counts.map((c) => [c.po_id, Number(c.count)]));

    res.json({ rows: poRows.map((r) => ({ ...r, item_count: countMap.get(r.id) ?? 0 })) });
  } catch (err) {
    console.error('[purchase-orders/list]', (err as Error).message);
    res.status(500).json({ error: 'Failed to load purchase orders' });
  }
});

const itemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0),
});

const createSchema = z.object({
  supplier_id: z.string().uuid(),
  order_date: z.string().min(8).max(10),
  expected_delivery_date: z.string().min(8).max(10).optional().nullable(),
  advance_paid: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1).max(200),
});

router.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const dealerId = req.dealerId!;
  const data = parsed.data;
  const total = data.items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);

  try {
    const result = await db.transaction(async (trx) => {
      // Sequential per-dealer PO number with retry on the unique index.
      for (let attempt = 0; attempt < 3; attempt++) {
        const [{ count }] = await trx('purchase_orders')
          .where({ dealer_id: dealerId })
          .count<{ count: string }[]>('* as count');
        const poNumber = `PO-${String(Number(count) + 1 + attempt).padStart(4, '0')}`;
        try {
          const [po] = await trx('purchase_orders')
            .insert({
              dealer_id: dealerId,
              po_number: poNumber,
              supplier_id: data.supplier_id,
              order_date: data.order_date,
              expected_delivery_date: data.expected_delivery_date ?? null,
              status: 'ordered',
              advance_paid: data.advance_paid,
              total_amount: total,
              notes: data.notes ?? null,
              created_by: req.user?.userId ?? null,
            })
            .returning('*');
          await trx('purchase_order_items').insert(
            data.items.map((it) => ({
              po_id: po.id,
              product_id: it.product_id,
              quantity: it.quantity,
              unit_price: it.unit_price,
              total: it.quantity * it.unit_price,
            })),
          );
          return po;
        } catch (err) {
          if ((err as { code?: string })?.code === '23505' && attempt < 2) continue;
          throw err;
        }
      }
      throw new Error('Could not allocate PO number');
    });
    res.status(201).json({ row: result });
  } catch (err) {
    console.error('[purchase-orders/create]', (err as Error).message);
    res.status(500).json({ error: 'Failed to create purchase order' });
  }
});

router.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  try {
    const po = await db('purchase_orders as po')
      .leftJoin('suppliers as s', 's.id', 'po.supplier_id')
      .where({ 'po.id': req.params.id, 'po.dealer_id': req.dealerId! })
      .select('po.*', 's.name as supplier_name')
      .first();
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    const items = await db('purchase_order_items as i')
      .leftJoin('products as p', 'p.id', 'i.product_id')
      .where('i.po_id', po.id)
      .select('i.id', 'i.product_id', 'i.quantity', 'i.unit_price', 'i.total', 'p.name as product_name');
    res.json({ row: { ...po, items } });
  } catch (err) {
    console.error('[purchase-orders/get]', (err as Error).message);
    res.status(500).json({ error: 'Failed to load purchase order' });
  }
});

const patchSchema = z.object({
  status: z.enum(['ordered', 'received', 'cancelled']).optional(),
  expected_delivery_date: z.string().min(8).max(10).nullable().optional(),
  advance_paid: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

router.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date() };
    const [row] = await db('purchase_orders')
      .where({ id: req.params.id, dealer_id: req.dealerId! })
      .update(updates)
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    res.json({ row });
  } catch (err) {
    console.error('[purchase-orders/patch]', (err as Error).message);
    res.status(500).json({ error: 'Failed to update purchase order' });
  }
});

/**
 * Convert: mark the PO received and create a purchase DRAFT carrying its
 * items, so the owner completes it in Purchase Entry (payment, warehouse,
 * stock posting) through the existing flow.
 */
router.post('/:id/convert', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = req.dealerId!;
    const po = await db('purchase_orders')
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();
    if (!po) {
      res.status(404).json({ error: 'Purchase order not found' });
      return;
    }
    if (po.status === 'cancelled') {
      res.status(400).json({ error: 'Cannot convert a cancelled purchase order' });
      return;
    }
    if (po.converted_draft_id) {
      res.json({ draft_id: po.converted_draft_id, already: true });
      return;
    }
    const items = await db('purchase_order_items').where({ po_id: po.id });

    const payload = {
      supplier_id: po.supplier_id,
      invoice_number: '',
      purchase_date: new Date().toISOString().split('T')[0],
      notes: `From ${po.po_number}`,
      voucher_discount: 0,
      paid_on_create: Number(po.advance_paid) || 0,
      paid_account_id: null,
      items: items.map((it: { product_id: string; quantity: unknown; unit_price: unknown }) => ({
        product_id: it.product_id,
        quantity: Number(it.quantity),
        purchase_rate: Number(it.unit_price),
        offer_price: 0,
        transport_cost: 0,
        labor_cost: 0,
        other_cost: 0,
      })),
    };

    const draftId = await db.transaction(async (trx) => {
      const [draft] = await trx('purchase_drafts')
        .insert({
          dealer_id: dealerId,
          created_by: req.user?.userId ?? null,
          label: `PO ${po.po_number}`,
          payload,
        })
        .returning('id');
      const id = typeof draft === 'object' ? draft.id : draft;
      await trx('purchase_orders')
        .where({ id: po.id })
        .update({ status: 'received', converted_draft_id: id, updated_at: new Date() });
      return id;
    });

    res.json({ draft_id: draftId, already: false });
  } catch (err) {
    console.error('[purchase-orders/convert]', (err as Error).message);
    res.status(500).json({ error: 'Failed to convert purchase order' });
  }
});

export default router;
