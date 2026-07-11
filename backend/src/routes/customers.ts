/**
 * Customers REST routes — Phase 3C.
 *
 * Mirrors the suppliers route pattern exactly:
 *   GET    /api/customers?dealerId=&page=&pageSize=&search=&orderBy=&orderDir=&f.<col>=
 *   GET    /api/customers/:id?dealerId=
 *   POST   /api/customers           body: { dealerId, data }
 *   PATCH  /api/customers/:id       body: { dealerId, data }
 *   DELETE /api/customers/:id?dealerId=
 *
 * Safety:
 *   - authenticate JWT (Phase 1 auth backend)
 *   - tenantGuard ensures req.dealerId is resolved (or null for super_admin)
 *   - Every query is scoped to dealer_id; super_admin must pass an explicit dealerId.
 *   - List response shape: { rows, total }
 *   - Single-row response shape: { row }
 *
 * Phase 3C is read-only in practice: writes work but the frontend only
 * uses GET via shadow mode. Writes still go to Supabase.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();

const TABLE = 'customers';

// Whitelisted to prevent SQL injection through ?orderBy=
const SORTABLE = new Set([
  'name',
  'created_at',
  'status',
  'type',
  'opening_balance',
  'credit_limit',
  'max_overdue_days',
]);

// Equality filters via ?f.<col>=
const FILTERABLE = new Set(['status', 'type', 'name', 'price_tier_id', 'customer_group']);

// Columns the frontend may write (everything else is rejected)
const WRITABLE = new Set([
  'name',
  'type',
  'phone',
  'email',
  'address',
  'reference_name',
  'opening_balance',
  'status',
  'credit_limit',
  'max_overdue_days',
  'price_tier_id',
  'tax_id',
  // V2 Sprint 4A
  'customer_group',
  'default_discount_type',
  'default_discount_value',
]);

// V2 Sprint 4A — extended with Dealer/Contractor/Builder/Corporate Customer
// (migration 089, additive ALTER TYPE — the original 3 values are unchanged).
const CUSTOMER_TYPES = ['retailer', 'customer', 'project', 'dealer', 'contractor', 'builder', 'corporate'] as const;

const customerWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  reference_name: z.string().trim().max(255).nullable().optional(),
  opening_balance: z.number().finite().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  credit_limit: z.number().finite().min(0).optional(),
  max_overdue_days: z.number().int().min(0).optional(),
  price_tier_id: z.string().uuid().nullable().optional(),
  tax_id: z.string().trim().max(50).nullable().optional(),
  // V2 Sprint 4A — Customer Group (free-form label) + Customer Discount Policy
  // (a default hint for quotations, not an enforced discount).
  customer_group: z.string().trim().max(100).nullable().optional(),
  default_discount_type: z.enum(['flat', 'percent']).nullable().optional(),
  default_discount_value: z.number().finite().min(0).optional(),
});

function resolveDealerScope(req: Request, res: Response): string | null {
  const isSuperAdmin = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined);

  if (isSuperAdmin) {
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

router.use(authenticate, tenantGuard);

// ── GET /api/customers ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt((req.query.pageSize as string) || '25', 10)),
    );
    const search = ((req.query.search as string) || '').trim();
    const orderBy = (req.query.orderBy as string) || 'name';
    const orderDir = ((req.query.orderDir as string) || 'asc').toLowerCase();

    let q = db(TABLE).where({ dealer_id: dealerId });

    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('f.')) continue;
      const col = key.slice(2);
      if (!FILTERABLE.has(col)) continue;
      q = q.andWhere(col, value as string);
    }

    if (search) {
      q = q.andWhere(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('phone', `%${search}%`)
          .orWhereILike('reference_name', `%${search}%`);
      });
    }

    const countQ = q
      .clone()
      .clearOrder()
      .clearSelect()
      .count<{ count: string }[]>('* as count');

    const sortCol = SORTABLE.has(orderBy) ? orderBy : 'name';
    const sortDir = orderDir === 'desc' ? 'desc' : 'asc';

    const rowsQ = q
      .clone()
      .select('*')
      .orderBy(sortCol, sortDir)
      .offset(page * pageSize)
      .limit(pageSize);

    const [countRow] = await countQ;
    const rows = await rowsQ;

    res.json({
      rows,
      total: Number(countRow?.count ?? 0),
    });
  } catch (err: any) {
    console.error('[customers/list]', err.message);
    res.status(500).json({ error: 'Failed to list customers' });
  }
});

// ── GET /api/customers/:id ─────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const row = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();

    if (!row) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[customers/get]', err.message);
    res.status(500).json({ error: 'Failed to load customer' });
  }
});

// ── POST /api/customers ────────────────────────────────────────────────────
router.post('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = customerWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    if (!parsed.data.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const payload: Record<string, unknown> = { dealer_id: dealerId };
    for (const k of Object.keys(parsed.data)) {
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }

    const [row] = await db(TABLE).insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A customer with this name already exists.' });
      return;
    }
    console.error('[customers/create]', err.message);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// ── PATCH /api/customers/:id ───────────────────────────────────────────────
router.patch('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = customerWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const k of Object.keys(parsed.data)) {
      // opening_balance is intentionally NOT editable post-creation (matches existing service)
      if (k === 'opening_balance') continue;
      if (WRITABLE.has(k)) payload[k] = (parsed.data as any)[k];
    }

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'No editable fields supplied' });
      return;
    }

    const [row] = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .update(payload)
      .returning('*');

    if (!row) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A customer with this name already exists.' });
      return;
    }
    console.error('[customers/update]', err.message);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// ── DELETE /api/customers/:id ──────────────────────────────────────────────
router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const deleted = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .delete();

    if (!deleted) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[customers/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

export default router;
