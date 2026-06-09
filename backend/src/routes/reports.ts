/**
 * Reports REST routes — VPS migration phase 3J (reads only).
 *
 * Mirrors all 10 functions in `src/services/reportService.ts`:
 *   GET /api/reports/stock?dealerId=&page=&search=
 *   GET /api/reports/products?dealerId=&page=&search=
 *   GET /api/reports/brand-stock?dealerId=
 *   GET /api/reports/sales?dealerId=&mode=daily|monthly&year=&month=
 *   GET /api/reports/retailer-sales?dealerId=&year=&customerType=
 *   GET /api/reports/product-history?dealerId=&productId=&page=
 *   GET /api/reports/customer-due?dealerId=&page=
 *   GET /api/reports/supplier-payable?dealerId=&page=
 *   GET /api/reports/accounting-summary?dealerId=&year=
 *   GET /api/reports/inventory-aging?dealerId=
 *   GET /api/reports/low-stock?dealerId=
 *
 * All routes are dealer-scoped. Reports are RLS-equivalent via the
 * tenantGuard + explicit dealerId filter on every query.
 *
 * Cost / margin data is restricted to dealer_admin / super_admin —
 * salesman role gets a 403 to mirror the dashboard server-side gate.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import {
  buildCustomerDueReportRows,
  buildSupplierPayableReportRows,
  fetchCustomerLedgerEntries,
  fetchSupplierLedgerEntries,
  groupCustomerLedger,
  groupSupplierLedger,
} from '../services/reportQueryService';
import { computeSupplierBalance } from '../lib/ledgerBalance';

const router = Router();
router.use(authenticate, tenantGuard);

const PAGE_SIZE = 25;
const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** Block salesman from financial / margin reports. */
function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return true;
  res.status(403).json({ error: 'Reports require dealer_admin role' });
  return false;
}

// ─── 1. Stock Report ──────────────────────────────────────────────────────
router.get('/stock', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim();

  try {
    let pq = db('products')
      .where({ dealer_id: dealerId, active: true })
      .orderBy('sku');
    if (search) {
      pq = pq.andWhere(function () {
        this.whereILike('sku', `%${search}%`)
          .orWhereILike('name', `%${search}%`)
          .orWhereILike('brand', `%${search}%`);
      });
    }
    const [{ count }] = await pq
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const products = await pq
      .clone()
      .select('id', 'sku', 'name', 'brand', 'category', 'unit_type', 'pieces_per_box', 'reorder_level')
      .offset((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const ids = products.map((p) => p.id);
    if (!ids.length) {
      res.json({ rows: [], total: 0 });
      return;
    }

    const stocks = await db('stock')
      .whereIn('product_id', ids)
      .andWhere({ dealer_id: dealerId })
      .select('product_id', 'box_qty', 'sft_qty', 'piece_qty', 'average_cost_per_unit');
    const sm = new Map(stocks.map((s: any) => [s.product_id, s]));

    const rows = products.map((p: any) => {
      const s: any = sm.get(p.id);
      const boxQty = Number(s?.box_qty ?? 0);
      const sftQty = Number(s?.sft_qty ?? 0);
      const pieceQty = Number(s?.piece_qty ?? 0);
      const avgCost = Number(s?.average_cost_per_unit ?? 0);
      const totalQty = boxQty + pieceQty;
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        unitType: p.unit_type,
        piecesPerBox: Number(p.pieces_per_box) || 1,
        boxQty,
        sftQty,
        pieceQty,
        avgCost,
        stockValue: round2(totalQty * avgCost),
        reorderLevel: Number(p.reorder_level ?? 0),
        isLow: totalQty <= Number(p.reorder_level ?? 0),
      };
    });

    res.json({ rows, total: Number(count) || 0 });
  } catch (err) {
    console.error('[reports.stock]', err);
    res.status(500).json({ error: 'Failed to load stock report' });
  }
});

// ─── 2. Products Report ───────────────────────────────────────────────────
router.get('/products', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim();

  try {
    let pq = db('products')
      .where({ dealer_id: dealerId, active: true })
      .orderBy('sku');
    if (search) {
      pq = pq.andWhere(function () {
        this.whereILike('sku', `%${search}%`)
          .orWhereILike('name', `%${search}%`)
          .orWhereILike('brand', `%${search}%`);
      });
    }
    const [{ count }] = await pq
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const products = await pq
      .clone()
      .select('id', 'sku', 'name', 'brand', 'category', 'unit_type', 'per_box_sft')
      .offset((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE);

    const ids = products.map((p) => p.id);
    if (!ids.length) {
      res.json({ rows: [], total: 0 });
      return;
    }

    const [purchaseRows, saleRows, stockRows] = await Promise.all([
      db('purchase_items')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id')
        .sum({ qty: 'quantity' })
        .sum({ amount: 'total' })
        .groupBy('product_id'),
      db('sale_items')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id')
        .sum({ qty: 'quantity' })
        .sum({ amount: 'total' })
        .groupBy('product_id'),
      db('stock')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id', 'box_qty', 'piece_qty', 'average_cost_per_unit'),
    ]);

    const purMap = new Map(purchaseRows.map((r: any) => [r.product_id, r]));
    const saleMap = new Map(saleRows.map((r: any) => [r.product_id, r]));
    const stockMap = new Map(stockRows.map((s: any) => [s.product_id, s]));

    const rows = products.map((p: any) => {
      const pur: any = purMap.get(p.id) ?? { qty: 0, amount: 0 };
      const sld: any = saleMap.get(p.id) ?? { qty: 0, amount: 0 };
      const st: any = stockMap.get(p.id);
      const stockQty = Number(st?.box_qty ?? 0) + Number(st?.piece_qty ?? 0);
      const avgCost = Number(st?.average_cost_per_unit ?? 0);
      const cogs = Number(sld.qty) * avgCost;
      return {
        productId: p.id,
        sku: p.sku,
        name: `${p.name}${p.category === 'tiles' && p.per_box_sft ? ` (Box: ${p.per_box_sft}sft)` : ''}`,
        purchasedQty: Number(pur.qty),
        purchasedAmount: round2(Number(pur.amount)),
        soldQty: Number(sld.qty),
        soldAmount: round2(Number(sld.amount)),
        profitOrLoss: round2(Number(sld.amount) - cogs),
        stockQty,
        stockAmount: round2(stockQty * avgCost),
      };
    });

    res.json({ rows, total: Number(count) || 0 });
  } catch (err) {
    console.error('[reports.products]', err);
    res.status(500).json({ error: 'Failed to load products report' });
  }
});

// ─── 3. Brand Stock Report ────────────────────────────────────────────────
router.get('/brand-stock', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const products = await db('products')
      .where({ dealer_id: dealerId, active: true })
      .select('id', 'brand', 'unit_type');

    const ids = products.map((p: any) => p.id);
    if (!ids.length) {
      res.json([]);
      return;
    }

    const [stocks, purItems, saleItems] = await Promise.all([
      db('stock')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id', 'box_qty', 'sft_qty', 'piece_qty', 'average_cost_per_unit'),
      db('purchase_items')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id', 'quantity', 'total'),
      db('sale_items')
        .where({ dealer_id: dealerId })
        .whereIn('product_id', ids)
        .select('product_id', 'quantity', 'total'),
    ]);

    const stockMap = new Map(stocks.map((s: any) => [s.product_id, s]));
    const purMap: Record<string, { qty: number; amount: number }> = {};
    for (const pi of purItems) {
      const k = (pi as any).product_id;
      if (!purMap[k]) purMap[k] = { qty: 0, amount: 0 };
      purMap[k].qty += Number((pi as any).quantity);
      purMap[k].amount += Number((pi as any).total);
    }
    const sldMap: Record<string, { qty: number; amount: number }> = {};
    for (const si of saleItems) {
      const k = (si as any).product_id;
      if (!sldMap[k]) sldMap[k] = { qty: 0, amount: 0 };
      sldMap[k].qty += Number((si as any).quantity);
      sldMap[k].amount += Number((si as any).total);
    }

    const brandMap: Record<string, any> = {};
    for (const p of products as any[]) {
      const brand = p.brand || 'Others';
      if (!brandMap[brand]) {
        brandMap[brand] = {
          brand, totalBox: 0, totalSft: 0, totalPiece: 0, totalValue: 0, productCount: 0,
          purchasedQty: 0, purchasedAmount: 0, soldQty: 0, soldAmount: 0, profitOrLoss: 0,
        };
      }
      const s: any = stockMap.get(p.id);
      const boxQty = Number(s?.box_qty ?? 0);
      const sftQty = Number(s?.sft_qty ?? 0);
      const pieceQty = Number(s?.piece_qty ?? 0);
      const avgCost = Number(s?.average_cost_per_unit ?? 0);
      brandMap[brand].totalBox += boxQty;
      brandMap[brand].totalSft += sftQty;
      brandMap[brand].totalPiece += pieceQty;
      brandMap[brand].totalValue += (boxQty + pieceQty) * avgCost;
      brandMap[brand].productCount += 1;
      const pur = purMap[p.id] ?? { qty: 0, amount: 0 };
      const sld = sldMap[p.id] ?? { qty: 0, amount: 0 };
      brandMap[brand].purchasedQty += pur.qty;
      brandMap[brand].purchasedAmount += pur.amount;
      brandMap[brand].soldQty += sld.qty;
      brandMap[brand].soldAmount += sld.amount;
      brandMap[brand].profitOrLoss += sld.amount - (sld.qty * avgCost);
    }

    res.json(
      Object.values(brandMap)
        .map((b: any) => ({
          ...b,
          totalValue: round2(b.totalValue),
          totalSft: round2(b.totalSft),
          purchasedAmount: round2(b.purchasedAmount),
          soldAmount: round2(b.soldAmount),
          profitOrLoss: round2(b.profitOrLoss),
        }))
        .sort((a: any, b: any) => b.totalValue - a.totalValue),
    );
  } catch (err) {
    console.error('[reports.brand-stock]', err);
    res.status(500).json({ error: 'Failed to load brand stock report' });
  }
});

