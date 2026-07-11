/**
 * Purchase Request (PR) routes — V2 Sprint 5A (Supplier & Purchase Foundation).
 *
 *   GET    /api/purchase-requests?dealerId=&search=&status=&department=&page=
 *   GET    /api/purchase-requests/:id                (includes items)
 *   POST   /api/purchase-requests                    (create draft + items)
 *   PUT    /api/purchase-requests/:id                 (edit — draft only, replaces items)
 *   POST   /api/purchase-requests/:id/submit          (draft → pending_approval, assigns pr_number)
 *   POST   /api/purchase-requests/:id/approve         (dealer_admin; pending_approval → approved)
 *   POST   /api/purchase-requests/:id/reject          (dealer_admin; pending_approval → rejected)
 *   POST   /api/purchase-requests/:id/cancel          (draft/pending_approval → cancelled)
 *   DELETE /api/purchase-requests/:id                 (draft only)
 *
 * A genuinely new entity — no PR/requisition concept existed before this
 * sprint. Deliberately does NOT create a `purchases` row on approval:
 * Purchase Order creation from an approved PR is explicitly out of scope —
 * `status = 'approved'` simply records the outcome for a future sprint.
 * Line items may reference the existing Purchase Planning / Demand Planning
 * reorder suggestions via `source: 'reorder_suggestion'` (informational
 * tag only — this route never recomputes reorder math itself).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

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
  requested_qty: z.coerce.number().positive(),
  source: z.enum(['manual', 'reorder_suggestion']).default('manual'),
  notes: z.string().nullable().optional(),
});

const formSchema = z.object({
  department: z.string().trim().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

async function insertItems(
  trx: any,
  dealerId: string,
  purchaseRequestId: string,
  items: z.infer<typeof itemSchema>[],
) {
  const rows = items.map((it, idx) => ({
    dealer_id: dealerId,
    purchase_request_id: purchaseRequestId,
    product_id: it.product_id || null,
    product_name_snapshot: it.product_name_snapshot,
    requested_qty: it.requested_qty,
    source: it.source,
    notes: it.notes || null,
    sort_order: idx,
  }));
  await trx('purchase_request_items').insert(rows);
}

// ── GET /api/purchase-requests ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const page = Math.max(0, parseInt((req.query.page as string) || '0', 10));
    const search = ((req.query.search as string) || '').trim();
    const status = (req.query.status as string) || '';
    const department = (req.query.department as string) || '';

    let q = db('purchase_requests').where({ dealer_id: dealerId });
    if (status) q = q.andWhere({ status });
    if (department) q = q.andWhere({ department });
    if (search) {
      q = q.andWhere(function () {
        this.whereILike('pr_number', `%${search}%`).orWhereILike('department', `%${search}%`);
      });
    }

    const countQ = q.clone().clearSelect().count<{ count: string }[]>('* as count');
    const rowsQ = q
      .clone()
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const [countRow] = await countQ;
    const rows = await rowsQ;
    res.json({ rows, total: Number(countRow?.count ?? 0) });
  } catch (err: any) {
    console.error('[purchase-requests/list]', err.message);
    res.status(500).json({ error: 'Failed to list purchase requests' });
  }
});

// ── GET /api/purchase-requests/:id ──────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db('purchase_requests').where({ id: req.params.id, dealer_id: dealerId }).first();
    if (!row) {
      res.status(404).json({ error: 'Purchase request not found' });
      return;
    }
    const items = await db('purchase_request_items')
      .leftJoin('products', 'products.id', 'purchase_request_items.product_id')
      .where({ 'purchase_request_items.dealer_id': dealerId, purchase_request_id: req.params.id })
      .orderBy('sort_order', 'asc')
      .select(
        'purchase_request_items.*',
        'products.sku as product_sku',
        'products.unit_type as product_unit_type',
      );
    res.json({ ...row, items });
  } catch (err: any) {
    console.error('[purchase-requests/get]', err.message);
    res.status(500).json({ error: 'Failed to load purchase request' });
  }
});

// ── POST /api/purchase-requests ─────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { department, notes, items } = parsed.data;
    const requestedBy = req.user?.userId ?? null;

    const row = await db.transaction(async (trx) => {
      const [pr] = await trx('purchase_requests')
        .insert({
          dealer_id: dealerId,
          department: department || null,
          notes: notes || null,
          requested_by: requestedBy,
        })
        .returning('*');
      await insertItems(trx, dealerId, pr.id, items);
      return pr;
    });

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/create]', err.message);
    res.status(500).json({ error: 'Failed to create purchase request' });
  }
});

// ── PUT /api/purchase-requests/:id — edit (draft only) ──────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = formSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { department, notes, items } = parsed.data;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchase_requests')
        .where({ id: req.params.id, dealer_id: dealerId })
        .first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only draft purchase requests can be edited.');
      }

      const [pr] = await trx('purchase_requests')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({ department: department || null, notes: notes || null, updated_at: new Date() })
        .returning('*');

      await trx('purchase_request_items').where({ purchase_request_id: pr.id, dealer_id: dealerId }).delete();
      await insertItems(trx, dealerId, pr.id, items);
      return pr;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase request not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/update]', err.message);
    res.status(err.message?.includes('draft') ? 409 : 500).json({ error: err.message || 'Failed to update purchase request' });
  }
});

// ── POST /api/purchase-requests/:id/submit — draft → pending_approval ──────
router.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const row = await db.transaction(async (trx) => {
      const existing = await trx('purchase_requests')
        .where({ id: req.params.id, dealer_id: dealerId })
        .forUpdate()
        .first();
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw new Error('Only draft purchase requests can be submitted for approval.');
      }
      const itemCount = await trx('purchase_request_items')
        .where({ purchase_request_id: existing.id, dealer_id: dealerId })
        .count<{ count: string }[]>('* as count');
      if (Number(itemCount[0]?.count ?? 0) === 0) {
        throw new Error('Cannot submit a purchase request with no items.');
      }

      const numResult = await trx.raw('SELECT generate_next_purchase_request_no(?::uuid) AS no', [dealerId]);
      const prNumber = String(numResult.rows?.[0]?.no ?? '');

      const [pr] = await trx('purchase_requests')
        .where({ id: existing.id, dealer_id: dealerId })
        .update({ status: 'pending_approval', pr_number: prNumber, updated_at: new Date() })
        .returning('*');
      return pr;
    });

    if (!row) {
      res.status(404).json({ error: 'Purchase request not found' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/submit]', err.message);
    res.status(err.message?.includes('draft') || err.message?.includes('no items') ? 409 : 500)
      .json({ error: err.message || 'Failed to submit purchase request' });
  }
});

// ── POST /api/purchase-requests/:id/approve — dealer_admin only ────────────
router.post('/:id/approve', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const approvedBy = req.user?.userId ?? null;

    const [row] = await db('purchase_requests')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'pending_approval' })
      .update({ status: 'approved', approved_by: approvedBy, approved_at: new Date(), updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a pending-approval purchase request can be approved.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/approve]', err.message);
    res.status(500).json({ error: 'Failed to approve purchase request' });
  }
});

// ── POST /api/purchase-requests/:id/reject — dealer_admin only ─────────────
const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'A rejection reason is required').max(1000),
});

router.post('/:id/reject', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const rejectedBy = req.user?.userId ?? null;

    const [row] = await db('purchase_requests')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'pending_approval' })
      .update({
        status: 'rejected',
        rejected_by: rejectedBy,
        rejected_at: new Date(),
        rejection_reason: parsed.data.reason,
        updated_at: new Date(),
      })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Only a pending-approval purchase request can be rejected.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/reject]', err.message);
    res.status(500).json({ error: 'Failed to reject purchase request' });
  }
});

// ── POST /api/purchase-requests/:id/cancel ──────────────────────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const [row] = await db('purchase_requests')
      .where({ id: req.params.id, dealer_id: dealerId })
      .whereIn('status', ['draft', 'pending_approval'])
      .update({ status: 'cancelled', updated_at: new Date() })
      .returning('*');

    if (!row) {
      res.status(409).json({ error: 'Purchase request cannot be cancelled in its current state.' });
      return;
    }
    res.json({ row });
  } catch (err: any) {
    console.error('[purchase-requests/cancel]', err.message);
    res.status(500).json({ error: 'Failed to cancel purchase request' });
  }
});

// ── DELETE /api/purchase-requests/:id — draft only ──────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const deleted = await db('purchase_requests')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'draft' })
      .delete();

    if (!deleted) {
      res.status(409).json({ error: 'Only a draft purchase request can be deleted.' });
      return;
    }
    res.status(204).end();
  } catch (err: any) {
    console.error('[purchase-requests/delete]', err.message);
    res.status(500).json({ error: 'Failed to delete purchase request' });
  }
});

export default router;
