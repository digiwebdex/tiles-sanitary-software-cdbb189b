/**
 * Warehouse / Godown management.
 *
 *   GET    /api/warehouses              list
 *   POST   /api/warehouses              create
 *   PUT    /api/warehouses/:id          update
 *   DELETE /api/warehouses/:id          soft delete
 *   GET    /api/warehouses/transfers    list transfers (?from=&to=&warehouseId=)
 *   POST   /api/warehouses/transfers    create transfer (transport_cost → expense entry)
 *
 * dealer_admin only.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { applyWarehouseTransferStock } from '../services/warehouseTransferStock';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealer_id as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}
function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage warehouses' });
    return false;
  }
  return true;
}

const WarehouseSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(30).optional().nullable(),
  address: z.string().optional().nullable(),
  manager_name: z.string().max(120).optional().nullable(),
  manager_phone: z.string().max(30).optional().nullable(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

const TransferSchema = z.object({
  transfer_no: z.string().max(30).optional().nullable(),
  from_warehouse_id: z.string().uuid().optional().nullable(),
  to_warehouse_id: z.string().uuid().optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  product_name_snapshot: z.string().max(200).optional().nullable(),
  quantity: z.coerce.number().positive(),
  qty_sqft: z.coerce.number().min(0).default(0),
  unit: z.string().max(20).default('pc'),
  transport_cost: z.coerce.number().min(0).default(0),
  payment_method: z.enum(['cash', 'bank']).default('cash'),
  bank_account_id: z.string().uuid().optional().nullable(),
  transfer_date: z.string().optional(),
  notes: z.string().optional().nullable(),
});

router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('warehouses').where({ dealer_id: dealerId })
    .orderBy([{ column: 'is_active', order: 'desc' }, { column: 'is_default', order: 'desc' }, { column: 'name' }]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = WarehouseSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  if (p.data.is_default) {
    await db('warehouses').where({ dealer_id: dealerId }).update({ is_default: false });
  }
  const [row] = await db('warehouses').insert({ dealer_id: dealerId, ...p.data }).returning('*');
  res.status(201).json(row);
});

router.put('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = WarehouseSchema.partial().safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  if (p.data.is_default) {
    await db('warehouses').where({ dealer_id: dealerId }).whereNot({ id: req.params.id }).update({ is_default: false });
  }
  const [row] = await db('warehouses').where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...p.data, updated_at: db.fn.now() }).returning('*');
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  await db('warehouses').where({ id: req.params.id, dealer_id: dealerId })
    .update({ is_active: false, updated_at: db.fn.now() });
  res.status(204).end();
});

router.get('/transfers', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const wh = req.query.warehouseId as string | undefined;
  const q = db('warehouse_transfers as wt')
    .leftJoin('warehouses as wf', 'wf.id', 'wt.from_warehouse_id')
    .leftJoin('warehouses as wt2', 'wt2.id', 'wt.to_warehouse_id')
    .where('wt.dealer_id', dealerId)
    .select(
      'wt.*',
      'wf.name as from_warehouse_name',
      'wt2.name as to_warehouse_name',
    )
    .orderBy('wt.transfer_date', 'desc');
  if (from) q.where('wt.transfer_date', '>=', from);
  if (to) q.where('wt.transfer_date', '<=', to);
  if (wh) q.where(qb => qb.where('wt.from_warehouse_id', wh).orWhere('wt.to_warehouse_id', wh));
  const rows = await q;
  res.json(rows);
});

/** Post stock movement between warehouses when transfer completes. */
async function postTransferStock(trx: any, dealerId: string, userId: string | null, row: any) {
  if (!row.product_id || !row.from_warehouse_id || !row.to_warehouse_id) return;
  await applyWarehouseTransferStock(trx, {
    dealerId,
    fromWarehouseId: row.from_warehouse_id,
    toWarehouseId: row.to_warehouse_id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    unit: row.unit ?? 'pc',
    transferId: row.id,
    transferNo: row.transfer_no ?? null,
    userId,
  });
}

/** Internal helper: post transport_cost as cash/bank outflow */
async function postTransportCost(trx: any, dealerId: string, userId: string | null, row: any) {
  const cost = Number(row.transport_cost) || 0;
  if (cost <= 0) return;
  const desc = `Warehouse transfer ${row.transfer_no ?? row.id} transport`;
  if (row.payment_method === 'bank') {
    if (!row.bank_account_id) throw new Error('bank_account_id required for bank payment');
    await trx('bank_ledger').insert({
      dealer_id: dealerId, bank_account_id: row.bank_account_id,
      type: 'expense', amount: -cost, description: desc,
      reference_type: 'warehouse_transfer', reference_id: row.id,
      entry_date: row.transfer_date, created_by: userId,
    });
  } else {
    await trx('cash_ledger').insert({
      dealer_id: dealerId, type: 'expense', amount: -cost, description: desc,
      reference_type: 'warehouse_transfer', reference_id: row.id,
      entry_date: row.transfer_date, created_by: userId,
    });
  }
}