// ─── 4. Sales Report (daily/monthly) ──────────────────────────────────────
router.get('/sales', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const mode = (req.query.mode as string) === 'monthly' ? 'monthly' : 'daily';
  const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
  const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;

  try {
    let q = db('sales')
      .where({ dealer_id: dealerId })
      .select('sale_date', 'total_amount', 'paid_amount', 'profit', 'due_amount', 'total_sft')
      .orderBy('sale_date');
    if (mode === 'daily' && month) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      q = q.andWhere('sale_date', '>=', start).andWhere('sale_date', '<=', end);
    } else {
      q = q.andWhere('sale_date', '>=', `${year}-01-01`).andWhere('sale_date', '<=', `${year}-12-31`);
    }
    const data = await q;

    const buckets: Record<string, any> = {};
    for (const row of data as any[]) {
      const d = String(row.sale_date).substring(0, 10);
      const key = mode === 'daily' ? d : d.substring(0, 7);
      if (!buckets[key]) {
        buckets[key] = { date: key, count: 0, totalAmount: 0, totalCollection: 0, totalProfit: 0, totalDue: 0, totalSft: 0 };
      }
      buckets[key].count += 1;
      buckets[key].totalAmount += Number(row.total_amount);
      buckets[key].totalCollection += Number(row.paid_amount);
      buckets[key].totalProfit += Number(row.profit ?? 0);
      buckets[key].totalDue += Number(row.due_amount ?? 0);
      buckets[key].totalSft += Number(row.total_sft ?? 0);
    }

    res.json(
      Object.values(buckets)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))
        .map((b: any) => ({
          ...b,
          totalAmount: round2(b.totalAmount),
          totalCollection: round2(b.totalCollection),
          totalProfit: round2(b.totalProfit),
          totalDue: round2(b.totalDue),
          totalSft: round2(b.totalSft),
        })),
    );
  } catch (err) {
    console.error('[reports.sales]', err);
    res.status(500).json({ error: 'Failed to load sales report' });
  }
});

// ─── 5. Retailer Sales Report ─────────────────────────────────────────────
router.get('/retailer-sales', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
  const customerType = req.query.customerType as string | undefined;

  try {
    let q = db('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where('s.dealer_id', dealerId)
      .andWhere('s.sale_date', '>=', `${year}-01-01`)
      .andWhere('s.sale_date', '<=', `${year}-12-31`)
      .select('s.customer_id', 's.total_sft', 's.total_amount', 's.due_amount', 'c.name as cust_name', 'c.type as cust_type');
    if (customerType) q = q.andWhere('c.type', customerType);
    const data = await q;

    const map: Record<string, any> = {};
    for (const row of data as any[]) {
      const cid = row.customer_id;
      if (!map[cid]) {
        map[cid] = {
          customerId: cid,
          customerName: row.cust_name ?? '—',
          customerType: row.cust_type ?? 'customer',
          totalSft: 0, totalAmount: 0, totalDue: 0, saleCount: 0,
        };
      }
      map[cid].totalSft += Number(row.total_sft ?? 0);
      map[cid].totalAmount += Number(row.total_amount);
      map[cid].totalDue += Number(row.due_amount ?? 0);
      map[cid].saleCount += 1;
    }

    res.json(
      Object.values(map)
        .map((r: any) => ({
          ...r,
          totalSft: round2(r.totalSft),
          totalAmount: round2(r.totalAmount),
          totalDue: round2(r.totalDue),
        }))
        .sort((a: any, b: any) => b.totalSft - a.totalSft),
    );
  } catch (err) {
    console.error('[reports.retailer-sales]', err);
    res.status(500).json({ error: 'Failed to load retailer sales report' });
  }
});

// ─── 6. Product History ───────────────────────────────────────────────────
router.get('/product-history', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const productId = req.query.productId as string;
  if (!productId) {
    res.status(400).json({ error: 'productId required' });
    return;
  }
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));

  try {
    const product = await db('products')
      .where({ dealer_id: dealerId, id: productId })
      .first('unit_type', 'pieces_per_box', 'category');
    const [purchases, sales, returns] = await Promise.all([
      db('purchase_items as pi')
        .leftJoin('purchases as p', 'p.id', 'pi.purchase_id')
        .where({ 'pi.dealer_id': dealerId, 'pi.product_id': productId })
        .select('pi.id', 'pi.quantity', 'pi.purchase_rate', 'pi.total', 'p.purchase_date', 'p.invoice_number'),
      db('sale_items as si')
        .leftJoin('sales as s', 's.id', 'si.sale_id')
        .where({ 'si.dealer_id': dealerId, 'si.product_id': productId })
        .select('si.id', 'si.quantity', 'si.sale_rate', 'si.total', 's.sale_date', 's.invoice_number'),
      db('sales_returns as sr')
        .leftJoin('sales as s', 's.id', 'sr.sale_id')
        .where({ 'sr.dealer_id': dealerId, 'sr.product_id': productId })
        .select('sr.id', 'sr.qty', 'sr.refund_amount', 'sr.return_date', 'sr.is_broken', 's.invoice_number'),
    ]);

    const rows: any[] = [];
    for (const pi of purchases as any[]) {
      rows.push({
        id: pi.id,
        date: pi.purchase_date ? String(pi.purchase_date).substring(0, 10) : '',
        type: 'purchase',
        quantity: Number(pi.quantity),
        rate: Number(pi.purchase_rate),
        total: Number(pi.total),
        reference: pi.invoice_number ?? '—',
      });
    }
    for (const si of sales as any[]) {
      rows.push({
        id: si.id,
        date: si.sale_date ? String(si.sale_date).substring(0, 10) : '',
        type: 'sale',
        quantity: Number(si.quantity),
        rate: Number(si.sale_rate),
        total: Number(si.total),
        reference: si.invoice_number ?? '—',
      });
    }
    for (const sr of returns as any[]) {
      rows.push({
        id: sr.id,
        date: sr.return_date ? String(sr.return_date).substring(0, 10) : '',
        type: 'return',
        quantity: Number(sr.qty),
        rate: 0,
        total: Number(sr.refund_amount),
        reference: `${sr.invoice_number ?? '—'}${sr.is_broken ? ' (broken)' : ''}`,
      });
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));
    const total = rows.length;
    const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    res.json({
      rows: paged,
      total,
      unitType: product?.unit_type ?? null,
      piecesPerBox: Number(product?.pieces_per_box ?? 1),
      category: product?.category ?? null,
    });
  } catch (err) {
    console.error('[reports.product-history]', err);
    res.status(500).json({ error: 'Failed to load product history' });
  }
});

// ─── 7. Customer Due Report (deprecated — use /collections/outstanding) ───
router.get('/customer-due', async (_req, res) => {
  res.status(410).json({
    error: 'This report has been retired. Use GET /api/collections/outstanding or Due Aging in Collections.',
    redirect: '/collections/outstanding',
    replacement: '/api/collections/outstanding',
  });
});

// ─── 8. Supplier Payable Report ───────────────────────────────────────────
router.get('/supplier-payable', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));

  try {
    const [ledger, suppliers] = await Promise.all([
      fetchSupplierLedgerEntries(dealerId),
      db('suppliers').where({ dealer_id: dealerId }).select('id', 'name'),
    ]);
    const sm = new Map(
      (suppliers as Array<{ id: string; name: string }>).map((s) => [s.id, { name: s.name }]),
    );
    const grouped = groupSupplierLedger(ledger);
    const all = buildSupplierPayableReportRows(grouped, sm);

    res.json({
      rows: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: all.length,
    });
  } catch (err) {
    console.error('[reports.supplier-payable]', err);
    res.status(500).json({ error: 'Failed to load supplier payable report' });
  }
});

// ─── 9. Accounting Summary ────────────────────────────────────────────────
router.get('/accounting-summary', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  try {
    const [sales, purchases, expenses, cash] = await Promise.all([
      db('sales')
        .where({ dealer_id: dealerId })
        .andWhere('sale_date', '>=', yearStart).andWhere('sale_date', '<=', yearEnd)
        .select('sale_date', 'total_amount', 'paid_amount', 'profit', 'due_amount', 'total_sft'),
      db('purchases')
        .where({ dealer_id: dealerId })
        .andWhere('purchase_date', '>=', yearStart).andWhere('purchase_date', '<=', yearEnd)
        .select('purchase_date', 'total_amount'),
      db('expenses')
        .where({ dealer_id: dealerId })
        .andWhere('expense_date', '>=', yearStart).andWhere('expense_date', '<=', yearEnd)
        .select('expense_date', 'amount'),
      db('cash_ledger')
        .where({ dealer_id: dealerId })
        .andWhere('entry_date', '>=', yearStart).andWhere('entry_date', '<=', yearEnd)
        .select('entry_date', 'amount'),
    ]);

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const buckets = MONTHS.map((m) => ({
      month: m, totalSales: 0, totalCollection: 0, totalDue: 0, totalSftSold: 0,
      totalPurchases: 0, totalExpenses: 0, netProfit: 0, cashIn: 0, cashOut: 0,
    }));
    for (const r of sales as any[]) {
      const m = new Date(r.sale_date).getMonth();
      buckets[m].totalSales += Number(r.total_amount);
      buckets[m].totalCollection += Number(r.paid_amount);
      buckets[m].totalDue += Number(r.due_amount ?? 0);
      buckets[m].totalSftSold += Number(r.total_sft ?? 0);
      buckets[m].netProfit += Number(r.profit ?? 0);
    }
    for (const r of purchases as any[]) {
      const m = new Date(r.purchase_date).getMonth();
      buckets[m].totalPurchases += Number(r.total_amount);
    }
    for (const r of expenses as any[]) {
      const m = new Date(r.expense_date).getMonth();
      buckets[m].totalExpenses += Number(r.amount);
    }
    for (const r of cash as any[]) {
      const m = new Date(r.entry_date).getMonth();
      const amt = Number(r.amount);
      if (amt >= 0) buckets[m].cashIn += amt;
      else buckets[m].cashOut += Math.abs(amt);
    }

    res.json(buckets.map((b) => ({
      ...b,
      totalSales: round2(b.totalSales),
      totalCollection: round2(b.totalCollection),
      totalDue: round2(b.totalDue),
      totalSftSold: round2(b.totalSftSold),
      totalPurchases: round2(b.totalPurchases),
      totalExpenses: round2(b.totalExpenses),
      netProfit: round2(b.netProfit),
      cashIn: round2(b.cashIn),
      cashOut: round2(b.cashOut),
    })));
  } catch (err) {
    console.error('[reports.accounting-summary]', err);
    res.status(500).json({ error: 'Failed to load accounting summary' });
  }
});

