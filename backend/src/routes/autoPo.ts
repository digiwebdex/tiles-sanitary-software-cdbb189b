/**
 * Auto-PO Draft routes.
 *
 *   GET    /api/auto-po/suggestions?dealerId=
 *     -> grouped by last supplier from purchase history
 *
 *   GET    /api/auto-po/drafts?dealerId=&status=draft
 *   GET    /api/auto-po/drafts/:id?dealerId=
 *   POST   /api/auto-po/drafts                     body: { dealerId, supplier_id, notes, items: [{product_id, suggested_qty, suggested_rate}] }
 *   POST   /api/auto-po/drafts/generate-all        body: { dealerId } — bulk create draft per supplier from current shortages
 *   PATCH  /api/auto-po/drafts/:id                 body: { dealerId, items?, notes?, supplier_id? }
 *   POST   /api/auto-po/drafts/:id/discard         body: { dealerId }
 *   POST   /api/auto-po/drafts/:id/mark-converted  body: { dealerId, purchase_id }
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage auto-PO drafts' });
    return false;
  }
  return true;
}

/**
 * Suggestions: products with available stock <= reorder_level (where reorder_level > 0),
 * grouped by the last supplier seen on that product's most recent purchase_items row.
 * Suggested qty = max(reorder_level * 2 - available, reorder_level). Suggested rate = last purchase rate or product.cost_price.
 */
