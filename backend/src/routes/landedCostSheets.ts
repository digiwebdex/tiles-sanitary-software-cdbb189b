/**
 * Landed Cost routes — V2 Sprint 5E.
 *
 *   GET  /api/landed-cost-sheets?dealerId=&purchaseId=
 *   GET  /api/landed-cost-sheets/:id
 *   POST /api/landed-cost-sheets                (create draft against one Purchase Invoice)
 *   POST /api/landed-cost-sheets/:id/apply       (allocate across lines, adjust average cost)
 *   POST /api/landed-cost-sheets/:id/cancel      (draft only)
 *
 * A Landed Cost Sheet applies to ONE Purchase Invoice (`purchases` row).
 * Freight/Insurance/Customs Duty/VAT/Port Charges/C&F Charges/Local
 * Transport/Other Charges are entered as flat manual amounts — this is
 * deliberately NOT run through `computeVatBreakdown` (that engine computes
 * a dealer's own output/input VAT on a sale/purchase; the "VAT" component
 * here is import-stage duty paid at customs, a cost component like the
 * others, not a redesign of the VAT engine).
 *
 * Allocation is proportional BY LINE VALUE (quantity × purchase_rate) across
 * the invoice's items — the standard, most broadly applicable method absent
 * a weight/volume field on the product master. Applying a sheet adds the
 * allocated per-unit cost directly onto `stock.average_cost_per_unit` (the
 * ONLY place unit cost is stored — no per-batch cost column exists anywhere
 * in this codebase, confirmed by inspection), using the exact same
 * qty-base conversion (`sft_qty` for box_sft products, else `piece_qty`)
 * that `receivingStockPosting.ts`'s weighted-average formula already uses.
 *
 * Known, documented simplification: this assumes the full originally
 * invoiced quantity is still in stock — COGS on anything already sold
 * before the sheet is applied is not retroactively corrected. This matches
 * how every weighted-average-cost system in this codebase already works
 * (no per-batch cost tracking exists to do better).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

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

const chargeFields = [
  'freight_amount', 'insurance_amount', 'customs_duty_amount', 'vat_amount',
  'port_charges_amount', 'cf_charges_amount', 'local_transport_amount', 'other_charges_amount',
] as const;

const formSchema = z.object({
  purchase_id: z.string().uuid(),
  sheet_date: z.string().min(1),
  freight_amount: z.coerce.number().min(0).default(0),
  insurance_amount: z.coerce.number().min(0).default(0),
  customs_duty_amount: z.coerce.number().min(0).default(0),
  vat_amount: z.coerce.number().min(0).default(0),
  port_charges_amount: z.coerce.number().min(0).default(0),
  cf_charges_amount: z.coerce.number().min(0).default(0),
  local_transport_amount: z.coerce.number().min(0).default(0),
  other_charges_amount: z.coerce.number().min(0).default(0),
  notes: z.string().nullable().optional(),
});

async function nextSheetNo(trx: any, dealerId: string): Promise<string> {
  const [row] = await trx('landed_cost_sheets').where({ dealer_id: dealerId }).count('id as count');
  return `LCS-${String(Number((row as any)?.count ?? 0) + 1).padStart(4, '0')}`;
}

// ── GET /api/landed-cost-sheets ──────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const purchaseId = (req.query.purchaseId as string) || '';

    let q = db('landed_cost_sheets as lcs')
      .leftJoin('purchases as p', 'p.id', 'lcs.purchase_id')
      .where({ 'lcs.dealer_id': dealerId });
    if (purchaseId) q = q.andWhere('lcs.purchase_id', purchaseId);

    const rows = await q
      .select('lcs.*', 'p.invoice_number as purchase_invoice_number')
      .orderBy('lcs.created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    console.error('[landed-cost-sheets/list]', err.message);
    res.status(500).json({ error: 'Failed to list landed cost sheets' });
  }
});

// ── GET /api/landed-cost-sheets/:id ───────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db('landed_cost_sheets as lcs')
      .leftJoin('purchases as p', 'p.id', 'lcs.purchase_id')
      .where({ 'lcs.id': req.params.id, 'lcs.dealer_id': dealerId })
      .select('lcs.*', 'p.invoice_number as purchase_invoice_number')
      .first();
    if (!row) {
      res.status(404).json({ error: 'Landed cost sheet not found' });
      return;
    }
    const items = await db('landed_cost_sheet_items as lci')
      .leftJoin('products as prod', 'prod.id', 'lci.product_id')
      .where({ 'lci.landed_cost_sheet_id': row.id, 'lci.dealer_id': dealerId })
      .select('lci.*', 'prod.name as product_name', 'prod.sku as product_sku');

    res.json({ row: { ...row, items } });
  } catch (err: any) {
    console.error('[landed-cost-sheets/detail]', err.message);
    res.status(500).json({ error: 'Failed to load landed cost sheet' });
  }
});

// ── POST /api/landed-cost-sheets — create draft ──────────────────────────
router.post('/', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const data = parsed.data;
    const userId = req.user?.userId ?? null;
    const totalAmount = round2(chargeFields.reduce((sum, f) => sum + (data[f] || 0), 0));

    const row = await db.transaction(async (trx) => {
      const purchase = await trx('purchases').where({ id: data.purchase_id, dealer_id: dealerId }).first();
      if (!purchase) throw Object.assign(new Error('Purchase not found for this dealer.'), { status: 400 });
      if (purchase.document_status !== 'posted') {
        throw Object.assign(new Error('Landed cost can only be applied to a posted (finalized) purchase invoice.'), { status: 409 });
      }
      const itemCount = await trx('purchase_items').where({ purchase_id: purchase.id, dealer_id: dealerId }).first();
      if (!itemCount) throw Object.assign(new Error('This purchase has no line items.'), { status: 409 });

      const sheetNo = await nextSheetNo(trx, dealerId);
      const [created] = await trx('landed_cost_sheets')
        .insert({
          dealer_id: dealerId,
          purchase_id: data.purchase_id,
          sheet_no: sheetNo,
          sheet_date: data.sheet_date,
          freight_amount: data.freight_amount,
          insurance_amount: data.insurance_amount,
          customs_duty_amount: data.customs_duty_amount,
          vat_amount: data.vat_amount,
          port_charges_amount: data.port_charges_amount,
          cf_charges_amount: data.cf_charges_amount,
          local_transport_amount: data.local_transport_amount,
          other_charges_amount: data.other_charges_amount,
          total_amount: totalAmount,
          status: 'draft',
          notes: data.notes || null,
          created_by: userId,
        })
        .returning('*');
      return created;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[landed-cost-sheets/create]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create landed cost sheet' });
  }
});

// ── POST /api/landed-cost-sheets/:id/apply ───────────────────────────────
router.post('/:id/apply', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const userId = req.user?.userId ?? null;

    const result = await db.transaction(async (trx) => {
      const sheet = await trx('landed_cost_sheets').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!sheet) return null;
      if (sheet.status !== 'draft') {
        throw Object.assign(new Error('Only a draft landed cost sheet can be applied.'), { status: 409 });
      }
      if (Number(sheet.total_amount) <= 0) {
        throw Object.assign(new Error('This sheet has no charges to allocate.'), { status: 409 });
      }

      const items = await trx('purchase_items as pi')
        .innerJoin('products as prod', 'prod.id', 'pi.product_id')
        .where({ 'pi.purchase_id': sheet.purchase_id, 'pi.dealer_id': dealerId })
        .select('pi.id', 'pi.product_id', 'pi.quantity', 'pi.purchase_rate', 'prod.unit_type', 'prod.per_box_sft');

      const subtotal = items.reduce((sum: number, it: any) => sum + Number(it.quantity) * Number(it.purchase_rate), 0);
      if (subtotal <= 0) {
        throw Object.assign(new Error('Cannot allocate landed cost across zero-value lines.'), { status: 409 });
      }

      const sheetItems: any[] = [];
      const adjustments: any[] = [];

      for (const item of items) {
        const lineValue = Number(item.quantity) * Number(item.purchase_rate);
        const share = lineValue / subtotal;
        const allocated = round2(Number(sheet.total_amount) * share);

        const unitType = item.unit_type ?? 'piece';
        const perBoxSft = item.per_box_sft ?? null;
        const qtyBase = unitType === 'box_sft' && perBoxSft ? Number(item.quantity) * Number(perBoxSft) : Number(item.quantity);
        if (qtyBase <= 0) continue;

        const stockRow = await trx('stock').where({ dealer_id: dealerId, product_id: item.product_id }).forUpdate().first('average_cost_per_unit');
        if (!stockRow) continue; // No remaining stock row to value — nothing to adjust (documented limitation).

        const avgBefore = Number(stockRow.average_cost_per_unit) || 0;
        const avgAfter = round2(avgBefore + allocated / qtyBase);

        await trx('stock').where({ dealer_id: dealerId, product_id: item.product_id }).update({ average_cost_per_unit: avgAfter });

        sheetItems.push({
          landed_cost_sheet_id: sheet.id,
          dealer_id: dealerId,
          purchase_item_id: item.id,
          product_id: item.product_id,
          line_value: round2(lineValue),
          qty_base: qtyBase,
          allocated_amount: allocated,
          avg_cost_before: avgBefore,
          avg_cost_after: avgAfter,
        });
        adjustments.push({
          dealer_id: dealerId,
          product_id: item.product_id,
          old_avg_cost: avgBefore,
          new_avg_cost: avgAfter,
          reason: `Landed cost sheet ${sheet.sheet_no} applied`,
          adjustment_type: 'landed_cost',
          landed_cost_sheet_id: sheet.id,
          created_by: userId,
        });
      }

      if (sheetItems.length === 0) {
        throw Object.assign(new Error('No product currently has stock on hand to allocate landed cost against.'), { status: 409 });
      }

      await trx('landed_cost_sheet_items').insert(sheetItems);
      await trx('stock_cost_adjustments').insert(adjustments);

      const [updated] = await trx('landed_cost_sheets')
        .where({ id: sheet.id })
        .update({ status: 'applied', applied_at: new Date() })
        .returning('*');
      return updated;
    });

    if (!result) {
      res.status(404).json({ error: 'Landed cost sheet not found' });
      return;
    }
    res.json({ row: result });
  } catch (err: any) {
    console.error('[landed-cost-sheets/apply]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to apply landed cost sheet' });
  }
});

// ── POST /api/landed-cost-sheets/:id/cancel — draft only ─────────────────
router.post('/:id/cancel', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('landed_cost_sheets')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .update({ status: 'cancelled' })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a draft landed cost sheet can be cancelled.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[landed-cost-sheets/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel landed cost sheet' });
  }
});

export default router;