// ─── 10. Inventory Aging Report (FIFO) ────────────────────────────────────
router.get('/inventory-aging', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [products, stocks, purItems, saleItems] = await Promise.all([
      db('products')
        .where({ dealer_id: dealerId, active: true })
        .orderBy('sku')
        .select('id', 'sku', 'name', 'brand', 'category', 'unit_type', 'per_box_sft', 'pieces_per_box', 'reorder_level'),
      db('stock')
        .where({ dealer_id: dealerId })
        .select('product_id', 'box_qty', 'sft_qty', 'piece_qty', 'average_cost_per_unit'),
      db('purchase_items as pi')
        .leftJoin('purchases as p', 'p.id', 'pi.purchase_id')
        .where('pi.dealer_id', dealerId)
        .select('pi.product_id', 'pi.quantity', 'pi.purchase_rate', 'pi.landed_cost', 'p.purchase_date'),
      db('sale_items as si')
        .leftJoin('sales as s', 's.id', 'si.sale_id')
        .where('si.dealer_id', dealerId)
        .select('si.product_id', 'si.quantity', 's.sale_date'),
    ]);

    const stockMap = new Map(stocks.map((s: any) => [s.product_id, s]));

    const purchaseBatchMap: Record<string, { qty: number; cost: number; date: string }[]> = {};
    for (const item of purItems as any[]) {
      const pid = item.product_id;
      const dateStr = item.purchase_date ? String(item.purchase_date).substring(0, 10) : '1970-01-01';
      const cost = Number(item.landed_cost) > 0 ? Number(item.landed_cost) : Number(item.purchase_rate);
      if (!purchaseBatchMap[pid]) purchaseBatchMap[pid] = [];
      purchaseBatchMap[pid].push({ qty: Number(item.quantity), cost, date: dateStr });
    }
    for (const pid of Object.keys(purchaseBatchMap)) {
      purchaseBatchMap[pid].sort((a, b) => a.date.localeCompare(b.date));
    }

    const saleMap: Record<string, { totalSold: number; lastSaleDate: string | null }> = {};
    for (const item of saleItems as any[]) {
      const pid = item.product_id;
      const dateStr = item.sale_date ? String(item.sale_date).substring(0, 10) : null;
      if (!saleMap[pid]) saleMap[pid] = { totalSold: 0, lastSaleDate: null };
      saleMap[pid].totalSold += Number(item.quantity);
      if (dateStr && (!saleMap[pid].lastSaleDate || dateStr > saleMap[pid].lastSaleDate!)) {
        saleMap[pid].lastSaleDate = dateStr;
      }
    }

    const rows: any[] = [];
    let totalFifoValue = 0;

    for (const product of products as any[]) {
      const stock: any = stockMap.get(product.id);
      if (!stock) continue;
      const boxQty = Number(stock.box_qty);
      const sftQty = Number(stock.sft_qty);
      const pieceQty = Number(stock.piece_qty);
      const avgCostPerUnit = Number(stock.average_cost_per_unit);
      const currentBaseQty = product.unit_type === 'box_sft' ? boxQty : pieceQty;
      if (currentBaseQty <= 0) continue;

      const batches = purchaseBatchMap[product.id] ?? [];
      let soldQty = saleMap[product.id]?.totalSold ?? 0;
      const remaining: { qty: number; cost: number }[] = [];
      for (const b of batches) {
        if (soldQty <= 0) remaining.push({ qty: b.qty, cost: b.cost });
        else if (soldQty >= b.qty) soldQty -= b.qty;
        else { remaining.push({ qty: b.qty - soldQty, cost: b.cost }); soldQty = 0; }
      }

      let fifoValue = 0;
      let qtyToValue = currentBaseQty;
      for (const b of remaining) {
        if (qtyToValue <= 0) break;
        const take = Math.min(b.qty, qtyToValue);
        fifoValue += take * b.cost;
        qtyToValue -= take;
      }
      if (qtyToValue > 0) fifoValue += qtyToValue * avgCostPerUnit;

      const lastSaleDate = saleMap[product.id]?.lastSaleDate ?? null;
      let daysSinceLastSale: number | null = null;
      if (lastSaleDate) {
        const d = new Date(lastSaleDate);
        daysSinceLastSale = Math.floor((today.getTime() - d.getTime()) / 86400000);
      }
      let agingCategory: string;
      if (daysSinceLastSale === null) agingCategory = 'unsold';
      else if (daysSinceLastSale <= 30) agingCategory = 'fast';
      else if (daysSinceLastSale <= 90) agingCategory = 'normal';
      else agingCategory = 'slow';

      totalFifoValue += fifoValue;
      rows.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category,
        unitType: product.unit_type,
        piecesPerBox: Number(product.pieces_per_box) || 1,
        boxQty, sftQty, pieceQty, avgCostPerUnit,
        fifoStockValue: round2(fifoValue),
        lastSaleDate, daysSinceLastSale, agingCategory,
      });
    }

    const order: Record<string, number> = { unsold: 0, slow: 1, normal: 2, fast: 3 };
    rows.sort((a, b) => {
      const d = order[a.agingCategory] - order[b.agingCategory];
      return d !== 0 ? d : b.fifoStockValue - a.fifoStockValue;
    });

    res.json({ rows, totalFifoValue: round2(totalFifoValue) });
  } catch (err) {
    console.error('[reports.inventory-aging]', err);
    res.status(500).json({ error: 'Failed to load inventory aging report' });
  }
});

// ─── 11. Low Stock Report ─────────────────────────────────────────────────
router.get('/low-stock', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  // Allow salesman to see low-stock (they need to know what's out)
  try {
    const products = await db('products')
      .where({ dealer_id: dealerId, active: true })
      .orderBy('sku')
      .select('id', 'sku', 'name', 'brand', 'category', 'unit_type', 'reorder_level', 'pieces_per_box');
    if (!products.length) {
      res.json([]);
      return;
    }
    const ids = products.map((p: any) => p.id);
    const stocks = await db('stock')
      .where({ dealer_id: dealerId })
      .whereIn('product_id', ids)
      .select('product_id', 'box_qty', 'piece_qty', 'sft_qty', 'total_pieces');
    const sm = new Map(stocks.map((s: any) => [s.product_id, s]));

    const rows: any[] = [];
    for (const p of products as any[]) {
      const s: any = sm.get(p.id);
      const isTile = p.unit_type === 'box_sft';
      const ppb = Math.max(1, Number(p.pieces_per_box ?? 1) || 1);
      const boxQty = Number(s?.box_qty ?? 0);
      const pieceQty = Number(s?.piece_qty ?? 0);
      const totalPieces = Number(s?.total_pieces ?? 0);
      const currentStock = isTile ? boxQty : pieceQty;
      const reorderLevel = Number(p.reorder_level ?? 0);
      if (currentStock <= reorderLevel) {
        rows.push({
          productId: p.id, sku: p.sku, name: p.name, brand: p.brand,
          category: p.category, unitType: p.unit_type,
          piecesPerBox: ppb,
          totalPieces,
          currentStock, reorderLevel,
          suggestedReorderQty: Math.max(0, reorderLevel * 2 - currentStock),
        });
      }
    }
    rows.sort((a, b) => (a.currentStock - a.reorderLevel) - (b.currentStock - b.reorderLevel));
    res.json(rows);
  } catch (err) {
    console.error('[reports.low-stock]', err);
    res.status(500).json({ error: 'Failed to load low stock report' });
  }
});

// ─── Free vs Reserved Stock (Phase 3U-4) ──────────────────────────────────
router.get('/free-vs-reserved', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  try {
    const [products, stock] = await Promise.all([
      db('products')
        .where({ dealer_id: dealerId, active: true })
        .select('id', 'name', 'sku', 'unit_type')
        .orderBy('sku'),
      db('stock')
        .where({ dealer_id: dealerId })
        .select('product_id', 'box_qty', 'piece_qty', 'reserved_box_qty', 'reserved_piece_qty'),
    ]);
    const stockMap = new Map<string, any>((stock as any[]).map((s) => [s.product_id, s]));
    const rows = (products as any[])
      .map((p) => {
        const s = stockMap.get(p.id);
        const total =
          p.unit_type === 'box_sft' ? Number(s?.box_qty ?? 0) : Number(s?.piece_qty ?? 0);
        const reserved =
          p.unit_type === 'box_sft'
            ? Number(s?.reserved_box_qty ?? 0)
            : Number(s?.reserved_piece_qty ?? 0);
        return {
          name: p.name,
          sku: p.sku,
          unitType: p.unit_type,
          total,
          reserved,
          free: total - reserved,
        };
      })
      .filter((r) => r.total > 0 || r.reserved > 0);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.free-vs-reserved]', err.message);
    res.status(500).json({ error: 'Failed to load free vs reserved report' });
  }
});

// ─── Sales by Salesman (Phase 3U-4) ───────────────────────────────────────
router.get('/sales-by-salesman', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
  const month = parseInt((req.query.month as string) || `${new Date().getMonth() + 1}`, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    res.status(400).json({ error: 'Invalid year/month' });
    return;
  }
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  try {
    const sales = await db('sales')
      .where({ dealer_id: dealerId })
      .andWhere('sale_date', '>=', startDate)
      .andWhere('sale_date', '<=', endDate)
      .select('id', 'total_amount', 'paid_amount', 'due_amount', 'discount', 'created_by');

    const userIds = Array.from(
      new Set((sales as any[]).map((s) => s.created_by).filter(Boolean)),
    );
    const profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const profiles = await db('profiles').whereIn('id', userIds).select('id', 'name');
      for (const p of profiles as any[]) profileMap[p.id] = p.name;
    }

    const map: Record<
      string,
      { name: string; count: number; total: number; paid: number; due: number; discount: number }
    > = {};
    for (const s of sales as any[]) {
      const uid = s.created_by ?? 'unknown';
      if (!map[uid]) {
        map[uid] = {
          name: profileMap[uid] ?? 'Unknown',
          count: 0,
          total: 0,
          paid: 0,
          due: 0,
          discount: 0,
        };
      }
      map[uid].count += 1;
      map[uid].total += Number(s.total_amount);
      map[uid].paid += Number(s.paid_amount);
      map[uid].due += Number(s.due_amount);
      map[uid].discount += Number(s.discount);
    }

    const rows = Object.values(map).sort((a, b) => b.total - a.total);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.sales-by-salesman]', err.message);
    res.status(500).json({ error: 'Failed to load sales-by-salesman report' });
  }
});

// ─── Supplier Outstanding (Phase 3U-4) ────────────────────────────────────
router.get('/supplier-outstanding', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  try {
    const [ledger, suppliers] = await Promise.all([
      fetchSupplierLedgerEntries(dealerId),
      db('suppliers')
        .where({ dealer_id: dealerId })
        .select('id', 'name', 'phone', 'status'),
    ]);
    const suppMap = new Map<string, any>((suppliers as any[]).map((s) => [s.id, s]));
    const bySupplier = groupSupplierLedger(ledger);
    const rows = Array.from(bySupplier.entries())
      .map(([sid, entryRows]) => {
        const s = suppMap.get(sid);
        const outstanding = computeSupplierBalance(entryRows);
        const totalPurchase = entryRows
          .filter((r) => r.type === 'purchase')
          .reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0);
        const totalPaid = entryRows
          .filter((r) => r.type === 'payment')
          .reduce((sum, r) => sum + Number(r.amount), 0);
        const paymentCount = entryRows.filter((r) => r.type === 'payment').length;
        return {
          supplierId: sid,
          name: s?.name ?? '—',
          phone: s?.phone ?? '—',
          totalPurchase: round2(totalPurchase),
          totalPaid: round2(totalPaid),
          outstanding: round2(outstanding),
          payments: paymentCount,
        };
      })
      .filter((r) => r.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.supplier-outstanding]', err.message);
    res.status(500).json({ error: 'Failed to load supplier outstanding report' });
  }
});

