/**
 * Dealer operational settings — VPS tenant API.
 *
 *   GET   /api/dealer-settings?dealerId=
 *   PATCH /api/dealer-settings              body: { dealerId?, allow_backorder?, ... }
 *
 * Replaces Supabase direct writes on Settings page (allow_backorder, wastage, dual-unit).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

const SELECT_FIELDS = [
  'id',
  'name',
  'phone',
  'address',
  'challan_template',
  'allow_backorder',
  'default_wastage_pct',
  'dual_unit_enabled',
  'vat_enabled',
  'default_vat_rate',
  'tax_id',
  'menu_mode',
] as const;

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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can change dealer settings' });
    return false;
  }
  return true;
}

const patchSchema = z.object({
  dealerId: z.string().uuid().optional(),
  allow_backorder: z.boolean().optional(),
  default_wastage_pct: z.coerce.number().min(0).max(25).optional(),
  dual_unit_enabled: z.boolean().optional(),
  vat_enabled: z.boolean().optional(),
  default_vat_rate: z.coerce.number().min(0).max(100).optional(),
  menu_mode: z.enum(['simple', 'advanced']).optional(),
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db('dealers').where({ id: dealerId }).first(SELECT_FIELDS);
    if (!row) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    res.json({
      dealer: {
        ...row,
        allow_backorder: row.allow_backorder === true,
        dual_unit_enabled: row.dual_unit_enabled === true,
        default_wastage_pct: Number(row.default_wastage_pct ?? 10),
        vat_enabled: row.vat_enabled === true,
        default_vat_rate: Number(row.default_vat_rate ?? 15),
        tax_id: row.tax_id ?? null,
        menu_mode: row.menu_mode === 'simple' ? 'simple' : 'advanced',
        enable_reservations: false,
      },
    });
  } catch (err: any) {
    console.error('[dealer-settings GET]', err.message);
    res.status(500).json({ error: 'Failed to load dealer settings' });
  }
});

router.patch('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;

    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const patch: Record<string, unknown> = { updated_at: db.fn.now() };
    if (parsed.data.allow_backorder !== undefined) {
      patch.allow_backorder = parsed.data.allow_backorder;
    }
    if (parsed.data.default_wastage_pct !== undefined) {
      patch.default_wastage_pct = parsed.data.default_wastage_pct;
    }
    if (parsed.data.dual_unit_enabled !== undefined) {
      patch.dual_unit_enabled = parsed.data.dual_unit_enabled;
    }
    if (parsed.data.vat_enabled !== undefined) {
      patch.vat_enabled = parsed.data.vat_enabled;
    }
    if (parsed.data.default_vat_rate !== undefined) {
      patch.default_vat_rate = parsed.data.default_vat_rate;
    }
    if (parsed.data.menu_mode !== undefined) {
      patch.menu_mode = parsed.data.menu_mode;
    }

    if (Object.keys(patch).length <= 1) {
      res.status(400).json({ error: 'No settings to update' });
      return;
    }

    const updated = await db('dealers')
      .where({ id: dealerId })
      .update(patch)
      .returning(SELECT_FIELDS);

    if (!updated.length) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const row = updated[0];
    res.json({
      dealer: {
        ...row,
        allow_backorder: row.allow_backorder === true,
        dual_unit_enabled: row.dual_unit_enabled === true,
        default_wastage_pct: Number(row.default_wastage_pct ?? 10),
        vat_enabled: row.vat_enabled === true,
        default_vat_rate: Number(row.default_vat_rate ?? 15),
        tax_id: row.tax_id ?? null,
        menu_mode: row.menu_mode === 'simple' ? 'simple' : 'advanced',
        enable_reservations: false,
      },
    });
  } catch (err: any) {
    console.error('[dealer-settings PATCH]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save dealer settings' });
  }
});

export default router;