/** Immediate transfer — back-compat: creates row already in 'received' status and posts cost. */
router.post('/transfers', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = TransferSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }

  const trx = await db.transaction();
  try {
    const userId = req.user?.userId ?? null;
    const [row] = await trx('warehouse_transfers').insert({
      dealer_id: dealerId,
      transfer_no: p.data.transfer_no ?? null,
      from_warehouse_id: p.data.from_warehouse_id ?? null,
      to_warehouse_id: p.data.to_warehouse_id ?? null,
      product_id: p.data.product_id ?? null,
      product_name_snapshot: p.data.product_name_snapshot ?? null,
      quantity: p.data.quantity,
      qty_sqft: p.data.qty_sqft,
      unit: p.data.unit,
      transport_cost: p.data.transport_cost,
      payment_method: p.data.payment_method,
      bank_account_id: p.data.payment_method === 'bank' ? (p.data.bank_account_id ?? null) : null,
      transfer_date: p.data.transfer_date ?? trx.fn.now(),
      notes: p.data.notes ?? null,
      status: 'received',
      requested_by: userId, requested_at: trx.fn.now(),
      approved_by: userId, approved_at: trx.fn.now(),
      received_by: userId, received_at: trx.fn.now(),
      created_by: userId,
    }).returning('*');
    await postTransferStock(trx, dealerId, userId, row);
    await postTransportCost(trx, dealerId, userId, row);
    await trx.commit();
    res.status(201).json(row);
  } catch (e: any) {
    await trx.rollback();
    const msg = e.message || 'Transfer failed';
    const code = msg.includes('Insufficient') ? 400 : 500;
    res.status(code).json({ error: msg, code: msg.includes('Insufficient') ? 'INSUFFICIENT_WH_STOCK' : undefined });
  }
});

/** Request a transfer (no stock/cost yet). */
router.post('/transfers/request', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const p = TransferSchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.flatten() }); return; }
  const userId = req.user?.userId ?? null;
  const [row] = await db('warehouse_transfers').insert({
    dealer_id: dealerId,
    transfer_no: p.data.transfer_no ?? null,
    from_warehouse_id: p.data.from_warehouse_id ?? null,
    to_warehouse_id: p.data.to_warehouse_id ?? null,
    product_id: p.data.product_id ?? null,
    product_name_snapshot: p.data.product_name_snapshot ?? null,
    quantity: p.data.quantity,
    qty_sqft: p.data.qty_sqft,
    unit: p.data.unit,
    transport_cost: p.data.transport_cost,
    payment_method: p.data.payment_method,
    bank_account_id: p.data.payment_method === 'bank' ? (p.data.bank_account_id ?? null) : null,
    transfer_date: p.data.transfer_date ?? db.fn.now(),
    notes: p.data.notes ?? null,
    status: 'requested',
    requested_by: userId, requested_at: db.fn.now(),
    created_by: userId,
  }).returning('*');
  res.status(201).json(row);
});

/** Approve a requested transfer. dealer_admin only. */
router.post('/transfers/:id/approve', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const [row] = await db('warehouse_transfers')
    .where({ id: req.params.id, dealer_id: dealerId, status: 'requested' })
    .update({ status: 'approved', approved_by: req.user?.userId ?? null, approved_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Not found or not in requested state' }); return; }
  res.json(row);
});

/** Reject a requested/approved transfer. */
router.post('/transfers/:id/reject', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const reason = (req.body?.reason as string | undefined) ?? null;
  const [row] = await db('warehouse_transfers')
    .where({ id: req.params.id, dealer_id: dealerId })
    .whereIn('status', ['requested', 'approved'])
    .update({ status: 'rejected', reject_reason: reason })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Not found or cannot reject' }); return; }
  res.json(row);
});

/** Mark approved transfer as received (posts transport cost). */
router.post('/transfers/:id/receive', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const trx = await db.transaction();
  try {
    const userId = req.user?.userId ?? null;
    const [row] = await trx('warehouse_transfers')
      .where({ id: req.params.id, dealer_id: dealerId, status: 'approved' })
      .update({ status: 'received', received_by: userId, received_at: trx.fn.now() })
      .returning('*');
    if (!row) { await trx.rollback(); res.status(404).json({ error: 'Not found or not approved' }); return; }
    await postTransferStock(trx, dealerId, userId, row);
    await postTransportCost(trx, dealerId, userId, row);
    await trx.commit();
    res.json(row);
  } catch (e: any) {
    await trx.rollback();
    const msg = e.message || 'Receive failed';
    const code = msg.includes('Insufficient') ? 400 : 500;
    res.status(code).json({ error: msg, code: msg.includes('Insufficient') ? 'INSUFFICIENT_WH_STOCK' : undefined });
  }
});

export default router;