// ─── Sale overdue check for a single customer (Phase 3U-4) ────────────────
router.get('/sale-overdue-check', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const customerId = (req.query.customerId as string | undefined) || '';
  if (!customerId) {
    res.status(400).json({ error: 'customerId is required' });
    return;
  }
  try {
    const [customer, ledger, oldestSale] = await Promise.all([
      db('customers')
        .where({ id: customerId, dealer_id: dealerId })
        .select('credit_limit', 'max_overdue_days')
        .first(),
      db('customer_ledger')
        .where({ customer_id: customerId, dealer_id: dealerId })
        .select('amount', 'type'),
      db('sales')
        .where({ customer_id: customerId, dealer_id: dealerId })
        .andWhere('due_amount', '>', 0)
        .orderBy('sale_date', 'asc')
        .select('sale_date')
        .first(),
    ]);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    let outstanding = 0;
    for (const row of ledger as any[]) {
      const amt = Number(row.amount);
      if (row.type === 'sale') outstanding += amt;
      else if (row.type === 'payment' || row.type === 'refund') outstanding -= amt;
      else if (row.type === 'adjustment') outstanding += amt;
    }
    const oldestDate = (oldestSale as any)?.sale_date ?? null;
    const daysOverdue = oldestDate
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(oldestDate).getTime()) / 86400000),
        )
      : 0;
    const maxOverdueDays = Number(customer.max_overdue_days ?? 0);
    const creditLimit = Number(customer.credit_limit ?? 0);
    res.json({
      outstanding: round2(outstanding),
      daysOverdue,
      maxOverdueDays,
      creditLimit,
      isOverdueViolated: maxOverdueDays > 0 && daysOverdue > maxOverdueDays,
      isCreditExceeded: creditLimit > 0 && outstanding > creditLimit,
    });
  } catch (err: any) {
    console.error('[reports.sale-overdue-check]', err.message);
    res.status(500).json({ error: 'Failed to load overdue check' });
  }
});

// ─── Reserved Stock report (full join) ────────────────────────────────────
router.get('/reservations-active', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .where({ 'sr.dealer_id': dealerId, 'sr.status': 'active' })
      .orderBy('sr.created_at', 'desc')
      .select(
        'sr.id',
        'sr.reserved_qty',
        'sr.fulfilled_qty',
        'sr.released_qty',
        'sr.status',
        'sr.expires_at',
        'sr.reason',
        'sr.created_at',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit_type as product_unit_type',
        'p.default_sale_rate as product_default_sale_rate',
        'c.id as customer_id',
        'c.name as customer_name',
        'pb.batch_no',
        'pb.shade_code',
        'pb.caliber',
      );
    res.json({
      rows: (rows as any[]).map((r) => ({
        id: r.id,
        reserved_qty: r.reserved_qty,
        fulfilled_qty: r.fulfilled_qty,
        released_qty: r.released_qty,
        status: r.status,
        expires_at: r.expires_at,
        reason: r.reason,
        created_at: r.created_at,
        products: {
          name: r.product_name,
          sku: r.product_sku,
          unit_type: r.product_unit_type,
          default_sale_rate: r.product_default_sale_rate,
        },
        customers: r.customer_id ? { id: r.customer_id, name: r.customer_name } : null,
        product_batches: r.batch_no
          ? { batch_no: r.batch_no, shade_code: r.shade_code, caliber: r.caliber }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[reports.reservations-active]', err.message);
    res.status(500).json({ error: 'Failed to load reservations' });
  }
});

router.get('/reservations-expiring', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const days = Math.max(1, parseInt((req.query.days as string) || '7', 10));
  const cutoff = new Date(Date.now() + days * 86400000).toISOString();
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .where({ 'sr.dealer_id': dealerId, 'sr.status': 'active' })
      .whereNotNull('sr.expires_at')
      .andWhere('sr.expires_at', '<=', cutoff)
      .orderBy('sr.expires_at', 'asc')
      .select(
        'sr.id',
        'sr.reserved_qty',
        'sr.fulfilled_qty',
        'sr.released_qty',
        'sr.expires_at',
        'sr.reason',
        'p.name as product_name',
        'p.sku as product_sku',
        'c.name as customer_name',
        'pb.batch_no',
        'pb.shade_code',
      );
    res.json({
      rows: (rows as any[]).map((r) => ({
        id: r.id,
        reserved_qty: r.reserved_qty,
        fulfilled_qty: r.fulfilled_qty,
        released_qty: r.released_qty,
        expires_at: r.expires_at,
        reason: r.reason,
        products: { name: r.product_name, sku: r.product_sku },
        customers: { name: r.customer_name },
        product_batches: r.batch_no
          ? { batch_no: r.batch_no, shade_code: r.shade_code }
          : null,
      })),
    });
  } catch (err: any) {
    console.error('[reports.reservations-expiring]', err.message);
    res.status(500).json({ error: 'Failed to load expiring reservations' });
  }
});

router.get('/reservations-by-customer', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .where({ 'sr.dealer_id': dealerId, 'sr.status': 'active' })
      .select(
        'sr.reserved_qty',
        'sr.fulfilled_qty',
        'sr.released_qty',
        'c.id as customer_id',
        'c.name as customer_name',
        'p.default_sale_rate as product_default_sale_rate',
      );
    const custMap: Record<
      string,
      { name: string; holds: number; totalQty: number; totalValue: number }
    > = {};
    for (const r of rows as any[]) {
      const cid = r.customer_id;
      if (!cid) continue;
      const remaining =
        Number(r.reserved_qty) - Number(r.fulfilled_qty) - Number(r.released_qty);
      const rate = Number(r.product_default_sale_rate ?? 0);
      if (!custMap[cid]) {
        custMap[cid] = { name: r.customer_name, holds: 0, totalQty: 0, totalValue: 0 };
      }
      custMap[cid].holds += 1;
      custMap[cid].totalQty += remaining;
      custMap[cid].totalValue += remaining * rate;
    }
    res.json({
      rows: Object.values(custMap).sort((a, b) => b.totalValue - a.totalValue),
    });
  } catch (err: any) {
    console.error('[reports.reservations-by-customer]', err.message);
    res.status(500).json({ error: 'Failed to load customer reservations' });
  }
});

router.get('/reservations-by-batch', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('stock_reservations as sr')
      .leftJoin('products as p', 'p.id', 'sr.product_id')
      .leftJoin('customers as c', 'c.id', 'sr.customer_id')
      .leftJoin('product_batches as pb', 'pb.id', 'sr.batch_id')
      .where({ 'sr.dealer_id': dealerId, 'sr.status': 'active' })
      .whereNotNull('sr.batch_id')
      .orderBy('sr.created_at', 'desc')
      .select(
        'sr.reserved_qty',
        'sr.fulfilled_qty',
        'sr.released_qty',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit_type as product_unit_type',
        'c.name as customer_name',
        'pb.id as batch_id',
        'pb.batch_no',
        'pb.shade_code',
        'pb.caliber',
        'pb.box_qty as batch_box_qty',
        'pb.piece_qty as batch_piece_qty',
        'pb.reserved_box_qty as batch_reserved_box_qty',
        'pb.reserved_piece_qty as batch_reserved_piece_qty',
      );
    res.json({
      rows: (rows as any[]).map((r) => ({
        reserved_qty: r.reserved_qty,
        fulfilled_qty: r.fulfilled_qty,
        released_qty: r.released_qty,
        products: {
          name: r.product_name,
          sku: r.product_sku,
          unit_type: r.product_unit_type,
        },
        customers: { name: r.customer_name },
        product_batches: {
          id: r.batch_id,
          batch_no: r.batch_no,
          shade_code: r.shade_code,
          caliber: r.caliber,
          box_qty: r.batch_box_qty,
          piece_qty: r.batch_piece_qty,
          reserved_box_qty: r.batch_reserved_box_qty,
          reserved_piece_qty: r.batch_reserved_piece_qty,
        },
      })),
    });
  } catch (err: any) {
    console.error('[reports.reservations-by-batch]', err.message);
    res.status(500).json({ error: 'Failed to load batch reservations' });
  }
});

// ─── Pending Deliveries (Phase 3U-5) ──────────────────────────────────────
router.get('/pending-deliveries', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('challans as ch')
      .leftJoin('sales as s', 's.id', 'ch.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where({ 'ch.dealer_id': dealerId })
      .andWhereNot('ch.delivery_status', 'delivered')
      .orderBy('ch.challan_date', 'asc')
      .select(
        'ch.id',
        'ch.challan_no',
        'ch.challan_date',
        'ch.delivery_status',
        'ch.transport_name',
        'ch.vehicle_no',
        'ch.driver_name',
        's.invoice_number as invoice_number',
        'c.name as customer_name',
      );
    const today = Date.now();
    res.json({
      rows: (rows as any[]).map((r) => {
        const days = Math.floor(
          (today - new Date(r.challan_date).getTime()) / 86_400_000,
        );
        return {
          challanNo: r.challan_no,
          challanDate: r.challan_date,
          invoiceNo: r.invoice_number ?? '—',
          customer: r.customer_name ?? '—',
          status: r.delivery_status,
          transport: r.transport_name ?? '—',
          vehicle: r.vehicle_no ?? '—',
          daysPending: days,
          isLate: days > 2,
        };
      }),
    });
  } catch (err: any) {
    console.error('[reports.pending-deliveries]', err.message);
    res.status(500).json({ error: 'Failed to load pending deliveries' });
  }
});

// ─── Delivery Status (Phase 3U-5) ─────────────────────────────────────────
router.get('/delivery-status', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const status = (req.query.status as string | undefined) || 'all';
  try {
    let q = db('challans as ch')
      .leftJoin('sales as s', 's.id', 'ch.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where({ 'ch.dealer_id': dealerId })
      .orderBy('ch.challan_date', 'desc')
      .limit(100)
      .select(
        'ch.id',
        'ch.challan_no',
        'ch.challan_date',
        'ch.delivery_status',
        'ch.transport_name',
        'ch.vehicle_no',
        'ch.driver_name',
        's.invoice_number as invoice_number',
        'c.name as customer_name',
      );
    if (status !== 'all') q = q.andWhere('ch.delivery_status', status);
    const rows = await q;
    res.json({
      rows: (rows as any[]).map((r) => ({
        challanNo: r.challan_no,
        challanDate: r.challan_date,
        invoiceNo: r.invoice_number ?? '—',
        customer: r.customer_name ?? '—',
        status: r.delivery_status,
        transport: r.transport_name ?? '—',
        vehicle: r.vehicle_no ?? '—',
        driver: r.driver_name ?? '—',
      })),
    });
  } catch (err: any) {
    console.error('[reports.delivery-status]', err.message);
    res.status(500).json({ error: 'Failed to load delivery status' });
  }
});

