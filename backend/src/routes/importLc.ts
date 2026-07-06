/**
 * Import LC routes — V2 Sprint 5E.
 *
 * A BDT-only paperwork/status tracker for Proforma Invoice → Letter of
 * Credit → Shipment (+ Containers) → Customs Clearance. None of this
 * concept existed anywhere in the codebase before this sprint (confirmed by
 * inspection). Deliberately NOT wired into stock/financial posting — actual
 * goods receipt continues through the existing Purchase Order → Goods
 * Receipt → Purchase Invoice pipeline; a Shipment may optionally reference
 * the resulting `purchases` row (`purchase_id`) purely as a cross-reference
 * for compliance paperwork, with zero automation triggered by that link.
 *
 * "Vendor" is not a new entity — every PI/LC/Shipment reuses the existing
 * `suppliers` table via `supplier_id` (confirmed: this codebase has no
 * separate vendor concept, and introducing a parallel one would just
 * duplicate the same real-world entity).
 *
 * Amounts are BDT only, with an optional free-text `currency_note` (e.g.
 * "USD 12,000 @ approx rate") — there is no FX conversion, since
 * Multi-currency is explicitly out of scope this sprint.
 *
 *   GET/POST            /api/import-lc/proforma-invoices
 *   GET/PUT/DELETE       /api/import-lc/proforma-invoices/:id
 *   GET/POST            /api/import-lc/letters-of-credit
 *   GET/PUT/DELETE       /api/import-lc/letters-of-credit/:id
 *   GET/POST            /api/import-lc/shipments
 *   GET/PUT/DELETE       /api/import-lc/shipments/:id            (PUT replaces containers[])
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

const WRITE_ROLES = ['dealer_admin', 'manager', 'accountant'] as const;

// ═══════════════════════ Proforma Invoice ═══════════════════════════════

const piSchema = z.object({
  supplier_id: z.string().uuid(),
  pi_number: z.string().trim().min(1),
  pi_date: z.string().min(1),
  total_amount: z.coerce.number().min(0).default(0),
  currency_note: z.string().trim().max(255).nullable().optional(),
  status: z.enum(['draft', 'confirmed', 'cancelled']).default('draft'),
  notes: z.string().nullable().optional(),
});

router.get('/proforma-invoices', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('import_proforma_invoices as pi')
      .leftJoin('suppliers as s', 's.id', 'pi.supplier_id')
      .where({ 'pi.dealer_id': dealerId })
      .select('pi.*', 's.name as supplier_name')
      .orderBy('pi.created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list proforma invoices' });
  }
});

router.get('/proforma-invoices/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('import_proforma_invoices as pi')
      .leftJoin('suppliers as s', 's.id', 'pi.supplier_id')
      .where({ 'pi.id': req.params.id, 'pi.dealer_id': dealerId })
      .select('pi.*', 's.name as supplier_name')
      .first();
    if (!row) {
      res.status(404).json({ error: 'Proforma invoice not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load proforma invoice' });
  }
});

router.post('/proforma-invoices', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = piSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const userId = req.user?.userId ?? null;
    const [row] = await db('import_proforma_invoices')
      .insert({ dealer_id: dealerId, created_by: userId, ...parsed.data, currency_note: parsed.data.currency_note || null, notes: parsed.data.notes || null })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create proforma invoice' });
  }
});

router.put('/proforma-invoices/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = piSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const [row] = await db('import_proforma_invoices')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ ...parsed.data, currency_note: parsed.data.currency_note || null, notes: parsed.data.notes || null })
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Proforma invoice not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update proforma invoice' });
  }
});

router.delete('/proforma-invoices/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const deleted = await db('import_proforma_invoices').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!deleted) {
      res.status(404).json({ error: 'Proforma invoice not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete proforma invoice' });
  }
});

// ═══════════════════════ Letter of Credit ════════════════════════════════

const lcSchema = z.object({
  proforma_invoice_id: z.string().uuid().nullable().optional(),
  supplier_id: z.string().uuid(),
  lc_number: z.string().trim().min(1),
  lc_date: z.string().min(1),
  issuing_bank: z.string().trim().max(255).nullable().optional(),
  lc_amount: z.coerce.number().min(0).default(0),
  expiry_date: z.string().nullable().optional(),
  status: z.enum(['draft', 'opened', 'amended', 'closed', 'cancelled']).default('draft'),
  notes: z.string().nullable().optional(),
});

router.get('/letters-of-credit', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('import_letters_of_credit as lc')
      .leftJoin('suppliers as s', 's.id', 'lc.supplier_id')
      .leftJoin('import_proforma_invoices as pi', 'pi.id', 'lc.proforma_invoice_id')
      .where({ 'lc.dealer_id': dealerId })
      .select('lc.*', 's.name as supplier_name', 'pi.pi_number')
      .orderBy('lc.created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list letters of credit' });
  }
});

router.get('/letters-of-credit/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('import_letters_of_credit as lc')
      .leftJoin('suppliers as s', 's.id', 'lc.supplier_id')
      .where({ 'lc.id': req.params.id, 'lc.dealer_id': dealerId })
      .select('lc.*', 's.name as supplier_name')
      .first();
    if (!row) {
      res.status(404).json({ error: 'Letter of credit not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load letter of credit' });
  }
});

router.post('/letters-of-credit', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = lcSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const userId = req.user?.userId ?? null;
    const { proforma_invoice_id, issuing_bank, expiry_date, notes, ...rest } = parsed.data;
    const [row] = await db('import_letters_of_credit')
      .insert({
        dealer_id: dealerId, created_by: userId, ...rest,
        proforma_invoice_id: proforma_invoice_id || null,
        issuing_bank: issuing_bank || null,
        expiry_date: expiry_date || null,
        notes: notes || null,
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create letter of credit' });
  }
});

router.put('/letters-of-credit/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = lcSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { proforma_invoice_id, issuing_bank, expiry_date, notes, ...rest } = parsed.data;
    const [row] = await db('import_letters_of_credit')
      .where({ id: req.params.id, dealer_id: dealerId })
      .update({ ...rest, proforma_invoice_id: proforma_invoice_id || null, issuing_bank: issuing_bank || null, expiry_date: expiry_date || null, notes: notes || null })
      .returning('*');
    if (!row) {
      res.status(404).json({ error: 'Letter of credit not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update letter of credit' });
  }
});

router.delete('/letters-of-credit/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const deleted = await db('import_letters_of_credit').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!deleted) {
      res.status(404).json({ error: 'Letter of credit not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete letter of credit' });
  }
});

// ═══════════════════════ Shipment (+ Containers) ═════════════════════════

const containerSchema = z.object({
  container_no: z.string().trim().min(1),
  container_size: z.string().trim().max(20).nullable().optional(),
  seal_no: z.string().trim().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const shipmentSchema = z.object({
  letter_of_credit_id: z.string().uuid().nullable().optional(),
  supplier_id: z.string().uuid(),
  purchase_id: z.string().uuid().nullable().optional(),
  shipment_ref: z.string().trim().min(1),
  vessel_name: z.string().trim().max(255).nullable().optional(),
  port_of_loading: z.string().trim().max(255).nullable().optional(),
  port_of_discharge: z.string().trim().max(255).nullable().optional(),
  eta_date: z.string().nullable().optional(),
  actual_arrival_date: z.string().nullable().optional(),
  cf_agent_name: z.string().trim().max(255).nullable().optional(),
  cf_agent_contact: z.string().trim().max(100).nullable().optional(),
  customs_bill_of_entry_no: z.string().trim().max(100).nullable().optional(),
  customs_clearance_date: z.string().nullable().optional(),
  status: z.enum(['in_transit', 'arrived', 'customs_clearance', 'cleared', 'cancelled']).default('in_transit'),
  notes: z.string().nullable().optional(),
  containers: z.array(containerSchema).default([]),
});

function nullifyOptional<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
  const copy = { ...obj };
  for (const k of keys) if (!copy[k]) copy[k] = null as any;
  return copy;
}

router.get('/shipments', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await db('import_shipments as sh')
      .leftJoin('suppliers as s', 's.id', 'sh.supplier_id')
      .where({ 'sh.dealer_id': dealerId })
      .select('sh.*', 's.name as supplier_name')
      .orderBy('sh.created_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list shipments' });
  }
});

router.get('/shipments/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const row = await db('import_shipments as sh')
      .leftJoin('suppliers as s', 's.id', 'sh.supplier_id')
      .where({ 'sh.id': req.params.id, 'sh.dealer_id': dealerId })
      .select('sh.*', 's.name as supplier_name')
      .first();
    if (!row) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    const containers = await db('import_shipment_containers').where({ import_shipment_id: row.id, dealer_id: dealerId });
    res.json({ row: { ...row, containers } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load shipment' });
  }
});

router.post('/shipments', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = shipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const userId = req.user?.userId ?? null;
    const { containers, ...header } = parsed.data;
    const cleaned = nullifyOptional(header, [
      'letter_of_credit_id', 'purchase_id', 'vessel_name', 'port_of_loading', 'port_of_discharge',
      'eta_date', 'actual_arrival_date', 'cf_agent_name', 'cf_agent_contact', 'customs_bill_of_entry_no',
      'customs_clearance_date', 'notes',
    ]);

    const row = await db.transaction(async (trx) => {
      const [created] = await trx('import_shipments').insert({ dealer_id: dealerId, created_by: userId, ...cleaned }).returning('*');
      if (containers.length) {
        await trx('import_shipment_containers').insert(
          containers.map((c) => ({ import_shipment_id: created.id, dealer_id: dealerId, container_no: c.container_no, container_size: c.container_size || null, seal_no: c.seal_no || null, notes: c.notes || null })),
        );
      }
      return created;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create shipment' });
  }
});

router.put('/shipments/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = shipmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { containers, ...header } = parsed.data;
    const cleaned = nullifyOptional(header, [
      'letter_of_credit_id', 'purchase_id', 'vessel_name', 'port_of_loading', 'port_of_discharge',
      'eta_date', 'actual_arrival_date', 'cf_agent_name', 'cf_agent_contact', 'customs_bill_of_entry_no',
      'customs_clearance_date', 'notes',
    ]);

    const row = await db.transaction(async (trx) => {
      const existing = await trx('import_shipments').where({ id: req.params.id, dealer_id: dealerId }).first();
      if (!existing) return null;
      const [updated] = await trx('import_shipments').where({ id: existing.id }).update(cleaned).returning('*');
      await trx('import_shipment_containers').where({ import_shipment_id: existing.id, dealer_id: dealerId }).delete();
      if (containers.length) {
        await trx('import_shipment_containers').insert(
          containers.map((c) => ({ import_shipment_id: existing.id, dealer_id: dealerId, container_no: c.container_no, container_size: c.container_size || null, seal_no: c.seal_no || null, notes: c.notes || null })),
        );
      }
      return updated;
    });

    if (!row) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update shipment' });
  }
});

router.delete('/shipments/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const deleted = await db('import_shipments').where({ id: req.params.id, dealer_id: dealerId }).delete();
    if (!deleted) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
});

export default router;
