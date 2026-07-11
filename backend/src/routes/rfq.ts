/**
 * Request for Quotation (RFQ) routes — V2 Sprint 5A (Supplier & Purchase Foundation).
 *
 *   GET    /api/rfqs?dealerId=&search=&status=&page=
 *   GET    /api/rfqs/:id                              (items + invited suppliers + responses)
 *   POST   /api/rfqs                                   (create draft + items [+ optional purchase_request_id])
 *   PUT    /api/rfqs/:id                               (edit — draft only, replaces items)
 *   POST   /api/rfqs/:id/suppliers                     (invite suppliers, body: { supplier_ids: [] })
 *   DELETE /api/rfqs/:id/suppliers/:supplierId          (remove an invited supplier — draft only)
 *   POST   /api/rfqs/:id/send                          ("Send RFQ" — draft → sent, assigns rfq_number, stamps sent_at)
 *   POST   /api/rfqs/:id/responses                     (record a supplier's quote per line — manual entry)
 *   GET    /api/rfqs/:id/comparison                     (per-item, per-supplier quote comparison)
 *   POST   /api/rfqs/:id/approve                        (select winning supplier per line, status → approved)
 *   POST   /api/rfqs/:id/cancel
 *
 * A genuinely new entity — no RFQ/supplier-quotation-comparison concept
 * existed before this sprint (the existing `quotations` table is a
 * customer-facing sales quote, confirmed unrelated). Suppliers have no
 * login/portal in this system today, so "Supplier Response" is recorded by
 * dealer staff (communication with the supplier happens outside the system —
 * phone/WhatsApp/email) rather than submitted by the supplier directly.
 * Deliberately does NOT create a `purchases` row on approval: Purchase Order
 * creation from an approved RFQ is explicitly out of this sprint's scope —
 * `rfq_items.selected_supplier_id` simply records the outcome.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

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

const itemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  product_name_snapshot: z.string().min(1),
  qty: z.coerce.number().positive(),
  notes: z.string().nullable().optional(),
});

const formSchema = z.object({
  purchase_request_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

async function insertItems(trx: any, dealerId: string, rfqId: string, items: z.infer<typeof itemSchema>[]) {
  const rows = items.map((it, idx) => ({
    dealer_id: dealerId,
    rfq_id: rfqId,
    product_id: it.product_id || null,
    product_name_snapshot: it.product_name_snapshot,
    qty: it.qty,
    notes: it.notes || null,
    sort_order: idx,
  }));
  await trx('rfq_items').insert(rows);
}

// ── GET /api/rfqs ────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const search = ((req.query.search as string) || '').trim();
    const status = (req.query.status as string) || '';

    let q = db('rfqs').where({ dealer_id: dealerId });
    if (status) q = q.andWhere({ status });
    if (search) q = q.andWhere((b) => b.whereILike('rfq_number', `%${search}%`));

    const countQ = q.clone().clearSelect().count<{ count: string }[]>('* as count');
    const rowsQ = q.clone().select('*').orderBy('created_at', 'desc').offset(page * PAGE_SIZE).limit(PAGE_SIZE);

    const [countRow] = await countQ;
    const rows = await rowsQ;
    res.json({ rows, total: Number(countRow?.count ?? 0) });
  } catch (err: any) {
    console.error('[rfqs/list]', err.message);
    res.status(500).json({ error: 'Failed to list RFQs' });
  }
});

// ── GET /api/rfqs/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!row) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    const items = await db('rfq_items')
      .leftJoin('products', 'products.id', 'rfq_items.product_id')
      .leftJoin('suppliers', 'suppliers.id', 'rfq_items.selected_supplier_id')
      .where({ 'rfq_items.dealer_id': dealerId, rfq_id: req.params.id })
      .orderBy('sort_order', 'asc')
      .select(
        'rfq_items.*',
        'products.sku as product_sku',
        'suppliers.name as selected_supplier_name',
      );
    const invitedSuppliers = await db('rfq_suppliers')
      .innerJoin('suppliers', 'suppliers.id', 'rfq_suppliers.supplier_id')
      .where({ 'rfq_suppliers.dealer_id': dealerId, rfq_id: req.params.id })
      .select('rfq_suppliers.*', 'suppliers.name as supplier_name', 'suppliers.phone as supplier_phone');
    res.json({ ...row, items, suppliers: invitedSuppliers });
  } catch (err: any) {
    console.error('[rfqs/get]', err.message);
    res.status(500).json({ error: 'Failed to load RFQ' });
  }
});

// ── POST /api/rfqs ───────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { purchase_request_id, notes, items } = parsed.data;
    const createdBy = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [rfq] = await trx('rfqs')
        .insert({
          dealer_id: dealerId,
          purchase_request_id: purchase_request_id || null,
          notes: notes || null,
          created_by: createdBy,
        })
        .returning('*');
      await insertItems(trx, dealerId, rfq.id, items);
      return rfq;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[rfqs/create]', err.message);
    res.status(500).json({ error: 'Failed to create RFQ' });
  }
});

// ── PUT /api/rfqs/:id — edit (draft only) ────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { purchase_request_id, notes, items } = parsed.data;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only a draft RFQ can be edited.');
      }

      const [rfq] = await trx('rfqs')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({ purchase_request_id: purchase_request_id || null, notes: notes || null, updated_at: new Date() })
        .returning('*');

      await trx('rfq_items').where({ rfq_id: rfq.id, dealer_id: dealerId }).delete();
      await insertItems(trx, dealerId, rfq.id, items);
      return rfq;
    });

    if (!row) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[rfqs/update]', err.message);
    res.status(err.message?.includes('draft') ? 409 : 500).json({ error: err.message || 'Failed to update RFQ' });
  }
});

// ── POST /api/rfqs/:id/suppliers — invite suppliers ─────────────────────
const inviteSchema = z.object({ supplier_ids: z.array(z.string().uuid()).min(1) });

router.post('/:id/suppliers', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const rfq = await db('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!rfq) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }

    const rows = parsed.data.supplier_ids.map((supplier_id) => ({
      dealer_id: dealerId,
      rfq_id: rfq.id,
      supplier_id,
    }));
    await db('rfq_suppliers').insert(rows).onConflict(['rfq_id', 'supplier_id']).ignore();

    const invited = await db('rfq_suppliers')
      .innerJoin('suppliers', 'suppliers.id', 'rfq_suppliers.supplier_id')
      .where({ 'rfq_suppliers.dealer_id': dealerId, rfq_id: rfq.id })
      .select('rfq_suppliers.*', 'suppliers.name as supplier_name');
    res.status(201).json({ rows: invited });
  } catch (err: any) {
    console.error('[rfqs/invite-suppliers]', err.message);
    res.status(500).json({ error: 'Failed to invite suppliers' });
  }
});

// ── DELETE /api/rfqs/:id/suppliers/:supplierId ──────────────────────────
router.delete('/:id/suppliers/:supplierId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const rfq = await db('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!rfq) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    if (rfq.status !== 'draft') {
      res.status(409).json({ error: 'Suppliers can only be removed from a draft RFQ.' });
      return;
    }

    const deleted = await db('rfq_suppliers')
      .where({ dealer_id: dealerId, rfq_id: rfq.id, supplier_id: req.params.supplierId })
      .delete();
    if (!deleted) {
      res.status(404).json({ error: 'Supplier is not invited to this RFQ.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[rfqs/remove-supplier]', err.message);
    res.status(500).json({ error: 'Failed to remove supplier from RFQ' });
  }
});

// ── POST /api/rfqs/:id/send — draft → sent ──────────────────────────────
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('rfqs').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only a draft RFQ can be sent.');
      }
      const supplierCount = await trx('rfq_suppliers')
        .where({ rfq_id: existing.id, dealer_id: dealerId })
        .count<{ count: string }[]>('* as count');
      if (Number(supplierCount[0]?.count ?? 0) === 0) {
        throw new Error('Invite at least one supplier before sending the RFQ.');
      }

      const numResult = await trx.raw('SELECT generate_next_rfq_no(?::uuid) AS no', [dealerId]);
      const rfqNumber = String(numResult.rows?.[0]?.no ?? '');
      const now = new Date();

      const [rfq] = await trx('rfqs')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({ status: 'sent', rfq_number: rfqNumber, sent_at: now, updated_at: now })
        .returning('*');
      await trx('rfq_suppliers')
        .where({ rfq_id: existing.id, dealer_id: dealerId })
        .update({ sent_at: now });
      return rfq;
    });

    if (!row) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[rfqs/send]', err.message);
    res.status(err.message?.includes('draft') || err.message?.includes('supplier') ? 409 : 500)
      .json({ error: err.message || 'Failed to send RFQ' });
  }
});

// ── POST /api/rfqs/:id/responses — record a supplier's quote per line ──
const responseSchema = z.object({
  supplier_id: z.string().uuid(),
  rfq_item_id: z.string().uuid(),
  quoted_rate: z.coerce.number().nonnegative(),
  quoted_lead_time_days: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post('/:id/responses', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = responseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, rfq_item_id, quoted_rate, quoted_lead_time_days, notes } = parsed.data;
    const recordedBy = req.user?.userId ?? null;

    const rfq = await db('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!rfq) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    if (!['sent', 'comparing'].includes(rfq.status)) {
      res.status(409).json({ error: 'Responses can only be recorded once the RFQ has been sent.' });
      return;
    }
    const invited = await db('rfq_suppliers')
      .where({ dealer_id: dealerId, rfq_id: rfq.id, supplier_id })
      .first();
    if (!invited) {
      res.status(400).json({ error: 'This supplier was not invited to the RFQ.' });
      return;
    }
    const item = await db('rfq_items')
      .where({ id: rfq_item_id, dealer_id: dealerId, rfq_id: rfq.id })
      .first();
    if (!item) {
      res.status(400).json({ error: 'RFQ line item not found.' });
      return;
    }

    const [response] = await db('rfq_responses')
      .insert({
        dealer_id: dealerId,
        rfq_id: rfq.id,
        rfq_item_id,
        supplier_id,
        quoted_rate,
        quoted_lead_time_days: quoted_lead_time_days ?? null,
        notes: notes || null,
        recorded_by: recordedBy,
      })
      .onConflict(['rfq_item_id', 'supplier_id'])
      .merge({
        quoted_rate,
        quoted_lead_time_days: quoted_lead_time_days ?? null,
        notes: notes || null,
        recorded_by: recordedBy,
        responded_at: new Date(),
      })
      .returning('*');

    await db('rfq_suppliers')
      .where({ dealer_id: dealerId, rfq_id: rfq.id, supplier_id })
      .update({ status: 'responded' });
    if (rfq.status === 'sent') {
      await db('rfqs').where({ id: rfq.id, dealer_id: dealerId }).update({ status: 'comparing', updated_at: new Date() });
    }

    res.status(201).json({ row: response });
  } catch (err: any) {
    console.error('[rfqs/record-response]', err.message);
    res.status(500).json({ error: 'Failed to record supplier response' });
  }
});

// ── GET /api/rfqs/:id/comparison — per-item, per-supplier quote grid ────
router.get('/:id/comparison', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const rfq = await db('rfqs').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!rfq) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    const items = await db('rfq_items').where({ dealer_id: dealerId, rfq_id: rfq.id }).orderBy('sort_order', 'asc');
    const suppliers = await db('rfq_suppliers')
      .innerJoin('suppliers', 'suppliers.id', 'rfq_suppliers.supplier_id')
      .where({ 'rfq_suppliers.dealer_id': dealerId, rfq_id: rfq.id })
      .select('rfq_suppliers.supplier_id', 'suppliers.name as supplier_name', 'rfq_suppliers.status');
    const responses = await db('rfq_responses').where({ dealer_id: dealerId, rfq_id: rfq.id });

    const grid = items.map((item) => ({
      rfq_item_id: item.id,
      product_name_snapshot: item.product_name_snapshot,
      qty: Number(item.qty),
      selected_supplier_id: item.selected_supplier_id,
      quotes: suppliers.map((s) => {
        const resp = responses.find((r) => r.rfq_item_id === item.id && r.supplier_id === s.supplier_id);
        return {
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name,
          quoted_rate: resp ? Number(resp.quoted_rate) : null,
          quoted_lead_time_days: resp ? resp.quoted_lead_time_days : null,
        };
      }),
    }));

    res.json({ rfq, items: grid, suppliers });
  } catch (err: any) {
    console.error('[rfqs/comparison]', err.message);
    res.status(500).json({ error: 'Failed to load RFQ comparison' });
  }
});

// ── POST /api/rfqs/:id/approve — select winning supplier per line ──────
const approveSchema = z.object({
  selections: z.array(z.object({
    rfq_item_id: z.string().uuid(),
    supplier_id: z.string().uuid(),
  })).min(1),
});

router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const approvedBy = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('rfqs').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!existing) return null;
      if (!['sent', 'comparing'].includes(existing.status)) {
        throw new Error('Only a sent or comparing RFQ can be approved.');
      }

      for (const sel of parsed.data.selections) {
        const item = await trx('rfq_items')
          .where({ id: sel.rfq_item_id, dealer_id: dealerId, rfq_id: existing.id })
          .first();
        if (!item) throw new Error('RFQ line item not found.');
        const quote = await trx('rfq_responses')
          .where({ rfq_item_id: sel.rfq_item_id, supplier_id: sel.supplier_id, dealer_id: dealerId })
          .first();
        if (!quote) throw new Error('Selected supplier has no recorded quote for this line.');
        await trx('rfq_items')
          .where({ id: sel.rfq_item_id, dealer_id: dealerId })
          .update({ selected_supplier_id: sel.supplier_id });
      }

      const [rfq] = await trx('rfqs')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date(), updated_at: new Date() })
        .returning('*');
      return rfq;
    });

    if (!row) {
      res.status(404).json({ error: 'RFQ not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[rfqs/approve]', err.message);
    res.status(err.message?.includes('RFQ') || err.message?.includes('quote') ? 409 : 500)
      .json({ error: err.message || 'Failed to approve RFQ' });
  }
});

// ── POST /api/rfqs/:id/cancel ────────────────────────────────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('rfqs')
      .where({ id: req.params.id, dealer_id: dealerId })
      .whereIn('status', ['draft', 'sent', 'comparing'])
      .update({ status: 'cancelled', updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'RFQ cannot be cancelled in its current state.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[rfqs/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel RFQ' });
  }
});

export default router;
