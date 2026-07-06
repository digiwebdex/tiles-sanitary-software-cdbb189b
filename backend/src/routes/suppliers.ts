/**
 * Suppliers REST routes — Phase 3A.
 *
 * Contract (matches src/lib/data/vpsAdapter.ts):
 *   GET    /api/suppliers?dealerId=&page=&pageSize=&search=&orderBy=&orderDir=&f.<col>=
 *   GET    /api/suppliers/:id?dealerId=
 *   POST   /api/suppliers           body: { dealerId, data }
 *   PATCH  /api/suppliers/:id       body: { dealerId, data }
 *   DELETE /api/suppliers/:id?dealerId=
 *
 * Safety:
 *   - authenticate JWT
 *   - tenantGuard ensures req.dealerId is resolved (or null for super_admin)
 *   - Every query is scoped to dealer_id; super_admin may pass an explicit dealerId.
 *   - List response shape: { rows, total }
 *   - Single-row response shape: { row }
 *
 * Phase 3A is intentionally read-heavy: writes work but the frontend only
 * uses GET via shadow mode. No existing module is rewired in this phase.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { computeSupplierBalance, computeSupplierOutstanding } from '../lib/ledgerBalance';

const router = Router();

const TABLE = 'suppliers';

// Columns the frontend may sort by (whitelisted to prevent SQL injection)
const SORTABLE = new Set([
  'name',
  'created_at',
  'status',
  'opening_balance',
  'contact_person',
  // V2 Sprint 5A
  'category',
  'supplier_group',
  'credit_limit',
]);

// Columns the frontend may filter by (equality only)
const FILTERABLE = new Set(['status', 'name', 'category', 'supplier_group']);

// Columns the frontend may write (everything else is rejected)
const WRITABLE = new Set([
  'name',
  'contact_person',
  'phone',
  'email',
  'address',
  'gstin',
  'opening_balance',
  'status',
  // V2 Sprint 5A — additive, mirrors customers' category_group_discount fields
  'category',
  'supplier_group',
  'credit_limit',
]);

const supplierWriteSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  contact_person: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  gstin: z.string().trim().max(50).nullable().optional(),
  opening_balance: z.number().finite().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  // V2 Sprint 5A
  category: z.string().trim().max(100).nullable().optional(),
  supplier_group: z.string().trim().max(100).nullable().optional(),
  credit_limit: z.number().finite().min(0).optional(),
});

/**
 * Resolve the effective dealer scope for the current request.
 * Returns the dealerId that ALL queries must be scoped to.
 *
 * - Dealer users: always their own dealerId (cannot be overridden).
 * - Super admin: must explicitly provide a dealerId via query/body.
 */
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

  // Dealer user: ignore claimed value, use bound dealerId
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

// All routes require auth + tenant resolution
router.use(authenticate, tenantGuard);

// ── GET /api/suppliers ─────────────────────────────────────────────────────
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

    // Equality filters via f.<col>=value
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('f.')) continue;
      const col = key.slice(2);
      if (!FILTERABLE.has(col)) continue;
      q = q.andWhere(col, value as string);
    }

    if (search) {
      q = q.andWhere(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('contact_person', `%${search}%`)
          .orWhereILike('phone', `%${search}%`);
      });
    }

    const countQ = q.clone().clearOrder().clearSelect().count<{ count: string }[]>('* as count');

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
    console.error('[suppliers/list]', err.message);
    res.status(500).json({ error: 'Failed to list suppliers' });
  }
});

// ── GET /api/suppliers/:id ─────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const row = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .first();

    if (!row) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[suppliers/get]', err.message);
    res.status(500).json({ error: 'Failed to load supplier' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Supplier Ledger Summary (V2 Sprint 5A)
// Reuses supplier_ledger + the existing computeSupplierBalance/
// computeSupplierOutstanding pure functions (backend/src/lib/ledgerBalance.ts,
// already relied on elsewhere) rather than re-deriving balance math. No new
// table — this only assembles data that already exists.
// ─────────────────────────────────────────────────────────────────────────

// ── GET /api/suppliers/:id/ledger-summary ──────────────────────────────────
router.get('/:id/ledger-summary', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const supplier = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .first('id', 'name', 'opening_balance');
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }

    const rows = await db('supplier_ledger')
      .where({ dealer_id: dealerId, supplier_id: req.params.id })
      .orderBy('entry_date', 'asc')
      .orderBy('created_at', 'asc')
      .select('id', 'type', 'amount', 'description', 'entry_date', 'purchase_id', 'created_at');

    const outstanding = computeSupplierOutstanding(rows);
    const balance = computeSupplierBalance(rows);

    const totalPurchased = rows
      .filter((r) => r.type === 'purchase')
      .reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0);
    const totalPaid = rows
      .filter((r) => r.type === 'payment')
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    res.json({
      supplier: { id: supplier.id, name: supplier.name, opening_balance: Number(supplier.opening_balance) || 0 },
      outstanding,
      balance,
      total_purchased: Math.round(totalPurchased * 100) / 100,
      total_paid: Math.round(totalPaid * 100) / 100,
      entries: rows,
    });
  } catch (err: any) {
    console.error('[suppliers/ledger-summary]', err.message);
    res.status(500).json({ error: 'Failed to load supplier ledger summary' });
  }
});

