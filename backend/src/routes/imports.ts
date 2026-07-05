/**
 * Bulk import REST routes — Phase 3U-3.
 *
 *   POST /api/imports/products     body: { dealerId, mode, rows }
 *   POST /api/imports/customers    body: { dealerId, mode, rows }
 *   POST /api/imports/suppliers    body: { dealerId, mode, rows }
 *
 * - mode: 'skip' | 'overwrite'
 * - dealer_admin only (matches feature gating)
 * - Tenant-scoped: super_admin must pass dealerId, dealer users use bound dealerId
 * - Per-row validation; failures don't abort the batch.
 * - Response: { success, skipped, errors: [{ row, field, message }] }
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard);

type Mode = 'skip' | 'overwrite';
interface ImportError { row: number; field: string; message: string; }
interface ImportResult { success: number; skipped: number; errors: ImportError[]; }

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.body?.dealerId as string | undefined) || undefined;
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

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// ── POST /api/imports/products ────────────────────────────────────────────
router.post('/products', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const mode = (req.body?.mode === 'overwrite' ? 'overwrite' : 'skip') as Mode;
  const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

  const result: ImportResult = { success: 0, skipped: 0, errors: [] };

  try {
    const existing = await db('products')
      .where({ dealer_id: dealerId })
      .select('sku', 'barcode');
    const existingSkus = new Set(existing.map((p: any) => String(p.sku || '').toLowerCase()));
    const existingBarcodes = new Set(
      existing.filter((p: any) => p.barcode).map((p: any) => String(p.barcode).toLowerCase()),
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const sku = str(row.sku);
      if (!sku) { result.errors.push({ row: i + 2, field: 'SKU', message: 'Missing' }); continue; }

      const isDup = existingSkus.has(sku.toLowerCase());
      const barcodeRaw = str(row.barcode);
      const barcodeConflict = !!barcodeRaw && existingBarcodes.has(barcodeRaw.toLowerCase());

      if ((isDup || barcodeConflict) && mode === 'skip') { result.skipped++; continue; }

      const category = str(row.category).toLowerCase();
      if (!['tiles', 'sanitary'].includes(category)) {
        result.errors.push({ row: i + 2, field: 'Category', message: "Must be 'tiles' or 'sanitary'" });
        continue;
      }
      const unitType = (str(row.unit_type).toLowerCase() || 'piece');
      if (!['box_sft', 'piece'].includes(unitType)) {
        result.errors.push({ row: i + 2, field: 'Unit Type', message: "Must be 'box_sft' or 'piece'" });
        continue;
      }
      if (category === 'tiles' && !str(row.per_box_sft)) {
        result.errors.push({ row: i + 2, field: 'Per Box SFT', message: 'Required for tiles' });
        continue;
      }

      const payload: Record<string, unknown> = {
        dealer_id: dealerId,
        name: str(row.name),
        sku,
        category,
        unit_type: unitType,
        per_box_sft: row.per_box_sft ? num(row.per_box_sft) : null,
        default_sale_rate: num(row.default_sale_rate, 0),
        cost_price: num(row.cost_price, 0),
        brand: str(row.brand) || null,
        size: str(row.size) || null,
        color: str(row.color) || null,
        barcode: barcodeRaw || null,
        reorder_level: num(row.reorder_level, 0),
        // V2 Sprint 2.1 — Product Master taxonomy (all optional; blank/missing
        // cells simply import as not-set, same as every other optional column
        // above).
        series: str(row.series) || null,
        collection_name: str(row.collection_name) || null,
        tile_type: str(row.tile_type) || null,
        finish: str(row.finish) || null,
        surface: str(row.surface) || null,
        shade_family: str(row.shade_family) || null,
        caliber_spec: str(row.caliber_spec) || null,
        thickness_mm: row.thickness_mm ? num(row.thickness_mm) : null,
        country_of_origin: str(row.country_of_origin) || null,
        default_rack: str(row.default_rack) || null,
      };

      try {
        if (isDup && mode === 'overwrite') {
          await db('products')
            .where({ dealer_id: dealerId })
            .andWhereRaw('LOWER(sku) = ?', [sku.toLowerCase()])
            .update(payload);
        } else {
          await db('products').insert(payload);
          existingSkus.add(sku.toLowerCase());
          if (barcodeRaw) existingBarcodes.add(barcodeRaw.toLowerCase());
        }
        result.success++;
      } catch (e: any) {
        result.errors.push({ row: i + 2, field: 'SKU', message: e.message || 'Insert failed' });
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error('[imports/products]', err.message);
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

// ── POST /api/imports/customers ───────────────────────────────────────────
router.post('/customers', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const mode = (req.body?.mode === 'overwrite' ? 'overwrite' : 'skip') as Mode;
  const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const result: ImportResult = { success: 0, skipped: 0, errors: [] };

  try {
    const existing = await db('customers').where({ dealer_id: dealerId }).select('name');
    const existingNames = new Set(existing.map((c: any) => String(c.name).toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const name = str(row.name);
      if (!name) { result.errors.push({ row: i + 2, field: 'Name', message: 'Missing' }); continue; }

      const dup = existingNames.has(name.toLowerCase());
      if (dup && mode === 'skip') { result.skipped++; continue; }

      const type = (str(row.type).toLowerCase() || 'customer');
      if (!['retailer', 'customer', 'project'].includes(type)) {
        result.errors.push({ row: i + 2, field: 'Type', message: 'Must be retailer, customer, or project' });
        continue;
      }

      const payload: Record<string, unknown> = {
        dealer_id: dealerId,
        name,
        type,
        phone: str(row.phone) || null,
        email: str(row.email) || null,
        address: str(row.address) || null,
        credit_limit: num(row.credit_limit, 0),
        max_overdue_days: num(row.max_overdue_days, 0),
        opening_balance: num(row.opening_balance, 0),
        reference_name: str(row.reference_name) || null,
      };

      try {
        if (dup && mode === 'overwrite') {
          // opening_balance is created by trigger; do not overwrite on update
          const { opening_balance: _ob, ...updatePayload } = payload as any;
          await db('customers')
            .where({ dealer_id: dealerId })
            .andWhereRaw('LOWER(name) = ?', [name.toLowerCase()])
            .update(updatePayload);
        } else {
          await db('customers').insert(payload);
          existingNames.add(name.toLowerCase());
        }
        result.success++;
      } catch (e: any) {
        result.errors.push({ row: i + 2, field: 'Name', message: e.message || 'Insert failed' });
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error('[imports/customers]', err.message);
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

// ── POST /api/imports/suppliers ───────────────────────────────────────────
router.post('/suppliers', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  const mode = (req.body?.mode === 'overwrite' ? 'overwrite' : 'skip') as Mode;
  const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const result: ImportResult = { success: 0, skipped: 0, errors: [] };

  try {
    const existing = await db('suppliers').where({ dealer_id: dealerId }).select('name');
    const existingNames = new Set(existing.map((s: any) => String(s.name).toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const name = str(row.name);
      if (!name) { result.errors.push({ row: i + 2, field: 'Name', message: 'Missing' }); continue; }

      const dup = existingNames.has(name.toLowerCase());
      if (dup && mode === 'skip') { result.skipped++; continue; }

      const payload: Record<string, unknown> = {
        dealer_id: dealerId,
        name,
        contact_person: str(row.contact_person) || null,
        phone: str(row.phone) || null,
        email: str(row.email) || null,
        address: str(row.address) || null,
        gstin: str(row.gstin) || null,
        opening_balance: num(row.opening_balance, 0),
      };

      try {
        if (dup && mode === 'overwrite') {
          const { opening_balance: _ob, ...updatePayload } = payload as any;
          await db('suppliers')
            .where({ dealer_id: dealerId })
            .andWhereRaw('LOWER(name) = ?', [name.toLowerCase()])
            .update(updatePayload);
        } else {
          await db('suppliers').insert(payload);
          existingNames.add(name.toLowerCase());
        }
        result.success++;
      } catch (e: any) {
        result.errors.push({ row: i + 2, field: 'Name', message: e.message || 'Insert failed' });
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error('[imports/suppliers]', err.message);
    res.status(500).json({ error: 'Bulk import failed' });
  }
});

export default router;
