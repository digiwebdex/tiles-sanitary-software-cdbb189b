/**
 * Phase 3 Reports — Salary History, Director Statement, Warehouse Stock.
 *
 *   GET /api/reports/salary-history?dealerId=&employee_id=&from=&to=
 *   GET /api/reports/director-statement?dealerId=&director_id=&from=&to=
 *   GET /api/reports/warehouse-stock?dealerId=
 *
 * dealer_admin only (super_admin via dealerId param).
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = req.query.dealerId as string | undefined;
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
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

const num = (v: any) => Number(v ?? 0) || 0;

// ── Salary history ──
router.get('/salary-history', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const employeeId = req.query.employee_id as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const q = db('salary_payments as sp')
    .leftJoin('employees as e', 'e.id', 'sp.employee_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'sp.bank_account_id')
    .where('sp.dealer_id', dealerId)
    .modify(qb => {
      if (employeeId) qb.where('sp.employee_id', employeeId);
      if (from) qb.where('sp.payment_date', '>=', from);
      if (to) qb.where('sp.payment_date', '<=', to);
    })
    .orderBy('sp.payment_date', 'desc')
    .select(
      'sp.*',
      'e.name as employee_name',
      'e.designation',
      'e.employee_code',
      'ba.bank_name',
      'ba.account_number',
    );

  const rows = await q;
  const total = rows.reduce((s: number, r: any) => s + num(r.net_payable), 0);
  res.json({ rows, total, count: rows.length });
});

// ── Director statement ──
router.get('/director-statement', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const directorId = req.query.director_id as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const q = db('director_transactions as dt')
    .join('directors as d', 'd.id', 'dt.director_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'dt.bank_account_id')
    .where('dt.dealer_id', dealerId)
    .modify(qb => {
      if (directorId) qb.where('dt.director_id', directorId);
      if (from) qb.where('dt.entry_date', '>=', from);
      if (to) qb.where('dt.entry_date', '<=', to);
    })
    .orderBy('dt.entry_date', 'desc')
    .select(
      'dt.*',
      'd.name as director_name',
      'd.role as director_role',
      'd.share_pct',
      'ba.bank_name',
      'ba.account_number',
    );

  const rows = await q;
  let deposits = 0, withdrawals = 0, dividends = 0;
  for (const r of rows as any[]) {
    const a = num(r.amount);
    if (r.type === 'deposit') deposits += a;
    else if (r.type === 'withdrawal') withdrawals += a;
    else if (r.type === 'dividend') dividends += a;
  }
  res.json({
    rows,
    summary: {
      deposits,
      withdrawals,
      dividends,
      net_capital: deposits - withdrawals - dividends,
      count: rows.length,
    },
  });
});

// ── Stock movements (P3-05) ──
router.get('/stock-movements', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
  const offset = (page - 1) * limit;
  const productId = req.query.product_id as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  let base = db('stock_movements as sm')
    .leftJoin('products as p', 'p.id', 'sm.product_id')
    .leftJoin('warehouses as w', 'w.id', 'sm.warehouse_id')
    .where('sm.dealer_id', dealerId);

  if (productId) base = base.andWhere('sm.product_id', productId);
  if (from) base = base.andWhere('sm.moved_at', '>=', from);
  if (to) base = base.andWhere('sm.moved_at', '<=', `${to}T23:59:59.999Z`);

  const [{ count }] = await base.clone().count<{ count: string }[]>('sm.id as count');

  const rows = await base
    .clone()
    .orderBy('sm.moved_at', 'desc')
    .limit(limit)
    .offset(offset)
    .select(
      'sm.*',
      'p.name as product_name',
      'p.sku as product_sku',
      'w.name as warehouse_name',
    );

  res.json({ data: rows, total: Number(count) || 0, page, limit });
});

// ── Warehouse stock & transfer report ──
router.get('/warehouse-stock', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const warehouses = await db('warehouses')
    .where({ dealer_id: dealerId })
    .orderBy('name')
    .select('id', 'name', 'code', 'manager_name', 'is_default', 'is_active');

  const whStockRows = await db('warehouse_stock as ws')
    .leftJoin('products as p', 'p.id', 'ws.product_id')
    .where('ws.dealer_id', dealerId)
    .select(
      'ws.warehouse_id',
      'ws.product_id',
      'ws.box_qty',
      'ws.piece_qty',
      'ws.total_pieces',
      'p.name as product_name',
      'p.sku as product_sku',
    );

  const stockByWh = new Map<string, any[]>();
  for (const r of whStockRows as any[]) {
    const list = stockByWh.get(r.warehouse_id) ?? [];
    list.push(r);
    stockByWh.set(r.warehouse_id, list);
  }

  // Net movement per warehouse from transfers (in - out)
  const transferRows = await db('warehouse_transfers')
    .where({ dealer_id: dealerId })
    .select('to_warehouse_id', 'from_warehouse_id')
    .sum({ qty: 'quantity' })
    .groupBy('to_warehouse_id', 'from_warehouse_id');

  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const r of transferRows as any[]) {
    const qty = num(r.qty);
    if (r.to_warehouse_id) inMap.set(r.to_warehouse_id, (inMap.get(r.to_warehouse_id) ?? 0) + qty);
    if (r.from_warehouse_id) outMap.set(r.from_warehouse_id, (outMap.get(r.from_warehouse_id) ?? 0) + qty);
  }

  // Recent transfer history
  const recent = await db('warehouse_transfers as wt')
    .leftJoin('warehouses as wf', 'wf.id', 'wt.from_warehouse_id')
    .leftJoin('warehouses as wt2', 'wt2.id', 'wt.to_warehouse_id')
    .where('wt.dealer_id', dealerId)
    .orderBy('wt.transfer_date', 'desc')
    .limit(50)
    .select(
      'wt.*',
      'wf.name as from_name',
      'wt2.name as to_name',
    );

  res.json({
    warehouses: warehouses.map((w: any) => ({
      ...w,
      total_in: inMap.get(w.id) ?? 0,
      total_out: outMap.get(w.id) ?? 0,
      net: (inMap.get(w.id) ?? 0) - (outMap.get(w.id) ?? 0),
      products: stockByWh.get(w.id) ?? [],
    })),
    recent_transfers: recent,
  });
});

// ── Voucher: salary payment by id ──
router.get('/voucher/salary/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const row = await db('salary_payments as sp')
    .leftJoin('employees as e', 'e.id', 'sp.employee_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'sp.bank_account_id')
    .leftJoin('dealers as d', 'd.id', 'sp.dealer_id')
    .where('sp.id', req.params.id).andWhere('sp.dealer_id', dealerId)
    .select(
      'sp.*',
      'e.name as employee_name', 'e.designation', 'e.employee_code', 'e.phone as employee_phone',
      'ba.bank_name', 'ba.account_number',
      'd.business_name as dealer_name', 'd.address as dealer_address', 'd.phone as dealer_phone',
    ).first();
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// ── Voucher: director transaction by id ──
router.get('/voucher/director/:id', async (req, res) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  const row = await db('director_transactions as dt')
    .join('directors as dr', 'dr.id', 'dt.director_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'dt.bank_account_id')
    .leftJoin('dealers as d', 'd.id', 'dt.dealer_id')
    .where('dt.id', req.params.id).andWhere('dt.dealer_id', dealerId)
    .select(
      'dt.*',
      'dr.name as director_name', 'dr.role as director_role', 'dr.phone as director_phone', 'dr.share_pct',
      'ba.bank_name', 'ba.account_number',
      'd.business_name as dealer_name', 'd.address as dealer_address', 'd.phone as dealer_phone',
    ).first();
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

export default router;
