/**
 * Sample Issues route — Phase 3U-15.
 *
 *   GET    /api/sample-issues?dealerId=&status=
 *   POST   /api/sample-issues/issue                       deduct sellable + insert (atomic)
 *   POST   /api/sample-issues/:id/return                  partial/full return + restock (atomic)
 *   POST   /api/sample-issues/:id/lost                    mark lost (atomic)
 *   GET    /api/sample-issues/dashboard-stats?dealerId=
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Knex } from 'knex';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { adjustSellableStock } from '../services/sellableStockAdjust';

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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage samples' });
    return false;
  }
  return true;
}

async function writeAudit(
  trx: Knex.Transaction | Knex,
  req: Request,
  dealerId: string,
  action: string,
  table: string,
  recordId: string | null,
  oldData: any,
  newData: any,
) {
  try {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers['user-agent'] as string) || null;
    await trx('audit_logs').insert({
      dealer_id: dealerId,
      user_id: req.user?.userId ?? null,
      action,
      table_name: table,
      record_id: recordId,
      old_data: oldData,
      new_data: newData,
      ip_address: ip,
      user_agent: ua,
    });
  } catch (e: any) {
    console.warn('[sample-issues:audit]', e.message);
  }
}

async function adjustProductStock(
  trx: Knex.Transaction,
  dealerId: string,
  productId: string,
  quantity: number,
  type: 'add' | 'deduct',
  txnType: string,
  userId: string | null,
  referenceId?: string | null,
) {
  await adjustSellableStock(trx, {
    dealerId,
    productId,
    quantity,
    type,
    userId,
    txnType,
    referenceTable: 'sample_issues',
    referenceId: referenceId ?? null,
  });
}

async function fetchSampleWithJoins(trx: Knex.Transaction | Knex, id: string) {
  const raw = await trx('sample_issues as si')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .leftJoin('customers as c', 'c.id', 'si.customer_id')
    .where('si.id', id)
    .first(
      'si.*',
      'p.name as p_name',
      'p.sku as p_sku',
      'p.unit_type as p_unit_type',
      'c.name as c_name',
    );
  if (!raw) return null;
  const { p_name, p_sku, p_unit_type, c_name, ...rest } = raw as any;
  return {
    ...rest,
    product: p_name ? { name: p_name, sku: p_sku, unit_type: p_unit_type } : null,
    customer: c_name ? { name: c_name } : null,
  };
}

// List
router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const status = req.query.status as string | undefined;
    let q = db('sample_issues as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .leftJoin('customers as c', 'c.id', 'si.customer_id')
      .where('si.dealer_id', dealerId)
      .orderBy('si.issue_date', 'desc')
      .select(
        'si.*',
        'p.name as p_name',
        'p.sku as p_sku',
        'p.unit_type as p_unit_type',
        'c.name as c_name',
      );
    if (status) q = q.where('si.status', status);
    const raw = await q;
    const rows = raw.map((r: any) => {
      const { p_name, p_sku, p_unit_type, c_name, ...rest } = r;
      return {
        ...rest,
        product: p_name ? { name: p_name, sku: p_sku, unit_type: p_unit_type } : null,
        customer: c_name ? { name: c_name } : null,
      };
    });
    res.json({ rows });
  } catch (e: any) {
    console.error('[sample-issues GET]', e.message);
    res.status(500).json({ error: 'Failed to load samples' });
  }
});

const issueSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive(),
  recipient_type: z.enum(['customer', 'architect', 'contractor', 'mason', 'other']),
  recipient_name: z.string().trim().min(1),
  recipient_phone: z.string().trim().max(50).optional(),
  customer_id: z.string().uuid().optional(),
  expected_return_date: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

router.post('/issue', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const input = parsed.data;
    const result = await db.transaction(async (trx) => {
      await adjustProductStock(
        trx,
        dealerId,
        input.product_id,
        input.quantity,
        'deduct',
        'sample_issue',
        req.user?.userId ?? null,
      );
      const [row] = await trx('sample_issues')
        .insert({
          dealer_id: dealerId,
          product_id: input.product_id,
          quantity: input.quantity,
          recipient_type: input.recipient_type,
          recipient_name: input.recipient_name.trim(),
          recipient_phone: input.recipient_phone?.trim() || null,
          customer_id: input.customer_id || null,
          expected_return_date: input.expected_return_date || null,
          notes: input.notes?.trim() || null,
          status: 'issued',
          created_by: req.user?.userId ?? null,
        })
        .returning('*');
      await writeAudit(trx, req, dealerId, 'sample_issued', 'sample_issues', row.id, null, input);
      return row;
    });
    const enriched = await fetchSampleWithJoins(db, result.id);
    res.status(201).json({ row: enriched });
  } catch (e: any) {
    console.error('[sample-issues/issue]', e.message);
    res.status(400).json({ error: e.message || 'Failed to issue sample' });
  }
});

const returnSchema = z.object({
  return_qty: z.number().positive(),
  return_to: z.enum(['sellable', 'display', 'damaged']),
  notes: z.string().trim().max(2000).optional(),
});

router.post('/:id/return', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = returnSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { return_qty, return_to, notes } = parsed.data;
    const updatedId = await db.transaction(async (trx) => {
      const sample = await trx('sample_issues')
        .where({ id: req.params.id, dealer_id: dealerId })
        .forUpdate()
        .first();
      if (!sample) throw new Error('Sample not found');
      if (sample.status === 'returned' || sample.status === 'lost')
        throw new Error(`Sample is already ${sample.status}`);
      const remaining =
        Number(sample.quantity) -
        Number(sample.returned_qty) -
        Number(sample.damaged_qty) -
        Number(sample.lost_qty);
      if (return_qty > remaining)
        throw new Error(`Cannot return ${return_qty} — only ${remaining} outstanding`);

      if (return_to === 'sellable') {
        await adjustProductStock(
          trx,
          dealerId,
          sample.product_id,
          return_qty,
          'add',
          'sample_return',
          req.user?.userId ?? null,
          sample.id,
        );
      } else if (return_to === 'display') {
        const dRow = await trx('display_stock')
          .where({ dealer_id: dealerId, product_id: sample.product_id })
          .forUpdate()
          .first();
        if (dRow) {
          await trx('display_stock')
            .where({ id: dRow.id })
            .update({
              display_qty: Number(dRow.display_qty) + return_qty,
              updated_at: trx.fn.now(),
            });
        } else {
          await trx('display_stock').insert({
            dealer_id: dealerId,
            product_id: sample.product_id,
            display_qty: return_qty,
          });
        }
        await trx('display_movements').insert({
          dealer_id: dealerId,
          product_id: sample.product_id,
          movement_type: 'to_display',
          quantity: return_qty,
          notes: `Sample return → display: ${notes ?? ''}`,
          created_by: req.user?.userId ?? null,
        });
      }
      // 'damaged' → no stock action

      const newReturned =
        return_to === 'damaged'
          ? Number(sample.returned_qty)
          : Number(sample.returned_qty) + return_qty;
      const newDamaged =
        return_to === 'damaged'
          ? Number(sample.damaged_qty) + return_qty
          : Number(sample.damaged_qty);
      const totalSettled = newReturned + newDamaged + Number(sample.lost_qty);
      const newStatus = totalSettled >= Number(sample.quantity) ? 'returned' : 'partially_returned';

      await trx('sample_issues')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({
          returned_qty: newReturned,
          damaged_qty: newDamaged,
          status: newStatus,
          returned_date:
            newStatus === 'returned'
              ? new Date().toISOString().slice(0, 10)
              : sample.returned_date,
          notes: notes
            ? `${sample.notes ? sample.notes + '\n' : ''}[Return ${return_to}] ${notes}`
            : sample.notes,
          updated_at: trx.fn.now(),
        });

      await writeAudit(
        trx, req, dealerId, `sample_return_${return_to}`,
        'sample_issues', req.params.id,
        { status: sample.status, returned_qty: sample.returned_qty, damaged_qty: sample.damaged_qty },
        { return_qty, return_to, new_status: newStatus, notes },
      );
      return req.params.id;
    });
    const enriched = await fetchSampleWithJoins(db, updatedId);
    res.json({ row: enriched });
  } catch (e: any) {
    console.error('[sample-issues/return]', e.message);
    res.status(400).json({ error: e.message || 'Failed to return sample' });
  }
});

const lostSchema = z.object({
  lost_qty: z.number().positive(),
  reason: z.string().trim().min(1),
});

router.post('/:id/lost', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = lostSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { lost_qty, reason } = parsed.data;
    const updatedId = await db.transaction(async (trx) => {
      const sample = await trx('sample_issues')
        .where({ id: req.params.id, dealer_id: dealerId })
        .forUpdate()
        .first();
      if (!sample) throw new Error('Sample not found');
      const remaining =
        Number(sample.quantity) -
        Number(sample.returned_qty) -
        Number(sample.damaged_qty) -
        Number(sample.lost_qty);
      if (lost_qty > remaining)
        throw new Error(`Cannot mark ${lost_qty} lost — only ${remaining} outstanding`);
      const newLost = Number(sample.lost_qty) + lost_qty;
      const totalSettled = Number(sample.returned_qty) + Number(sample.damaged_qty) + newLost;
      const newStatus =
        totalSettled >= Number(sample.quantity)
          ? newLost === Number(sample.quantity)
            ? 'lost'
            : 'returned'
          : 'partially_returned';
      await trx('sample_issues')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update({
          lost_qty: newLost,
          status: newStatus,
          notes: `${sample.notes ? sample.notes + '\n' : ''}[Lost] ${reason}`,
          updated_at: trx.fn.now(),
        });
      await writeAudit(
        trx, req, dealerId, 'sample_marked_lost', 'sample_issues', req.params.id,
        { lost_qty: sample.lost_qty, status: sample.status },
        { lost_qty, reason, new_status: newStatus },
      );
      return req.params.id;
    });
    const enriched = await fetchSampleWithJoins(db, updatedId);
    res.json({ row: enriched });
  } catch (e: any) {
    console.error('[sample-issues/lost]', e.message);
    res.status(400).json({ error: e.message || 'Failed to mark lost' });
  }
});

router.get('/dashboard-stats', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const samples = await db('sample_issues')
      .where({ dealer_id: dealerId })
      .select('status', 'quantity', 'returned_qty', 'damaged_qty', 'lost_qty', 'issue_date');
    const display = await db('display_stock')
      .where({ dealer_id: dealerId })
      .select('display_qty');

    const outstanding = samples.filter(
      (s: any) => s.status === 'issued' || s.status === 'partially_returned',
    );
    const totalDisplayQty = display.reduce((sum: number, d: any) => sum + Number(d.display_qty), 0);
    const damagedLostCount = samples.filter(
      (s: any) =>
        s.status === 'damaged' ||
        s.status === 'lost' ||
        Number(s.damaged_qty) > 0 ||
        Number(s.lost_qty) > 0,
    ).length;
    const oldest = outstanding
      .slice()
      .sort((a: any, b: any) => (a.issue_date < b.issue_date ? -1 : 1))[0];
    const oldestDays = oldest
      ? Math.floor((Date.now() - new Date(oldest.issue_date).getTime()) / 86_400_000)
      : 0;
    res.json({
      outstandingSamples: outstanding.length,
      totalDisplayQty,
      damagedLostCount,
      oldestOutstandingDays: oldestDays,
      oldestOutstandingDate: oldest?.issue_date ?? null,
    });
  } catch (e: any) {
    console.error('[sample-issues/dashboard-stats]', e.message);
    res.status(500).json({ error: 'Failed to load sample stats' });
  }
});

export default router;
