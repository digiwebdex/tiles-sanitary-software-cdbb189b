/**
 * Dashboard aggregation route — Phase 2 data path migration.
 *
 *   GET /api/dashboard?dealerId=<uuid>
 *
 * Returns the same shape as `src/services/dashboardService.ts → DashboardData`
 * so the frontend can swap from Supabase → VPS without UI changes.
 *
 * All queries are dealer-scoped. Salesman role is allowed to call this
 * endpoint, but the frontend hides the financial widgets for them anyway.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import {
  getCustomerAggById,
  getOldestUnpaidSaleDateByCustomer,
  sumCustomerOutstandingFromSales,
  sumSupplierPayable,
} from '../services/reportQueryService';

const router = Router();
router.use(authenticate, tenantGuard);

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function round2(n: unknown): number {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
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

router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yearStart = `${now.getFullYear()}-01-01`;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Today sales
    const todayAgg = await db('sales')
      .where({ dealer_id: dealerId })
      .where('sale_date', '>=', todayStr)
      .select(
        db.raw('COALESCE(SUM(total_amount), 0) AS sales'),
        db.raw('COALESCE(SUM(net_profit), 0) AS profit'),
        db.raw('COALESCE(SUM(total_sft), 0) AS sft'),
      )
      .first();

    // Today collection
    const todayColl = await db('customer_ledger')
      .where({ dealer_id: dealerId, type: 'payment' })
      .where('entry_date', '>=', todayStr)
      .sum({ s: 'amount' })
      .first();

    // Monthly aggregates
    const monthAgg = await db('sales')
      .where({ dealer_id: dealerId })
      .where('sale_date', '>=', monthStart)
      .select(
        db.raw('COALESCE(SUM(total_amount), 0) AS sales'),
        db.raw('COALESCE(SUM(net_profit), 0) AS profit'),
      )
      .first();

    const monthColl = await db('customer_ledger')
      .where({ dealer_id: dealerId, type: 'payment' })
      .where('entry_date', '>=', monthStart)
      .sum({ s: 'amount' })
      .first();

    const monthPurchase = await db('purchases')
      .where({ dealer_id: dealerId })
      .where('purchase_date', '>=', monthStart)
      .sum({ s: 'total_amount' })
      .first();

    // Customer due (invoice headers) and supplier payable (ledger)
    const [totalCustomerDue, supplierPayable] = await Promise.all([
      sumCustomerOutstandingFromSales(dealerId),
      sumSupplierPayable(dealerId),
    ]);

    // Total stock value: sum(box_qty or piece_qty * cost_price)
    const stockValRow = await db.raw(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN p.unit_type = 'box_sft' THEN COALESCE(s.box_qty, 0) * COALESCE(p.cost_price, 0)
          ELSE COALESCE(s.piece_qty, 0) * COALESCE(p.cost_price, 0)
        END
      ), 0) AS v
      FROM products p
      LEFT JOIN stock s ON s.product_id = p.id AND s.dealer_id = p.dealer_id
      WHERE p.dealer_id = ?
      `,
      [dealerId],
    );
    const totalStockValue = round2(stockValRow.rows?.[0]?.v ?? 0);

    // Low-stock items (qty <= reorder_level), top 10
    const lowStockRows = await db.raw(
      `
      SELECT p.id, p.name, p.sku, p.category, p.unit_type,
             COALESCE(p.pieces_per_box, 1) AS pieces_per_box,
             CASE WHEN p.unit_type = 'box_sft'
                  THEN COALESCE(s.box_qty, 0)
                  ELSE COALESCE(s.piece_qty, 0)
             END AS current_qty,
             COALESCE(s.total_pieces, 0) AS total_pieces,
             COALESCE(p.reorder_level, 0) AS reorder_level
      FROM products p
      LEFT JOIN stock s ON s.product_id = p.id AND s.dealer_id = p.dealer_id
      WHERE p.dealer_id = ?
        AND COALESCE(p.reorder_level, 0) > 0
        AND (CASE WHEN p.unit_type = 'box_sft'
                  THEN COALESCE(s.box_qty, 0)
                  ELSE COALESCE(s.piece_qty, 0)
             END) <= COALESCE(p.reorder_level, 0)
      ORDER BY current_qty ASC
      LIMIT 10
      `,
      [dealerId],
    );
    const lowStockItems = (lowStockRows.rows ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      category: r.category ?? '',
      unitType: r.unit_type ?? 'piece',
      piecesPerBox: Number(r.pieces_per_box) || 1,
      totalPieces: round2(r.total_pieces),
      currentQty: round2(r.current_qty),
      reorderLevel: round2(r.reorder_level),
    }));

    // Overdue customers: due > 0 AND oldest unpaid sale > 30 days
    const overdueRow = await db.raw(
      `
      SELECT COUNT(DISTINCT customer_id)::int AS c
      FROM sales
      WHERE dealer_id = ?
        AND due_amount > 0
        AND sale_date < (CURRENT_DATE - INTERVAL '30 days')
      `,
      [dealerId],
    );

    // Monthly sales chart (current year)
    const chartRows = await db.raw(
      `
      SELECT EXTRACT(MONTH FROM sale_date)::int AS m,
             COALESCE(SUM(total_amount), 0) AS amount
      FROM sales
      WHERE dealer_id = ? AND sale_date >= ?
      GROUP BY 1
      `,
      [dealerId, yearStart],
    );
    const chartByMonth: Record<number, number> = {};
    (chartRows.rows ?? []).forEach((r: any) => { chartByMonth[Number(r.m)] = round2(r.amount); });
    const monthlySalesChart = MONTHS.map((month, i) => ({
      month,
      amount: chartByMonth[i + 1] ?? 0,
    }));

    // Top customers (by total billed this year)
    const topCustRows = await db.raw(
      `
      SELECT c.name, COALESCE(SUM(s.total_amount), 0) AS amount
      FROM sales s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.dealer_id = ? AND s.sale_date >= ?
      GROUP BY c.id, c.name
      ORDER BY amount DESC
      LIMIT 5
      `,
      [dealerId, yearStart],
    );
    const topCustomers = (topCustRows.rows ?? []).map((r: any) => ({
      name: r.name,
      amount: round2(r.amount),
    }));

    // Product performance (top 5 by total revenue this year)
    const prodRows = await db.raw(
      `
      SELECT p.name, COALESCE(SUM(si.total), 0) AS amount
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE si.dealer_id = ? AND s.sale_date >= ?
      GROUP BY p.id, p.name
      ORDER BY amount DESC
      LIMIT 5
      `,
      [dealerId, yearStart],
    );
    const productPerformance = (prodRows.rows ?? []).map((r: any) => ({
      name: r.name,
      amount: round2(r.amount),
    }));

    // Category breakdown
    const catRows = await db.raw(
      `
      SELECT COALESCE(p.category::text, 'Other') AS category,
             COALESCE(SUM(si.total), 0) AS amount
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE si.dealer_id = ? AND s.sale_date >= ?
      GROUP BY 1
      ORDER BY amount DESC
      `,
      [dealerId, yearStart],
    );
    const categorySales = (catRows.rows ?? []).map((r: any) => ({
      category: r.category,
      amount: round2(r.amount),
    }));

    res.json({
      todaySales: round2(todayAgg?.sales),
      todayCollection: round2(todayColl?.s),
      todayProfit: round2(todayAgg?.profit),
      todaySftSold: round2(todayAgg?.sft),
      monthlySales: round2(monthAgg?.sales),
      monthlyCollection: round2(monthColl?.s),
      monthlyProfit: round2(monthAgg?.profit),
      monthlyPurchase: round2(monthPurchase?.s),
      totalCustomerDue,
      totalSupplierPayable: round2(supplierPayable),
      cashInHand: 0, // computed elsewhere; left at 0 until cash_ledger endpoint lands
      totalStockValue,
      lowStockItems,
      overdueCustomerCount: Number(overdueRow.rows?.[0]?.c ?? 0),
      creditExceededCount: 0, // requires credit_limits join — Phase 2.1
      deadStockCount: 0,      // 90-day no-sale calc — Phase 2.1
      monthlySalesChart,
      categorySales,
      topCustomers,
      productPerformance,
    });
  } catch (err) {
    console.error('[dashboard] error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ── GET /api/dashboard/onboarding-counts ──────────────────────────────────
router.get('/onboarding-counts', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const [products, customers, suppliers, sales, purchases, collections, supplierPayments, salesReturns] = await Promise.all([
      db('products').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
      db('customers').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
      db('suppliers').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
      db('sales').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
      db('purchases').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
      db('customer_ledger').where({ dealer_id: dealerId, type: 'payment' }).count<{ count: string }[]>('* as count').first(),
      db('supplier_ledger').where({ dealer_id: dealerId, type: 'payment' }).count<{ count: string }[]>('* as count').first(),
      db('sales_returns').where({ dealer_id: dealerId }).count<{ count: string }[]>('* as count').first(),
    ]);
    res.json({
      products: Number(products?.count ?? 0),
      customers: Number(customers?.count ?? 0),
      suppliers: Number(suppliers?.count ?? 0),
      sales: Number(sales?.count ?? 0),
      purchases: Number(purchases?.count ?? 0),
      collections: Number(collections?.count ?? 0),
      supplier_payments: Number(supplierPayments?.count ?? 0),
      sales_returns: Number(salesReturns?.count ?? 0),
    });
  } catch (err: any) {
    console.error('[dashboard/onboarding-counts]', err.message);
    res.status(500).json({ error: 'Failed to load onboarding counts' });
  }
});

// ── GET /api/dashboard/quotation-widgets ──────────────────────────────────
router.get('/quotation-widgets', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const in7Str = in7.toISOString().split('T')[0];
    const ago30 = new Date(today); ago30.setDate(ago30.getDate() - 30);
    const ago30Str = ago30.toISOString().split('T')[0];

    const activeRow = await db('quotations')
      .where({ dealer_id: dealerId, status: 'active' })
      .sum({ s: 'total_amount' })
      .first();

    const expiringRows = await db('quotations')
      .where({ dealer_id: dealerId, status: 'active' })
      .whereBetween('valid_until', [todayStr, in7Str])
      .select('total_amount');

    const convertedRows = await db('quotations')
      .where({ dealer_id: dealerId, status: 'converted' })
      .where('converted_at', '>=', `${ago30Str}T00:00:00`)
      .select('total_amount');

    const recentRows = await db('quotations')
      .where({ dealer_id: dealerId })
      .where('quote_date', '>=', ago30Str)
      .select('status');

    const expiringCount = expiringRows.length;
    const expiringValue = expiringRows.reduce((s, r: any) => s + Number(r.total_amount || 0), 0);
    const convertedCount = convertedRows.length;
    const convertedValue = convertedRows.reduce((s, r: any) => s + Number(r.total_amount || 0), 0);
    const finalized = recentRows.filter((r: any) => r.status !== 'draft' && r.status !== 'cancelled').length;
    const convertedRecent = recentRows.filter((r: any) => r.status === 'converted').length;
    const conversionPct = finalized > 0 ? (convertedRecent / finalized) * 100 : 0;

    res.json({
      activeValue: round2(activeRow?.s),
      expiringCount,
      expiringValue: round2(expiringValue),
      convertedCount,
      convertedValue: round2(convertedValue),
      conversionPct: round2(conversionPct),
    });
  } catch (err: any) {
    console.error('[dashboard/quotation-widgets]', err.message);
    res.status(500).json({ error: 'Failed to load quotation widgets' });
  }
});

// ── GET /api/dashboard/delivery-summary ───────────────────────────────────
router.get('/delivery-summary', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

    const rows = await db('challans')
      .where({ dealer_id: dealerId })
      .whereNot('status', 'cancelled')
      .select('id', 'delivery_status', 'challan_date', 'status');

    const pending = rows.filter((c: any) => c.delivery_status === 'pending').length;
    const dispatchedToday = rows.filter(
      (c: any) => c.delivery_status === 'dispatched' && String(c.challan_date).slice(0, 10) === today,
    ).length;
    const deliveredToday = rows.filter(
      (c: any) => c.delivery_status === 'delivered' && String(c.challan_date).slice(0, 10) === today,
    ).length;
    const late = rows.filter(
      (c: any) => c.delivery_status === 'pending' && String(c.challan_date).slice(0, 10) <= twoDaysAgo,
    ).length;

    res.json({ pending, dispatchedToday, deliveredToday, late });
  } catch (err: any) {
    console.error('[dashboard/delivery-summary]', err.message);
    res.status(500).json({ error: 'Failed to load delivery summary' });
  }
});

// ── GET /api/dashboard/top-overdue ────────────────────────────────────────
router.get('/top-overdue', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const [custs, aggMap, oldestMap] = await Promise.all([
      db('customers')
        .where({ dealer_id: dealerId, status: 'active' })
        .select('id', 'name', 'phone', 'max_overdue_days'),
      getCustomerAggById(dealerId),
      getOldestUnpaidSaleDateByCustomer(dealerId),
    ]);

    const today = new Date();
    const out = (custs as any[])
      .map((c) => {
        const a = aggMap.get(c.id);
        const outstanding = round2(a?.outstanding ?? 0);
        const oldestSaleDate = oldestMap.get(c.id) ?? null;
        const daysOverdue = oldestSaleDate
          ? Math.floor((today.getTime() - new Date(oldestSaleDate).getTime()) / 86400000)
          : 0;
        return { id: c.id, name: c.name, phone: c.phone, outstanding, daysOverdue };
      })
      .filter((c) => c.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 5);

    res.json({ rows: out });
  } catch (err: any) {
    console.error('[dashboard/top-overdue]', err.message);
    res.status(500).json({ error: 'Failed to load top overdue customers' });
  }
});

// ── GET /api/dashboard/latest-suppliers ───────────────────────────────────
router.get('/latest-suppliers', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const rows = await db('suppliers')
      .where({ dealer_id: dealerId })
      .select('id', 'name', 'phone', 'status', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);
    res.json({ rows });
  } catch (err: any) {
    console.error('[dashboard/latest-suppliers]', err.message);
    res.status(500).json({ error: 'Failed to load latest suppliers' });
  }
});

// ── GET /api/dashboard/customer-due-balances?ids=a,b,c ────────────────────
router.get('/customer-due-balances', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;

  try {
    const idsParam = (req.query.ids as string | undefined) || '';
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
      res.json({ rows: {} });
      return;
    }

    const [aggMap, oldestMap] = await Promise.all([
      getCustomerAggById(dealerId, ids),
      getOldestUnpaidSaleDateByCustomer(dealerId, ids),
    ]);
    const sums: Record<string, { due: number; daysOverdue: number }> = {};
    for (const id of ids) {
      const a = aggMap.get(id);
      sums[id] = { due: round2(a?.outstanding ?? 0), daysOverdue: 0 };
    }

    const today = new Date();
    for (const [cid, date] of oldestMap) {
      if (sums[cid]) {
        sums[cid].daysOverdue = Math.max(
          0,
          Math.floor((today.getTime() - new Date(date).getTime()) / 86400000),
        );
      }
    }

    res.json({ rows: sums });
  } catch (err: any) {
    console.error('[dashboard/customer-due-balances]', err.message);
    res.status(500).json({ error: 'Failed to load customer due balances' });
  }
});

// ── GET /api/dashboard/latest-sales ───────────────────────────────────────
router.get('/latest-sales', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('sales')
      .leftJoin('customers', 'customers.id', 'sales.customer_id')
      .where('sales.dealer_id', dealerId)
      .select(
        'sales.id',
        'sales.sale_date',
        'sales.invoice_number',
        'sales.total_amount',
        'sales.paid_amount',
        'sales.due_amount',
        'sales.sale_status',
        db.raw("json_build_object('name', customers.name) AS customers"),
      )
      .orderBy('sales.created_at', 'desc')
      .limit(5);
    res.json({ rows });
  } catch (err: any) {
    console.error('[dashboard/latest-sales]', err.message);
    res.status(500).json({ error: 'Failed to load latest sales' });
  }
});

// ── GET /api/dashboard/latest-purchases ───────────────────────────────────
router.get('/latest-purchases', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('purchases')
      .leftJoin('suppliers', 'suppliers.id', 'purchases.supplier_id')
      .where('purchases.dealer_id', dealerId)
      .select(
        'purchases.id',
        'purchases.purchase_date',
        'purchases.invoice_number',
        'purchases.total_amount',
        db.raw("json_build_object('name', suppliers.name) AS suppliers"),
      )
      .orderBy('purchases.created_at', 'desc')
      .limit(5);
    res.json({ rows });
  } catch (err: any) {
    console.error('[dashboard/latest-purchases]', err.message);
    res.status(500).json({ error: 'Failed to load latest purchases' });
  }
});

// ── GET /api/dashboard/latest-customers ───────────────────────────────────
router.get('/latest-customers', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('customers')
      .where({ dealer_id: dealerId })
      .select('id', 'name', 'phone', 'type', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);
    res.json({ rows });
  } catch (err: any) {
    console.error('[dashboard/latest-customers]', err.message);
    res.status(500).json({ error: 'Failed to load latest customers' });
  }
});

// ── GET /api/dashboard/reservation-summary ────────────────────────────────
router.get('/reservation-summary', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const reservations = await db('stock_reservations as r')
      .leftJoin('products as p', 'p.id', 'r.product_id')
      .leftJoin('customers as c', 'c.id', 'r.customer_id')
      .where({ 'r.dealer_id': dealerId, 'r.status': 'active' })
      .select(
        'r.id', 'r.reserved_qty', 'r.fulfilled_qty', 'r.released_qty', 'r.expires_at',
        'p.name as product_name', 'p.default_sale_rate',
        'c.name as customer_name',
      );

    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    let activeHolds = 0;
    let totalReservedQty = 0;
    let totalReservedValue = 0;
    let expiringToday = 0;
    const expiringItems: { product: string; customer: string; remaining: number; daysLeft: number }[] = [];

    for (const r of reservations) {
      const remaining = Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty);
      if (remaining <= 0) continue;
      activeHolds++;
      totalReservedQty += remaining;
      totalReservedValue += remaining * Number(r.default_sale_rate ?? 0);
      if (r.expires_at) {
        const exp = new Date(r.expires_at);
        const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
        if (exp <= todayEnd && exp >= now) expiringToday++;
        if (daysLeft <= 3 && daysLeft >= 0) {
          expiringItems.push({
            product: r.product_name ?? '—',
            customer: r.customer_name ?? '—',
            remaining,
            daysLeft,
          });
        }
      }
    }

    const stockData = await db('stock')
      .where({ dealer_id: dealerId })
      .select('box_qty', 'piece_qty', 'reserved_box_qty', 'reserved_piece_qty');

    let totalStock = 0;
    let totalReservedAgg = 0;
    for (const s of stockData) {
      totalStock += Number(s.box_qty ?? 0) + Number(s.piece_qty ?? 0);
      totalReservedAgg += Number(s.reserved_box_qty ?? 0) + Number(s.reserved_piece_qty ?? 0);
    }
    const freeStock = totalStock - totalReservedAgg;
    const reservedPct = totalStock > 0 ? Math.round((totalReservedAgg / totalStock) * 100) : 0;

    res.json({
      activeHolds,
      totalReservedQty,
      totalReservedValue: round2(totalReservedValue),
      expiringToday,
      expiringItems: expiringItems.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 5),
      totalStock,
      totalReservedAgg,
      freeStock,
      reservedPct,
    });
  } catch (err: any) {
    console.error('[dashboard/reservation-summary]', err.message);
    res.status(500).json({ error: 'Failed to load reservation summary' });
  }
});

// ── GET /api/dashboard/approval-widgets ───────────────────────────────────
router.get('/approval-widgets', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const nowIso = new Date().toISOString();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const pending = await db('approval_requests')
      .where({ dealer_id: dealerId, status: 'pending' })
      .where('expires_at', '>', nowIso)
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('id', 'approval_type', 'created_at', 'context_data', 'requested_by');

    const todayRows = await db('approval_requests')
      .where({ dealer_id: dealerId })
      .where('decided_at', '>=', startOfDay.toISOString())
      .select('status');
    const approved = todayRows.filter((r: any) => r.status === 'approved' || r.status === 'consumed').length;
    const rejected = todayRows.filter((r: any) => r.status === 'rejected').length;
    const auto = todayRows.filter((r: any) => r.status === 'auto_approved').length;

    const recentRows = await db('approval_requests')
      .where({ dealer_id: dealerId })
      .where('created_at', '>=', sevenDaysAgo)
      .select('approval_type');
    const counts = new Map<string, number>();
    for (const r of recentRows) {
      counts.set(r.approval_type, (counts.get(r.approval_type) ?? 0) + 1);
    }
    const typeSummary = Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      pending,
      todayDecisions: { approved, rejected, auto, total: todayRows.length },
      typeSummary,
    });
  } catch (err: any) {
    console.error('[dashboard/approval-widgets]', err.message);
    res.status(500).json({ error: 'Failed to load approval widgets' });
  }
});

export default router;