// ─── Stock Movement (Phase 3U-5) ──────────────────────────────────────────
router.get('/stock-movement', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const productId = (req.query.productId as string | undefined) || '';
  if (!productId) {
    res.status(400).json({ error: 'productId is required' });
    return;
  }
  try {
    const product = await db('products')
      .where({ dealer_id: dealerId, id: productId })
      .first('unit_type', 'pieces_per_box');
    const [purchaseItems, saleItems, returns] = await Promise.all([
      db('purchase_items as pi')
        .leftJoin('purchases as p', 'p.id', 'pi.purchase_id')
        .where({ 'pi.dealer_id': dealerId, 'pi.product_id': productId })
        .select(
          'pi.id',
          'pi.quantity',
          'pi.purchase_rate',
          'pi.total',
          'p.purchase_date',
          'p.invoice_number',
        ),
      db('sale_items as si')
        .leftJoin('sales as s', 's.id', 'si.sale_id')
        .where({ 'si.dealer_id': dealerId, 'si.product_id': productId })
        .select(
          'si.id',
          'si.quantity',
          'si.sale_rate',
          'si.total',
          's.sale_date',
          's.invoice_number',
        ),
      db('sales_returns as sr')
        .leftJoin('sales as s', 's.id', 'sr.sale_id')
        .where({ 'sr.dealer_id': dealerId, 'sr.product_id': productId })
        .select(
          'sr.id',
          'sr.qty',
          'sr.refund_amount',
          'sr.return_date',
          'sr.is_broken',
          's.invoice_number',
        ),
    ]);

    type MovementRow = {
      id: string;
      date: string;
      type: string;
      reference: string;
      qtyIn: number;
      qtyOut: number;
      rate: number;
      total: number;
    };
    const movements: MovementRow[] = [];
    for (const pi of purchaseItems as any[]) {
      movements.push({
        id: pi.id,
        date: pi.purchase_date ?? '',
        type: 'Purchase',
        reference: pi.invoice_number ?? '—',
        qtyIn: Number(pi.quantity),
        qtyOut: 0,
        rate: Number(pi.purchase_rate),
        total: Number(pi.total),
      });
    }
    for (const si of saleItems as any[]) {
      movements.push({
        id: si.id,
        date: si.sale_date ?? '',
        type: 'Sale',
        reference: si.invoice_number ?? '—',
        qtyIn: 0,
        qtyOut: Number(si.quantity),
        rate: Number(si.sale_rate),
        total: Number(si.total),
      });
    }
    for (const sr of returns as any[]) {
      movements.push({
        id: sr.id,
        date: sr.return_date,
        type: sr.is_broken ? 'Return (Broken)' : 'Return',
        reference: sr.invoice_number ?? '—',
        qtyIn: sr.is_broken ? 0 : Number(sr.qty),
        qtyOut: sr.is_broken ? Number(sr.qty) : 0,
        rate: 0,
        total: Number(sr.refund_amount),
      });
    }
    movements.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    const withBalance = movements.map((m) => {
      balance += m.qtyIn - m.qtyOut;
      return { ...m, balance };
    });
    res.json({
      rows: withBalance,
      unitType: product?.unit_type ?? 'piece',
      piecesPerBox: Number(product?.pieces_per_box) || 1,
    });
  } catch (err: any) {
    console.error('[reports.stock-movement]', err.message);
    res.status(500).json({ error: 'Failed to load stock movement' });
  }
});

// ─── Quotation Reports (Phase 3U-6) ───────────────────────────────────────

// GET /api/reports/quotations/list?dealerId=&from=&to=&status=
router.get('/quotations/list', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';
  const status = (req.query.status as string) || 'all';
  try {
    let q = db('quotations as q')
      .leftJoin('customers as c', 'c.id', 'q.customer_id')
      .where({ 'q.dealer_id': dealerId })
      .orderBy('q.created_at', 'desc')
      .limit(500)
      .select('q.*', 'c.name as customer_name');
    if (from) q = q.where('q.quote_date', '>=', from);
    if (to) q = q.where('q.quote_date', '<=', to);
    if (status !== 'all') q = q.where('q.status', status);
    const rows = await q;
    res.json({
      rows: rows.map((r: any) => ({
        ...r,
        customers: r.customer_name ? { name: r.customer_name } : null,
      })),
    });
  } catch (err: any) {
    console.error('[reports.quotations.list]', err.message);
    res.status(500).json({ error: 'Failed to load quotation list' });
  }
});

// GET /api/reports/quotations/conversion?dealerId=&from=&to=
router.get('/quotations/conversion', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';
  try {
    let q = db('quotations')
      .where({ dealer_id: dealerId })
      .select('id', 'status', 'total_amount', 'created_at', 'converted_at');
    if (from) q = q.where('quote_date', '>=', from);
    if (to) q = q.where('quote_date', '<=', to);
    const rows = await q;
    const finalized = rows.filter((r: any) => r.status !== 'draft' && r.status !== 'cancelled');
    const converted = rows.filter((r: any) => r.status === 'converted');
    const totalQuotedValue = finalized.reduce((s, r: any) => s + Number(r.total_amount), 0);
    const convertedValue = converted.reduce((s, r: any) => s + Number(r.total_amount), 0);
    const conversionPct = finalized.length > 0 ? (converted.length / finalized.length) * 100 : 0;
    const avgDays = converted.length > 0
      ? converted.reduce((s, r: any) => {
          const c = new Date(r.created_at).getTime();
          const cv = r.converted_at ? new Date(r.converted_at).getTime() : c;
          return s + Math.max(0, (cv - c) / 86400000);
        }, 0) / converted.length
      : 0;
    res.json({
      finalizedCount: finalized.length,
      convertedCount: converted.length,
      totalQuotedValue: round2(totalQuotedValue),
      convertedValue: round2(convertedValue),
      conversionPct: round2(conversionPct),
      avgDays: round2(avgDays),
    });
  } catch (err: any) {
    console.error('[reports.quotations.conversion]', err.message);
    res.status(500).json({ error: 'Failed to load quotation conversion' });
  }
});

// GET /api/reports/quotations/expired?dealerId=
router.get('/quotations/expired', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const rows = await db('quotations as q')
      .leftJoin('customers as c', 'c.id', 'q.customer_id')
      .where({ 'q.dealer_id': dealerId, 'q.status': 'expired' })
      .orderBy('q.valid_until', 'desc')
      .limit(500)
      .select('q.*', 'c.name as customer_name');
    res.json({
      rows: rows.map((r: any) => ({
        ...r,
        customers: r.customer_name ? { name: r.customer_name } : null,
      })),
    });
  } catch (err: any) {
    console.error('[reports.quotations.expired]', err.message);
    res.status(500).json({ error: 'Failed to load expired quotations' });
  }
});

// GET /api/reports/quotations/salesman?dealerId=&from=&to=
router.get('/quotations/salesman', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';
  try {
    let q = db('quotations')
      .where({ dealer_id: dealerId })
      .select('created_by', 'status', 'total_amount');
    if (from) q = q.where('quote_date', '>=', from);
    if (to) q = q.where('quote_date', '<=', to);
    const quotes = await q;
    const profs = await db('profiles').where({ dealer_id: dealerId }).select('id', 'name');
    const nameMap = new Map(profs.map((p: any) => [p.id, p.name]));
    const agg = new Map<string, { name: string; quotes: number; converted: number; value: number; convertedValue: number }>();
    for (const it of quotes) {
      const key = (it as any).created_by ?? 'unknown';
      const cur = agg.get(key) ?? { name: nameMap.get(key) ?? 'Unknown', quotes: 0, converted: 0, value: 0, convertedValue: 0 };
      cur.quotes++;
      cur.value += Number((it as any).total_amount);
      if ((it as any).status === 'converted') {
        cur.converted++;
        cur.convertedValue += Number((it as any).total_amount);
      }
      agg.set(key, cur);
    }
    const rows = Array.from(agg.values()).sort((a, b) => b.value - a.value);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.quotations.salesman]', err.message);
    res.status(500).json({ error: 'Failed to load salesman quotation performance' });
  }
});

// GET /api/reports/quotations/top-products?dealerId=&from=&to=
router.get('/quotations/top-products', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;
  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';
  try {
    let q = db('quotation_items as qi')
      .innerJoin('quotations as q', 'q.id', 'qi.quotation_id')
      .where({ 'qi.dealer_id': dealerId })
      .whereNotIn('q.status', ['draft', 'cancelled'])
      .select('qi.product_name_snapshot', 'qi.quantity', 'qi.line_total');
    if (from) q = q.where('q.quote_date', '>=', from);
    if (to) q = q.where('q.quote_date', '<=', to);
    const items = await q;
    const agg = new Map<string, { name: string; qty: number; value: number; count: number }>();
    for (const it of items) {
      const key = (it as any).product_name_snapshot;
      const cur = agg.get(key) ?? { name: key, qty: 0, value: 0, count: 0 };
      cur.qty += Number((it as any).quantity);
      cur.value += Number((it as any).line_total);
      cur.count++;
      agg.set(key, cur);
    }
    const rows = Array.from(agg.values()).sort((a, b) => b.value - a.value).slice(0, 25);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.quotations.top-products]', err.message);
    res.status(500).json({ error: 'Failed to load top quoted products' });
  }
});

// ─── Batch Reports (Phase 3U-8) ───────────────────────────────────────────

// GET /api/reports/batches/stock?dealerId=&status=&search=
router.get('/batches/stock', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const status = (req.query.status as string) || 'active';
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  try {
    let q = db('product_batches as b')
      .leftJoin('products as p', 'p.id', 'b.product_id')
      .where({ 'b.dealer_id': dealerId })
      .orderBy('b.created_at', 'desc')
      .limit(500)
      .select(
        'b.*',
        'p.name as product_name', 'p.sku as product_sku',
        'p.unit_type as product_unit_type', 'p.category as product_category',
      );
    if (status !== 'all') q = q.where('b.status', status);
    let rows = (await q).map((r: any) => ({
      ...r,
      products: {
        name: r.product_name, sku: r.product_sku,
        unit_type: r.product_unit_type, category: r.product_category,
      },
    }));
    if (search) {
      rows = rows.filter((r: any) =>
        r.products?.name?.toLowerCase().includes(search) ||
        r.products?.sku?.toLowerCase().includes(search) ||
        r.batch_no?.toLowerCase().includes(search) ||
        r.shade_code?.toLowerCase().includes(search),
      );
    }
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.batches.stock]', err.message);
    res.status(500).json({ error: 'Failed to load batch stock' });
  }
});