router.get('/suggestions', async (req, res) => {
  try {
    // Admin-only: suggestions expose cost-derived purchase rates
    // (last purchase rate / product.cost_price), which are stripped from
    // salesman-facing product endpoints. Gate here to preserve that.
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const lowStock: any[] = await db('products as p')
      .leftJoin('stock as s', function() {
        this.on('s.product_id', '=', 'p.id').andOn('s.dealer_id', '=', 'p.dealer_id');
      })
      .where('p.dealer_id', dealerId)
      .where('p.active', true)
      .where('p.reorder_level', '>', 0)
      .select(
        'p.id', 'p.name', 'p.sku', 'p.brand', 'p.unit_type', 'p.reorder_level', 'p.cost_price',
        db.raw('COALESCE(s.box_qty, 0) as box_qty'),
        db.raw('COALESCE(s.piece_qty, 0) as piece_qty'),
        db.raw('COALESCE(s.reserved_box_qty, 0) as reserved_box_qty'),
        db.raw('COALESCE(s.reserved_piece_qty, 0) as reserved_piece_qty'),
      );

    const filtered = lowStock.filter((p) => {
      const onHand = p.unit_type === 'piece'
        ? Number(p.piece_qty) - Number(p.reserved_piece_qty)
        : Number(p.box_qty) - Number(p.reserved_box_qty);
      return onHand <= Number(p.reorder_level);
    });

    if (filtered.length === 0) {
      return res.json({ groups: [], unassigned: [] });
    }

    const productIds = filtered.map((p) => p.id);

    // Last supplier per product (from most recent purchase_items via purchases.purchase_date desc)
    const lastSupplierRows = await db.raw(`
      SELECT DISTINCT ON (pi.product_id)
        pi.product_id, pu.supplier_id, pi.purchase_rate, sup.name as supplier_name
      FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id
      LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
      WHERE pi.dealer_id = ? AND pi.product_id = ANY(?)
      ORDER BY pi.product_id, pu.purchase_date DESC, pu.created_at DESC
    `, [dealerId, productIds]);

    const supplierMap = new Map<string, { supplier_id: string | null; supplier_name: string | null; last_rate: number }>();
    for (const r of lastSupplierRows.rows) {
      supplierMap.set(r.product_id, {
        supplier_id: r.supplier_id ?? null,
        supplier_name: r.supplier_name ?? null,
        last_rate: Number(r.purchase_rate) || 0,
      });
    }

    const groups = new Map<string, any>();
    const unassigned: any[] = [];

    for (const p of filtered) {
      const sup = supplierMap.get(p.id);
      const onHand = p.unit_type === 'piece'
        ? Number(p.piece_qty) - Number(p.reserved_piece_qty)
        : Number(p.box_qty) - Number(p.reserved_box_qty);
      const target = Number(p.reorder_level) * 2;
      const suggested = Math.max(target - onHand, Number(p.reorder_level));
      const item = {
        product_id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit_type: p.unit_type,
        reorder_level: Number(p.reorder_level), on_hand: onHand,
        suggested_qty: Math.ceil(suggested),
        suggested_rate: sup?.last_rate || Number(p.cost_price) || 0,
      };
      if (!sup || !sup.supplier_id) {
        unassigned.push(item);
        continue;
      }
      const key = sup.supplier_id;
      if (!groups.has(key)) {
        groups.set(key, { supplier_id: key, supplier_name: sup.supplier_name, items: [] });
      }
      groups.get(key).items.push(item);
    }

    res.json({ groups: Array.from(groups.values()), unassigned });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/drafts', async (req, res) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const status = (req.query.status as string) || undefined;
    let q = db('purchase_drafts as d')
      .leftJoin('suppliers as s', 's.id', 'd.supplier_id')
      .where('d.dealer_id', dealerId)
      .select('d.*', 's.name as supplier_name', 's.phone as supplier_phone')
      .orderBy('d.created_at', 'desc');
    if (status) q = q.where('d.status', status);
    const drafts = await q;
    const ids = drafts.map((d) => d.id);
    let counts: Record<string, number> = {};
    let totals: Record<string, number> = {};
    if (ids.length) {
      const rows = (await db('purchase_draft_items')
        .whereIn('draft_id', ids)
        .where('dealer_id', dealerId)
        .select('draft_id')
        .count('* as count')
        .sum({ sum: db.raw('suggested_qty * suggested_rate') })
        .groupBy('draft_id')) as unknown as Array<{ draft_id: string; count: string; sum: string }>;
      for (const r of rows) {
        counts[r.draft_id] = Number(r.count) || 0;
        totals[r.draft_id] = Number(r.sum) || 0;
      }
    }
    res.json(drafts.map((d) => ({ ...d, item_count: counts[d.id] || 0, total_amount: totals[d.id] || 0 })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/drafts/:id', async (req, res) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const draft = await db('purchase_drafts as d')
      .leftJoin('suppliers as s', 's.id', 'd.supplier_id')
      .where('d.id', req.params.id)
      .where('d.dealer_id', dealerId)
      .first('d.*', 's.name as supplier_name', 's.phone as supplier_phone', 's.email as supplier_email', 's.address as supplier_address');
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    const items = await db('purchase_draft_items as i')
      .leftJoin('products as p', 'p.id', 'i.product_id')
      .where('i.draft_id', draft.id)
      .where('i.dealer_id', dealerId)
      .select('i.*', 'p.name as product_name', 'p.sku as product_sku', 'p.unit_type', 'p.brand');
    res.json({ ...draft, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const createSchema = z.object({
  dealerId: z.string().uuid(),
  supplier_id: z.string().uuid(),
  notes: z.string().optional().nullable(),
  source: z.enum(['auto_low_stock', 'manual']).default('manual'),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    suggested_qty: z.coerce.number().nonnegative(),
    suggested_rate: z.coerce.number().nonnegative(),
  })).min(1),
});

router.post('/drafts', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { supplier_id, notes, items, source } = parsed.data;
    const userId = (req.user as any)?.id || null;
    const draft = await db.transaction(async (trx) => {
      const [d] = await trx('purchase_drafts').insert({
        dealer_id: dealerId, supplier_id, notes: notes ?? null, source, created_by: userId,
      }).returning('*');
      const rows = items.map((it) => ({
        draft_id: d.id, dealer_id: dealerId,
        product_id: it.product_id, suggested_qty: it.suggested_qty, suggested_rate: it.suggested_rate,
      }));
      await trx('purchase_draft_items').insert(rows);
      return d;
    });
    res.json(draft);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/drafts/generate-all', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    // Re-fetch suggestions inline
    const lowStock: any[] = await db('products as p')
      .leftJoin('stock as s', function() {
        this.on('s.product_id', '=', 'p.id').andOn('s.dealer_id', '=', 'p.dealer_id');
      })
      .where('p.dealer_id', dealerId).where('p.active', true).where('p.reorder_level', '>', 0)
      .select('p.id', 'p.unit_type', 'p.reorder_level', 'p.cost_price',
        db.raw('COALESCE(s.box_qty, 0) as box_qty'),
        db.raw('COALESCE(s.piece_qty, 0) as piece_qty'),
        db.raw('COALESCE(s.reserved_box_qty, 0) as reserved_box_qty'),
        db.raw('COALESCE(s.reserved_piece_qty, 0) as reserved_piece_qty'));
    const filtered = lowStock.filter((p) => {
      const onHand = p.unit_type === 'piece'
        ? Number(p.piece_qty) - Number(p.reserved_piece_qty)
        : Number(p.box_qty) - Number(p.reserved_box_qty);
      return onHand <= Number(p.reorder_level);
    });
    if (filtered.length === 0) return res.json({ created: 0, drafts: [] });
    const productIds = filtered.map((p) => p.id);
    const lastSupplierRows = await db.raw(`
      SELECT DISTINCT ON (pi.product_id) pi.product_id, pu.supplier_id, pi.purchase_rate
      FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pi.dealer_id = ? AND pi.product_id = ANY(?)
      ORDER BY pi.product_id, pu.purchase_date DESC, pu.created_at DESC
    `, [dealerId, productIds]);
    const supMap = new Map<string, { supplier_id: string; last_rate: number }>();
    for (const r of lastSupplierRows.rows) {
      if (r.supplier_id) supMap.set(r.product_id, { supplier_id: r.supplier_id, last_rate: Number(r.purchase_rate) || 0 });
    }
    const groups = new Map<string, Array<{ product_id: string; suggested_qty: number; suggested_rate: number }>>();
    for (const p of filtered) {
      const sup = supMap.get(p.id);
      if (!sup) continue;
      const onHand = p.unit_type === 'piece'
        ? Number(p.piece_qty) - Number(p.reserved_piece_qty)
        : Number(p.box_qty) - Number(p.reserved_box_qty);
      const target = Number(p.reorder_level) * 2;
      const suggested = Math.max(target - onHand, Number(p.reorder_level));
      const arr = groups.get(sup.supplier_id) || [];
      arr.push({
        product_id: p.id,
        suggested_qty: Math.ceil(suggested),
        suggested_rate: sup.last_rate || Number(p.cost_price) || 0,
      });
      groups.set(sup.supplier_id, arr);
    }
    const userId = (req.user as any)?.id || null;
    const created: any[] = [];
    await db.transaction(async (trx) => {
      for (const [supplier_id, items] of groups) {
        // Skip if an open draft already exists for this supplier from auto source
        const existing = await trx('purchase_drafts')
          .where({ dealer_id: dealerId, supplier_id, status: 'draft', source: 'auto_low_stock' }).first();
        if (existing) continue;
        const [d] = await trx('purchase_drafts').insert({
          dealer_id: dealerId, supplier_id, source: 'auto_low_stock', created_by: userId,
          notes: 'Auto-generated from low-stock alert',
        }).returning('*');
        await trx('purchase_draft_items').insert(items.map((it) => ({
          draft_id: d.id, dealer_id: dealerId, ...it,
        })));
        created.push(d);
      }
    });
    res.json({ created: created.length, drafts: created });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const updateSchema = z.object({
  dealerId: z.string().uuid(),
  supplier_id: z.string().uuid().optional(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    suggested_qty: z.coerce.number().nonnegative(),
    suggested_rate: z.coerce.number().nonnegative(),
  })).optional(),
});

router.patch('/drafts/:id', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const draft = await db('purchase_drafts').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'draft') return res.status(400).json({ error: 'Only open drafts can be edited' });
    const { supplier_id, notes, items } = parsed.data;
    await db.transaction(async (trx) => {
      const patch: any = {};
      if (supplier_id !== undefined) patch.supplier_id = supplier_id;
      if (notes !== undefined) patch.notes = notes;
      if (Object.keys(patch).length) await trx('purchase_drafts').where({ id: draft.id }).update(patch);
      if (items) {
        await trx('purchase_draft_items').where({ draft_id: draft.id, dealer_id: dealerId }).delete();
        if (items.length) {
          await trx('purchase_draft_items').insert(items.map((it) => ({
            draft_id: draft.id, dealer_id: dealerId, ...it,
          })));
        }
      }
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/drafts/:id/discard', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const draft = await db('purchase_drafts').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    await db('purchase_drafts').where({ id: draft.id }).update({ status: 'discarded' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/drafts/:id/mark-converted', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const purchaseId = z.string().uuid().safeParse(req.body?.purchase_id);
    if (!purchaseId.success) return res.status(400).json({ error: 'purchase_id required' });
    const draft = await db('purchase_drafts').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    await db('purchase_drafts').where({ id: draft.id })
      .update({ status: 'converted', converted_purchase_id: purchaseId.data });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
