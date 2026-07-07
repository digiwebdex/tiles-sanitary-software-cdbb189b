/**
 * VAT Closing — V2 Sprint 6E.
 *
 *   GET  /api/vat-closing/summary?from=&to=          Input/Output VAT Summary + Reconciliation
 *   GET  /api/vat-closing/mushak-9-1-draft?from=&to=  Internal-only NBR return draft
 *   POST /api/vat-closing/close                        { period_start, period_end, notes? }
 *   GET  /api/vat-closing/history
 *
 * Reuses the existing VAT Engine (vatReportService.ts's Mushak 6.1/6.3
 * registers) entirely — no new VAT computation, no new posting. GL account
 * 2200 (VAT Receivable/Input VAT) is seeded but nothing posts to it yet
 * (purchase posting books VAT into Inventory/AP, not as a separate
 * recoverable credit) — rebuilding that would touch frozen Sprint 5D/5E
 * purchase posting logic, out of proportion to this sprint. VAT Closing is
 * therefore a compliance RECORD (vat_period_closings, migration 102), not a
 * GL/cash posting — no payment date/method is captured because closing the
 * period doesn't imply payment happened.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import { fetchMushak61PurchaseRegister, fetchMushak63SalesRegister } from '../services/vatReportService';

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

function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin') || hasRole(req, 'finance_manager') || hasRole(req, 'senior_accountant')) return true;
  res.status(403).json({ error: 'VAT closing requires an accounting role' });
  return false;
}

function parsePeriod(req: Request, res: Response): { from: string; to: string } | null {
  const from = (req.query.from as string | undefined) || (req.body?.period_start as string | undefined) || '';
  const to = (req.query.to as string | undefined) || (req.body?.period_end as string | undefined) || '';
  if (!from || !to) { res.status(400).json({ error: 'from/to (or period_start/period_end) are required (YYYY-MM-DD)' }); return null; }
  return { from, to };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function computeVatPosition(dealerId: string, from: string, to: string) {
  const [sales, purchases] = await Promise.all([
    fetchMushak63SalesRegister(dealerId, from, to),
    fetchMushak61PurchaseRegister(dealerId, from, to),
  ]);
  const net_payable = round2(sales.totals.vat + sales.totals.sd - purchases.totals.vat - purchases.totals.sd);
  return { sales, purchases, net_payable };
}

router.get('/summary', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const period = parsePeriod(req, res); if (!period) return;
  try {
    const { sales, purchases, net_payable } = await computeVatPosition(dealerId, period.from, period.to);
    res.json({
      period,
      output_vat_summary: { taxable: sales.totals.taxable, vat: sales.totals.vat, sd: sales.totals.sd, total: sales.totals.total, invoice_count: sales.rows.length },
      input_vat_summary: { taxable: purchases.totals.taxable, vat: purchases.totals.vat, sd: purchases.totals.sd, total: purchases.totals.total, invoice_count: purchases.rows.length },
      reconciliation: {
        output_tax: round2(sales.totals.vat + sales.totals.sd),
        input_tax: round2(purchases.totals.vat + purchases.totals.sd),
        net_payable,
        position: net_payable >= 0 ? 'payable' : 'refundable',
      },
    });
  } catch (err: any) {
    console.error('[vat-closing/summary]', err.message);
    res.status(500).json({ error: 'Failed to compute VAT summary' });
  }
});

router.get('/mushak-9-1-draft', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const period = parsePeriod(req, res); if (!period) return;
  try {
    const { sales, purchases, net_payable } = await computeVatPosition(dealerId, period.from, period.to);
    res.json({
      form: 'mushak-9.1',
      internal_only: true,
      disclaimer: 'Internal draft only — not an official NBR submission. Verify against original invoices before filing.',
      period,
      total_output_tax: round2(sales.totals.vat + sales.totals.sd),
      total_taxable_supplies: sales.totals.taxable,
      total_input_tax_credit: round2(purchases.totals.vat + purchases.totals.sd),
      total_taxable_purchases: purchases.totals.taxable,
      net_vat_payable: net_payable >= 0 ? net_payable : 0,
      net_vat_refundable: net_payable < 0 ? round2(-net_payable) : 0,
    });
  } catch (err: any) {
    console.error('[vat-closing/mushak-9-1-draft]', err.message);
    res.status(500).json({ error: 'Failed to build Mushak 9.1 draft' });
  }
});

const closeSchema = z.object({
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  notes: z.string().nullable().optional(),
});

router.post('/close', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const { period_start, period_end, notes } = parsed.data;

  try {
    const { sales, purchases, net_payable } = await computeVatPosition(dealerId, period_start, period_end);
    const [row] = await db('vat_period_closings')
      .insert({
        dealer_id: dealerId,
        period_start,
        period_end,
        output_vat_total: sales.totals.vat,
        output_sd_total: sales.totals.sd,
        input_vat_total: purchases.totals.vat,
        input_sd_total: purchases.totals.sd,
        net_payable,
        notes: notes ?? null,
        closed_by: req.user?.userId ?? null,
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: `VAT period ${period_start} to ${period_end} has already been closed for this dealer.` }); return; }
    console.error('[vat-closing/close]', err.message);
    res.status(500).json({ error: 'Failed to close VAT period' });
  }
});

router.get('/history', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const rows = await db('vat_period_closings').where({ dealer_id: dealerId }).orderBy('period_start', 'desc');
  res.json({ rows });
});

export default router;