// ── POST /api/suppliers ────────────────────────────────────────────────────
router.post('/', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = supplierWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
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
      res.status(409).json({ error: 'A supplier with this name already exists.' });
      return;
    }
    console.error('[suppliers/create]', err.message);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

// ── PATCH /api/suppliers/:id ───────────────────────────────────────────────
router.patch('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = supplierWriteSchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
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
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'A supplier with this name already exists.' });
      return;
    }
    console.error('[suppliers/update]', err.message);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// ── DELETE /api/suppliers/:id ──────────────────────────────────────────────
router.delete('/:id', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const deleted = await db(TABLE)
      .where({ id: req.params.id, dealer_id: dealerId })
      .delete();

    if (!deleted) {
      res.status(404).json({ error: 'Supplier not found' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[suppliers/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Supplier Notes (Phase 3U-11)
// Internal owner/admin advisory notes — does NOT affect reliability score.
// Endpoints:
//   GET    /api/suppliers/:id/notes
//   POST   /api/suppliers/:id/notes        body: { note }
//   PATCH  /api/suppliers/:id/notes/:noteId body: { note }
//   DELETE /api/suppliers/:id/notes/:noteId
// ─────────────────────────────────────────────────────────────────────────

const NOTES_TABLE = 'supplier_notes';

const noteWriteSchema = z.object({
  note: z.string().trim().min(1, 'Note cannot be empty').max(2000, 'Note must be under 2000 characters'),
});

async function writeAudit(req: Request, dealerId: string, action: string, recordId: string, oldData: any, newData: any) {
  try {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers['user-agent'] as string) || null;
    await db('audit_logs').insert({
      dealer_id: dealerId,
      user_id: req.user?.userId ?? null,
      action,
      table_name: NOTES_TABLE,
      record_id: recordId,
      old_data: oldData,
      new_data: newData,
      ip_address: ip,
      user_agent: ua,
    });
  } catch (e: any) {
    console.warn('[supplier-notes:audit]', e.message);
  }
}

// Owner/admin only — these are private internal notes.
router.get('/:id/notes', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const rows = await db(NOTES_TABLE)
      .where({ dealer_id: dealerId, supplier_id: req.params.id })
      .orderBy('updated_at', 'desc');
    res.json({ rows });
  } catch (err: any) {
    console.error('[supplier-notes/list]', err.message);
    res.status(500).json({ error: 'Failed to load supplier notes' });
  }
});

router.post('/:id/notes', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const userId = req.user?.userId ?? null;
    const [row] = await db(NOTES_TABLE)
      .insert({
        dealer_id: dealerId,
        supplier_id: req.params.id,
        note: parsed.data.note,
        created_by: userId,
        updated_by: userId,
      })
      .returning('*');
    await writeAudit(req, dealerId, 'create', row.id, null, { supplier_id: req.params.id, note: parsed.data.note });
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[supplier-notes/create]', err.message);
    res.status(500).json({ error: 'Failed to create supplier note' });
  }
});

router.patch('/:id/notes/:noteId', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const parsed = noteWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const existing = await db(NOTES_TABLE)
      .where({ id: req.params.noteId, dealer_id: dealerId, supplier_id: req.params.id })
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    const [row] = await db(NOTES_TABLE)
      .where({ id: req.params.noteId, dealer_id: dealerId })
      .update({ note: parsed.data.note, updated_by: req.user?.userId ?? null, updated_at: new Date() })
      .returning('*');
    await writeAudit(req, dealerId, 'update', req.params.noteId, { note: existing.note }, { note: parsed.data.note });
    res.json({ row });
  } catch (err: any) {
    console.error('[supplier-notes/update]', err.message);
    res.status(500).json({ error: 'Failed to update supplier note' });
  }
});

router.delete('/:id/notes/:noteId', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const existing = await db(NOTES_TABLE)
      .where({ id: req.params.noteId, dealer_id: dealerId, supplier_id: req.params.id })
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    await db(NOTES_TABLE).where({ id: req.params.noteId, dealer_id: dealerId }).delete();
    await writeAudit(req, dealerId, 'delete', req.params.noteId, { note: existing.note, supplier_id: existing.supplier_id }, null);
    res.status(204).end();
  } catch (err: any) {
    console.error('[supplier-notes/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete supplier note' });
  }
});

export default router;