// GET /api/reports/batches/mixed-sales?dealerId=
router.get('/batches/mixed-sales', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const sibs = await db('sale_item_batches as sib')
      .leftJoin('product_batches as pb', 'pb.id', 'sib.batch_id')
      .where({ 'sib.dealer_id': dealerId })
      .select(
        'sib.sale_item_id', 'sib.batch_id', 'sib.allocated_qty',
        'pb.batch_no', 'pb.shade_code', 'pb.caliber',
      );

    const grouped: Record<string, any[]> = {};
    for (const sib of sibs as any[]) {
      const key = sib.sale_item_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(sib);
    }

    const mixedSaleItemIds: string[] = [];
    const mixedDetails: Record<string, { batches: any[]; mixedShade: boolean; mixedCaliber: boolean }> = {};
    for (const [siId, batches] of Object.entries(grouped)) {
      if (batches.length <= 1) continue;
      const shades = new Set(batches.map((b: any) => b.shade_code).filter(Boolean));
      const calibers = new Set(batches.map((b: any) => b.caliber).filter(Boolean));
      const mixedShade = shades.size > 1;
      const mixedCaliber = calibers.size > 1;
      if (mixedShade || mixedCaliber) {
        mixedSaleItemIds.push(siId);
        mixedDetails[siId] = { batches, mixedShade, mixedCaliber };
      }
    }
    if (mixedSaleItemIds.length === 0) return res.json({ rows: [] });

    const saleItems = await db('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .leftJoin('sales as s', 's.id', 'si.sale_id')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .whereIn('si.id', mixedSaleItemIds)
      .where({ 'si.dealer_id': dealerId })
      .select(
        'si.id', 'si.product_id', 'si.quantity', 'si.sale_id',
        'p.name as product_name', 'p.sku as product_sku',
        's.invoice_number', 's.sale_date',
        'c.name as customer_name',
      );

    res.json({
      rows: saleItems.map((si: any) => ({
        saleItemId: si.id,
        invoiceNo: si.invoice_number ?? '—',
        saleDate: si.sale_date,
        customer: si.customer_name ?? '—',
        product: si.product_name ?? '—',
        sku: si.product_sku ?? '—',
        quantity: Number(si.quantity),
        mixedShade: mixedDetails[si.id]?.mixedShade ?? false,
        mixedCaliber: mixedDetails[si.id]?.mixedCaliber ?? false,
        batches: (mixedDetails[si.id]?.batches ?? []).map((b: any) => ({
          batch_no: b.batch_no,
          shade: b.shade_code ?? '—',
          caliber: b.caliber ?? '—',
          qty: Number(b.allocated_qty),
        })),
      })),
    });
  } catch (err: any) {
    console.error('[reports.batches.mixed-sales]', err.message);
    res.status(500).json({ error: 'Failed to load mixed batch sales' });
  }
});

// GET /api/reports/batches/aging?dealerId=
router.get('/batches/aging', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  try {
    const data = await db('product_batches as b')
      .leftJoin('products as p', 'p.id', 'b.product_id')
      .where({ 'b.dealer_id': dealerId, 'b.status': 'active' })
      .orderBy('b.created_at', 'asc')
      .select(
        'b.id', 'b.batch_no', 'b.shade_code', 'b.caliber',
        'b.box_qty', 'b.piece_qty', 'b.sft_qty', 'b.created_at',
        'p.name as product_name', 'p.sku as product_sku', 'p.unit_type',
      );
    const now = Date.now();
    const rows = data.map((r: any) => {
      const days = Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000);
      const isBox = r.unit_type === 'box_sft';
      const qty = isBox ? Number(r.box_qty) : Number(r.piece_qty);
      return {
        id: r.id,
        product: r.product_name ?? '—',
        sku: r.product_sku ?? '—',
        batch_no: r.batch_no,
        shade: r.shade_code ?? '—',
        caliber: r.caliber ?? '—',
        qty,
        unit: isBox ? 'box' : 'pc',
        sft: isBox ? Number(r.sft_qty ?? 0) : 0,
        ageDays: days,
        ageCategory: days > 180 ? '180+' : days > 90 ? '91-180' : days > 30 ? '31-90' : '0-30',
        received: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null,
      };
    }).filter((r: any) => r.qty > 0).sort((a: any, b: any) => b.ageDays - a.ageDays);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.batches.aging]', err.message);
    res.status(500).json({ error: 'Failed to load batch aging' });
  }
});

// GET /api/reports/batches/movement?dealerId=&search=
router.get('/batches/movement', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  try {
    const [batches, sibs, dibs] = await Promise.all([
      db('product_batches as b')
        .leftJoin('products as p', 'p.id', 'b.product_id')
        .where({ 'b.dealer_id': dealerId })
        .orderBy('b.created_at', 'desc')
        .limit(500)
        .select(
          'b.id', 'b.batch_no', 'b.shade_code', 'b.caliber',
          'b.box_qty', 'b.piece_qty', 'b.status',
          'p.name as product_name', 'p.sku as product_sku', 'p.unit_type',
        ),
      db('sale_item_batches').where({ dealer_id: dealerId }).select('batch_id', 'allocated_qty'),
      db('delivery_item_batches').where({ dealer_id: dealerId }).select('batch_id', 'delivered_qty'),
    ]);
    const saleMap: Record<string, number> = {};
    for (const sib of sibs as any[]) {
      saleMap[sib.batch_id] = (saleMap[sib.batch_id] || 0) + Number(sib.allocated_qty);
    }
    const deliveryMap: Record<string, number> = {};
    for (const dib of dibs as any[]) {
      deliveryMap[dib.batch_id] = (deliveryMap[dib.batch_id] || 0) + Number(dib.delivered_qty);
    }
    let rows = batches.map((b: any) => {
      const isBox = b.unit_type === 'box_sft';
      const currentQty = isBox ? Number(b.box_qty) : Number(b.piece_qty);
      const soldQty = saleMap[b.id] || 0;
      const deliveredQty = deliveryMap[b.id] || 0;
      const purchasedQty = currentQty + soldQty;
      return {
        id: b.id,
        product: b.product_name ?? '—',
        sku: b.product_sku ?? '—',
        batch_no: b.batch_no,
        shade: b.shade_code ?? '—',
        caliber: b.caliber ?? '—',
        unit: isBox ? 'box' : 'pc',
        purchased: purchasedQty,
        sold: soldQty,
        delivered: deliveredQty,
        current: currentQty,
        status: b.status,
      };
    });
    if (search) {
      rows = rows.filter((r: any) =>
        r.product.toLowerCase().includes(search) ||
        r.sku.toLowerCase().includes(search) ||
        r.batch_no.toLowerCase().includes(search),
      );
    }
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.batches.movement]', err.message);
    res.status(500).json({ error: 'Failed to load batch movement' });
  }
});

// ─── Approval Reports (Phase 3U-8) ────────────────────────────────────────

// GET /api/reports/approvals/history?dealerId=&from=&to=&status=&type=
router.get('/approvals/history', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const from = (req.query.from as string) || '1970-01-01';
  const to = (req.query.to as string) || '9999-12-31';
  const status = (req.query.status as string) || 'all';
  const type = (req.query.type as string) || 'all';
  try {
    let q = db('approval_requests')
      .where({ dealer_id: dealerId })
      .where('created_at', '>=', `${from}T00:00:00`)
      .where('created_at', '<=', `${to}T23:59:59`)
      .orderBy('created_at', 'desc')
      .limit(500);
    if (status !== 'all') q = q.where('status', status);
    if (type !== 'all') q = q.where('approval_type', type);
    const rows = await q;
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.approvals.history]', err.message);
    res.status(500).json({ error: 'Failed to load approval history' });
  }
});

// GET /api/reports/approvals/type-summary?dealerId=&from=&to=
router.get('/approvals/type-summary', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const from = (req.query.from as string) || '1970-01-01';
  const to = (req.query.to as string) || '9999-12-31';
  try {
    const data = await db('approval_requests')
      .where({ dealer_id: dealerId })
      .where('created_at', '>=', `${from}T00:00:00`)
      .where('created_at', '<=', `${to}T23:59:59`)
      .select('approval_type', 'status');
    const map = new Map<string, { total: number; approved: number; rejected: number; pending: number; auto: number }>();
    for (const r of data as any[]) {
      const t = r.approval_type;
      const cur = map.get(t) ?? { total: 0, approved: 0, rejected: 0, pending: 0, auto: 0 };
      cur.total++;
      if (r.status === 'approved' || r.status === 'consumed') cur.approved++;
      else if (r.status === 'rejected') cur.rejected++;
      else if (r.status === 'pending') cur.pending++;
      else if (r.status === 'auto_approved') cur.auto++;
      map.set(t, cur);
    }
    const rows = Array.from(map.entries()).map(([type, stats]) => ({ type, ...stats })).sort((a, b) => b.total - a.total);
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.approvals.type-summary]', err.message);
    res.status(500).json({ error: 'Failed to load approval type summary' });
  }
});

// GET /api/reports/approvals/user-stats?dealerId=&from=&to=
router.get('/approvals/user-stats', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  const from = (req.query.from as string) || '1970-01-01';
  const to = (req.query.to as string) || '9999-12-31';
  try {
    const approvals = await db('approval_requests')
      .where({ dealer_id: dealerId })
      .where('created_at', '>=', `${from}T00:00:00`)
      .where('created_at', '<=', `${to}T23:59:59`)
      .select('requested_by', 'decided_by', 'status');
    const userIds = new Set<string>();
    for (const a of approvals as any[]) {
      if (a.requested_by) userIds.add(a.requested_by);
      if (a.decided_by) userIds.add(a.decided_by);
    }
    const profiles = userIds.size > 0
      ? await db('profiles').whereIn('id', Array.from(userIds)).select('id', 'name', 'email')
      : [];
    const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
    const stats = new Map<string, { name: string; requested: number; approved: number; rejected: number }>();
    const ensure = (id: string) => {
      const cur = stats.get(id);
      if (cur) return cur;
      const u = profileMap.get(id);
      const fresh = { name: u?.name ?? u?.email ?? 'Unknown', requested: 0, approved: 0, rejected: 0 };
      stats.set(id, fresh);
      return fresh;
    };
    for (const a of approvals as any[]) {
      if (a.requested_by) ensure(a.requested_by).requested++;
      if (a.decided_by && (a.status === 'approved' || a.status === 'consumed')) ensure(a.decided_by).approved++;
      if (a.decided_by && a.status === 'rejected') ensure(a.decided_by).rejected++;
    }
    const rows = Array.from(stats.entries())
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => (b.requested + b.approved + b.rejected) - (a.requested + a.approved + a.rejected));
    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.approvals.user-stats]', err.message);
    res.status(500).json({ error: 'Failed to load user approval stats' });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// Phase 3U-10 — ReportsPageContent inline reports
// All financial / dealer_admin gated.
// ════════════════════════════════════════════════════════════════════════════

const toNum = (v: any) => Number(v ?? 0) || 0;

// ─── A. Daily Sales Calendar ─────────────────────────────────────────────
// GET /api/reports/page/daily-sales-calendar?dealerId=&year=&month= (month: 1-12)
router.get('/page/daily-sales-calendar', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const year = parseInt((req.query.year as string) || '', 10);
  const month = parseInt((req.query.month as string) || '', 10); // 1-12
  if (!year || !month || month < 1 || month > 12) {
    res.status(400).json({ error: 'year and month (1-12) required' });
    return;
  }

  try {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const rows = await db('sales')
      .where({ dealer_id: dealerId })
      .whereBetween('sale_date', [startDate, endDate])
      .select('sale_date', 'total_amount', 'discount', 'paid_amount', 'due_amount');

    const dayMap: Record<number, { discount: number; total: number }> = {};
    for (const r of rows as any[]) {
      const day = new Date(r.sale_date).getDate();
      if (!dayMap[day]) dayMap[day] = { discount: 0, total: 0 };
      dayMap[day].discount += toNum(r.discount);
      dayMap[day].total += toNum(r.total_amount);
    }
    res.json({ dayMap });
  } catch (err: any) {
    console.error('[reports.page.daily-sales-calendar]', err.message);
    res.status(500).json({ error: 'Failed to load daily sales calendar' });
  }
});

// ─── B. Detailed Sales Report (paged) ────────────────────────────────────
// GET /api/reports/page/detailed-sales?dealerId=&page=&search=
router.get('/page/detailed-sales', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim();

  try {
    let q = db('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where('s.dealer_id', dealerId);

    if (search) {
      q = q.andWhere(function () {
        this.whereILike('s.invoice_number', `%${search}%`)
          .orWhereILike('c.name', `%${search}%`);
      });
    }

    const [{ count }] = await q
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('s.id as count');

    const sales = await q
      .clone()
      .orderBy('s.created_at', 'desc')
      .offset((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select(
        's.id', 's.created_at', 's.invoice_number', 's.sale_date',
        's.total_amount', 's.paid_amount', 's.due_amount',
        's.sale_status', 's.customer_id',
        'c.name as customer_name',
      );

    const saleIds = (sales as any[]).map((s) => s.id);
    const itemsMap: Record<string, { name: string; qty: number; unitType: string; piecesPerBox: number }[]> = {};
    if (saleIds.length > 0) {
      const items = await db('sale_items as si')
        .leftJoin('products as p', 'p.id', 'si.product_id')
        .whereIn('si.sale_id', saleIds)
        .select(
          'si.sale_id', 'si.quantity',
          'p.name as p_name', 'p.size as p_size',
          'p.unit_type as p_unit_type', 'p.category as p_category',
          'p.pieces_per_box as p_ppb',
        );
      for (const it of items as any[]) {
        const sid = it.sale_id;
        if (!itemsMap[sid]) itemsMap[sid] = [];
        const baseName = it.p_category === 'tiles'
          ? (it.p_name?.includes('Wall') ? 'Wall Tiles' : (it.p_name?.includes('Floor') ? 'Floor Tiles' : it.p_name))
          : it.p_name;
        const label = it.p_name
          ? `${baseName}${it.p_size ? ` (Size: ${it.p_size})` : ''} (${it.p_unit_type === 'box_sft' ? 'Box' : 'Pcs'})`
          : 'Product';
        itemsMap[sid].push({
          name: label,
          qty: toNum(it.quantity),
          unitType: it.p_unit_type ?? 'piece',
          piecesPerBox: Number(it.p_ppb) || 1,
        });
      }
    }

    // Reshape sales to mimic legacy supabase nested customers field
    const rows = (sales as any[]).map((s) => ({
      ...s,
      customers: s.customer_name ? { name: s.customer_name } : null,
    }));

    res.json({ sales: rows, total: Number(count ?? 0), itemsMap });
  } catch (err: any) {
    console.error('[reports.page.detailed-sales]', err.message);
    res.status(500).json({ error: 'Failed to load detailed sales report' });
  }
});

// ─── C. Monthly Sales Grid ───────────────────────────────────────────────
// GET /api/reports/page/monthly-sales-grid?dealerId=&year=
router.get('/page/monthly-sales-grid', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const year = parseInt((req.query.year as string) || '', 10);
  if (!year) { res.status(400).json({ error: 'year required' }); return; }

  try {
    const rows = await db('sales')
      .where({ dealer_id: dealerId })
      .whereBetween('sale_date', [`${year}-01-01`, `${year}-12-31`])
      .select('sale_date', 'total_amount', 'discount');

    const monthMap: Record<number, { discount: number; total: number }> = {};
    for (const r of rows as any[]) {
      const m = new Date(r.sale_date).getMonth();
      if (!monthMap[m]) monthMap[m] = { discount: 0, total: 0 };
      monthMap[m].discount += toNum(r.discount);
      monthMap[m].total += toNum(r.total_amount);
    }
    res.json({ monthMap });
  } catch (err: any) {
    console.error('[reports.page.monthly-sales-grid]', err.message);
    res.status(500).json({ error: 'Failed to load monthly sales grid' });
  }
});

// ─── D. Customers Report (paged) ─────────────────────────────────────────
// GET /api/reports/page/customers-report?dealerId=&page=&search=
router.get('/page/customers-report', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim();

  try {
    let q = db('customers').where({ dealer_id: dealerId });
    if (search) {
      q = q.andWhere(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('phone', `%${search}%`);
      });
    }

    const [{ count }] = await q
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('id as count');

    const customers = await q
      .clone()
      .orderBy('name', 'asc')
      .offset((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select('id', 'name', 'phone', 'email', 'opening_balance');

    const customerIds = (customers as any[]).map((c) => c.id);
    const salesMap: Record<string, { count: number; totalAmount: number; paidAmount: number }> = {};
    if (customerIds.length > 0) {
      const sales = await db('sales')
        .where({ dealer_id: dealerId })
        .whereIn('customer_id', customerIds)
        .select('customer_id', 'total_amount', 'paid_amount');
      for (const s of sales as any[]) {
        const cid = s.customer_id;
        if (!salesMap[cid]) salesMap[cid] = { count: 0, totalAmount: 0, paidAmount: 0 };
        salesMap[cid].count += 1;
        salesMap[cid].totalAmount += toNum(s.total_amount);
        salesMap[cid].paidAmount += toNum(s.paid_amount);
      }
    }

    res.json({ customers, total: Number(count ?? 0), salesMap });
  } catch (err: any) {
    console.error('[reports.page.customers-report]', err.message);
    res.status(500).json({ error: 'Failed to load customers report' });
  }
});

// ─── E. Monthly Summary (Sales + Collection + Due + SFT) ─────────────────
// GET /api/reports/page/monthly-summary?dealerId=&year=
router.get('/page/monthly-summary', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const year = parseInt((req.query.year as string) || '', 10);
  if (!year) { res.status(400).json({ error: 'year required' }); return; }

  try {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const [salesRows, paymentRows] = await Promise.all([
      db('sales')
        .where({ dealer_id: dealerId })
        .whereBetween('sale_date', [yearStart, yearEnd])
        .select('sale_date', 'total_amount', 'paid_amount', 'due_amount', 'total_sft'),
      db('customer_ledger')
        .where({ dealer_id: dealerId })
        .whereIn('type', ['payment', 'receipt'])
        .whereBetween('entry_date', [yearStart, yearEnd])
        .select('entry_date', 'amount', 'type'),
    ]);

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const buckets = MONTHS.map((m) => ({
      month: m, totalSales: 0, totalCollection: 0, totalDue: 0, totalSft: 0, paymentReceived: 0,
    }));

    for (const r of salesRows as any[]) {
      const m = new Date(r.sale_date).getMonth();
      buckets[m].totalSales += toNum(r.total_amount);
      buckets[m].totalCollection += toNum(r.paid_amount);
      buckets[m].totalDue += toNum(r.due_amount);
      buckets[m].totalSft += toNum(r.total_sft);
    }
    for (const r of paymentRows as any[]) {
      const m = new Date(r.entry_date).getMonth();
      buckets[m].paymentReceived += Math.abs(toNum(r.amount));
    }
    res.json({ rows: buckets });
  } catch (err: any) {
    console.error('[reports.page.monthly-summary]', err.message);
    res.status(500).json({ error: 'Failed to load monthly summary' });
  }
});

// ─── F. Purchases Report (paged) ─────────────────────────────────────────
// GET /api/reports/page/purchases?dealerId=&page=&search=
router.get('/page/purchases', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim();

  try {
    let q = db('purchases as pu')
      .leftJoin('suppliers as su', 'su.id', 'pu.supplier_id')
      .where('pu.dealer_id', dealerId);

    if (search) {
      q = q.andWhere(function () {
        this.whereILike('pu.invoice_number', `%${search}%`)
          .orWhereILike('su.name', `%${search}%`);
      });
    }

    const [{ count }] = await q
      .clone()
      .clearSelect()
      .clearOrder()
      .count<{ count: string }[]>('pu.id as count');

    const purchases = await q
      .clone()
      .orderBy('pu.created_at', 'desc')
      .offset((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select(
        'pu.id', 'pu.created_at', 'pu.invoice_number', 'pu.purchase_date',
        'pu.total_amount', 'pu.supplier_id',
        'su.name as supplier_name',
      );

    const purchaseIds = (purchases as any[]).map((p) => p.id);
    const itemsMap: Record<string, { name: string; qty: number; unitType: string; piecesPerBox: number }[]> = {};
    const paidMap: Record<string, number> = {};

    if (purchaseIds.length > 0) {
      const items = await db('purchase_items as pi')
        .leftJoin('products as p', 'p.id', 'pi.product_id')
        .whereIn('pi.purchase_id', purchaseIds)
        .select(
          'pi.purchase_id', 'pi.quantity',
          'p.name as p_name', 'p.size as p_size',
          'p.unit_type as p_unit_type',
          'p.pieces_per_box as p_ppb',
        );
      for (const it of items as any[]) {
        const pid = it.purchase_id;
        if (!itemsMap[pid]) itemsMap[pid] = [];
        const label = it.p_name
          ? `${it.p_name}${it.p_size ? ` (Size: ${it.p_size})` : ''} (${it.p_unit_type === 'box_sft' ? 'Box' : 'Pcs'})`
          : 'Product';
        itemsMap[pid].push({
          name: label,
          qty: toNum(it.quantity),
          unitType: it.p_unit_type ?? 'piece',
          piecesPerBox: Number(it.p_ppb) || 1,
        });
      }

      const ledger = await db('supplier_ledger')
        .whereIn('purchase_id', purchaseIds)
        .where('type', 'payment')
        .select('purchase_id', 'amount');
      for (const e of ledger as any[]) {
        const pid = e.purchase_id;
        if (!paidMap[pid]) paidMap[pid] = 0;
        paidMap[pid] += toNum(e.amount);
      }
    }

    const rows = (purchases as any[]).map((p) => ({
      ...p,
      suppliers: p.supplier_name ? { name: p.supplier_name } : null,
    }));

    res.json({ purchases: rows, total: Number(count ?? 0), itemsMap, paidMap });
  } catch (err: any) {
    console.error('[reports.page.purchases]', err.message);
    res.status(500).json({ error: 'Failed to load purchases report' });
  }
});

// ─── G. Payments Report (paged) ──────────────────────────────────────────
// GET /api/reports/page/payments?dealerId=&page=&search=
// Unified customer receipts + supplier payments (money in and out).
router.get('/page/payments', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const search = ((req.query.search as string) || '').trim().toLowerCase();

  try {
    const [customerRows, supplierRows] = await Promise.all([
      db('customer_ledger as cl')
        .leftJoin('customers as c', 'c.id', 'cl.customer_id')
        .where({ 'cl.dealer_id': dealerId })
        .whereIn('cl.type', ['payment', 'refund'])
        .select(
          'cl.id',
          'cl.created_at',
          'cl.entry_date',
          'cl.type',
          'cl.amount',
          'cl.description',
          'cl.sale_id',
          'cl.sales_return_id',
          'cl.customer_id',
          'c.name as party_name',
        ),
      db('supplier_ledger as sl')
        .leftJoin('suppliers as s', 's.id', 'sl.supplier_id')
        .where({ 'sl.dealer_id': dealerId, 'sl.type': 'payment' })
        .select(
          'sl.id',
          'sl.created_at',
          'sl.entry_date',
          'sl.type',
          'sl.amount',
          'sl.description',
          'sl.purchase_id',
          'sl.supplier_id',
          's.name as party_name',
        ),
    ]);

    const saleIds = (customerRows as any[]).map((r) => r.sale_id).filter(Boolean);
    const purchaseIds = (supplierRows as any[]).map((r) => r.purchase_id).filter(Boolean);

    const [sales, purchases, bankEntries] = await Promise.all([
      saleIds.length
        ? db('sales').where({ dealer_id: dealerId }).whereIn('id', saleIds).select('id', 'invoice_number')
        : Promise.resolve([]),
      purchaseIds.length
        ? db('purchases').where({ dealer_id: dealerId }).whereIn('id', purchaseIds).select('id', 'invoice_number')
        : Promise.resolve([]),
      db('bank_ledger')
        .where({ dealer_id: dealerId })
        .whereIn('reference_type', ['customer_payment', 'purchases'])
        .select('reference_type', 'reference_id', 'amount', 'bank_account_id'),
    ]);

    const saleMap: Record<string, string> = {};
    for (const s of sales as any[]) saleMap[s.id] = s.invoice_number ?? '';

    const purchaseMap: Record<string, string> = {};
    for (const p of purchases as any[]) purchaseMap[p.id] = p.invoice_number ?? '';

    const bankRefSet = new Set<string>();
    for (const b of bankEntries as any[]) {
      bankRefSet.add(`${b.reference_type}:${b.reference_id}`);
    }

    type UnifiedRow = {
      id: string;
      created_at: string;
      paymentRef: string;
      saleRef: string;
      purchaseRef: string;
      partyName: string;
      paidVia: string;
      amount: number;
      type: string;
      direction: 'in' | 'out';
    };

    const unified: UnifiedRow[] = [];

    for (const r of customerRows as any[]) {
      const isReturn = r.type === 'refund' || r.sales_return_id;
      const saleRef = r.sale_id ? (saleMap[r.sale_id] || String(r.sale_id).substring(0, 12)) : '';
      const refKey = r.sale_id ? `customer_payment:${r.sale_id}` : '';
      unified.push({
        id: `c-${r.id}`,
        created_at: r.created_at,
        paymentRef: isReturn ? 'Return Paid' : (r.description || 'Customer payment'),
        saleRef: saleRef ? `SALE${saleRef}` : '—',
        purchaseRef: '—',
        partyName: r.party_name ?? 'Customer',
        paidVia: refKey && bankRefSet.has(refKey) ? 'Bank' : 'Cash',
        amount: toNum(r.amount),
        type: isReturn ? 'Return Paid' : 'Received from Customer',
        direction: isReturn ? 'out' : 'in',
      });
    }

    for (const r of supplierRows as any[]) {
      const purchaseRef = r.purchase_id
        ? (purchaseMap[r.purchase_id] || String(r.purchase_id).substring(0, 12))
        : '';
      const refKey = r.purchase_id ? `purchases:${r.purchase_id}` : '';
      unified.push({
        id: `s-${r.id}`,
        created_at: r.created_at,
        paymentRef: r.description || 'Supplier payment',
        saleRef: '—',
        purchaseRef: purchaseRef || '—',
        partyName: r.party_name ?? 'Supplier',
        paidVia: refKey && bankRefSet.has(refKey) ? 'Bank' : 'Cash',
        amount: toNum(r.amount),
        type: 'Paid to Supplier',
        direction: 'out',
      });
    }

    const filtered = search
      ? unified.filter((row) =>
          [row.paymentRef, row.saleRef, row.purchaseRef, row.partyName, row.type, row.paidVia]
            .join(' ')
            .toLowerCase()
            .includes(search),
        )
      : unified;

    filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const total = filtered.length;
    const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    res.json({ rows, total });
  } catch (err: any) {
    console.error('[reports.page.payments]', err.message);
    res.status(500).json({ error: 'Failed to load payments report' });
  }
});

// ─── H. Due Aging Report ─────────────────────────────────────────────────
// GET /api/reports/page/due-aging?dealerId=
router.get('/page/due-aging', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const [customers, sales] = await Promise.all([
      db('customers')
        .where({ dealer_id: dealerId, status: 'active' })
        .orderBy('name', 'asc')
        .select('id', 'name', 'phone', 'type'),
      db('sales')
        .where({ dealer_id: dealerId })
        .andWhere('due_amount', '>', 0)
        .select('id', 'customer_id', 'sale_date', 'due_amount', 'total_amount', 'invoice_number'),
    ]);

    const today = new Date();
    const msPerDay = 86_400_000;

    const customerMap = new Map<string, any>();
    for (const c of customers as any[]) {
      customerMap.set(c.id, {
        id: c.id, name: c.name, phone: c.phone, type: c.type,
        current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0, invoices: [],
      });
    }
    for (const s of sales as any[]) {
      const cust = customerMap.get(s.customer_id);
      if (!cust) continue;
      const due = toNum(s.due_amount);
      const days = Math.max(0, Math.floor((today.getTime() - new Date(s.sale_date).getTime()) / msPerDay));
      if (days <= 0) cust.current += due;
      else if (days <= 30) cust.d30 += due;
      else if (days <= 60) cust.d60 += due;
      else if (days <= 90) cust.d90 += due;
      else cust.d90plus += due;
      cust.total += due;
      cust.invoices.push({
        id: s.id,
        invoice_number: s.invoice_number,
        sale_date: typeof s.sale_date === 'string' ? s.sale_date : new Date(s.sale_date).toISOString().split('T')[0],
        due_amount: due,
        days,
      });
    }

    const rows = Array.from(customerMap.values())
      .filter((v) => v.total > 0)
      .map((v) => ({ ...v, invoices: v.invoices.sort((a: any, b: any) => b.days - a.days) }))
      .sort((a, b) => b.total - a.total);

    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.page.due-aging]', err.message);
    res.status(500).json({ error: 'Failed to load due aging report' });
  }
});

// ─── I. Profit Analysis per Product ──────────────────────────────────────
// GET /api/reports/page/profit-analysis?dealerId=
router.get('/page/profit-analysis', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const [products, saleItems, stocks, purchaseItems] = await Promise.all([
      db('products')
        .where({ dealer_id: dealerId, active: true })
        .select('id', 'sku', 'name', 'brand', 'category', 'unit_type', 'pieces_per_box'),
      db('sale_items')
        .where({ dealer_id: dealerId })
        .select('product_id', 'quantity', 'sale_rate', 'total', 'total_sft'),
      db('stock')
        .where({ dealer_id: dealerId })
        .select('product_id', 'average_cost_per_unit'),
      db('purchase_items')
        .where({ dealer_id: dealerId })
        .select('product_id', 'quantity', 'landed_cost'),
    ]);

    const costMap = new Map<string, number>();
    const costQtyMap = new Map<string, { totalCost: number; totalQty: number }>();

    for (const pi of purchaseItems as any[]) {
      const cur = costQtyMap.get(pi.product_id) ?? { totalCost: 0, totalQty: 0 };
      const qty = toNum(pi.quantity);
      const cost = toNum(pi.landed_cost);
      cur.totalCost += cost * qty;
      cur.totalQty += qty;
      costQtyMap.set(pi.product_id, cur);
    }
    for (const [pid, val] of costQtyMap) {
      costMap.set(pid, val.totalQty > 0 ? val.totalCost / val.totalQty : 0);
    }
    for (const s of stocks as any[]) {
      if (!costMap.has(s.product_id)) {
        costMap.set(s.product_id, toNum(s.average_cost_per_unit));
      }
    }

    const salesAgg = new Map<string, { qtySold: number; revenue: number; totalSft: number }>();
    for (const si of saleItems as any[]) {
      const cur = salesAgg.get(si.product_id) ?? { qtySold: 0, revenue: 0, totalSft: 0 };
      cur.qtySold += toNum(si.quantity);
      cur.revenue += toNum(si.total);
      cur.totalSft += toNum(si.total_sft);
      salesAgg.set(si.product_id, cur);
    }

    const rows = (products as any[])
      .map((p) => {
        const sales = salesAgg.get(p.id) ?? { qtySold: 0, revenue: 0, totalSft: 0 };
        const avgCost = costMap.get(p.id) ?? 0;
        const cogs = sales.qtySold * avgCost;
        const profit = sales.revenue - cogs;
        const marginPct = sales.revenue > 0 ? (profit / sales.revenue) * 100 : 0;
        const avgSaleRate = sales.qtySold > 0 ? sales.revenue / sales.qtySold : 0;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          brand: p.brand ?? '—',
          category: p.category,
          unitType: p.unit_type,
          piecesPerBox: Number(p.pieces_per_box ?? 1),
          qtySold: round2(sales.qtySold),
          totalSft: round2(sales.totalSft),
          avgCost: round2(avgCost),
          avgSaleRate: round2(avgSaleRate),
          revenue: round2(sales.revenue),
          cogs: round2(cogs),
          profit: round2(profit),
          marginPct: Math.round(marginPct * 10) / 10,
        };
      })
      .filter((r) => r.qtySold > 0);

    res.json({ rows });
  } catch (err: any) {
    console.error('[reports.page.profit-analysis]', err.message);
    res.status(500).json({ error: 'Failed to load profit analysis' });
  }
});

export default router;

