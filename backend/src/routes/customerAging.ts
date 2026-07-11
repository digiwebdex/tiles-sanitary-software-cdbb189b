/**
 * Customer Accounts Receivable Aging — V2 Sprint 6B.
 *
 *   GET /api/customer-aging?dealerId=
 *
 * The customer-side counterpart to `supplierAging.ts` (Sprint 5D) — same
 * shape, same reused aging-bucket utilities (`emptyDueAgingBuckets`/
 * `addDueToAgingBuckets`/`agingDaysFromSaleDate` from `reportQueryService.ts`),
 * and the same "Due Today/This Week/This Month" convention: no due-date/
 * payment-terms field exists anywhere in this codebase (confirmed in
 * supplierAging.ts's own header comment), so recency of `sale_date` is used,
 * exactly like the supplier side buckets by `purchase_date` recency.
 *
 * Per-invoice due amounts come from `fetchOpenSalesDueRows` (already the
 * single source `buildDueAgingReportRows`/the existing Due Aging Report
 * page uses), which already excludes reversed sales and zero-due rows.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import {
  fetchOpenSalesDueRows,
  emptyDueAgingBuckets,
  addDueToAgingBuckets,
  agingDaysFromSaleDate,
} from '../services/reportQueryService';

const router = Router();
router.use(authenticate, tenantGuard);

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;

    const openSales = await fetchOpenSalesDueRows(dealerId);
    const customerIds = Array.from(new Set(openSales.map((s) => s.customer_id)));
    const customers = customerIds.length
      ? await db('customers').whereIn('id', customerIds).select('id', 'name')
      : [];
    const customerNameById = new Map(customers.map((c: any) => [c.id, c.name as string]));

    const today = new Date();
    const weekStart = startOfWeek(today);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const byCustomer = new Map<string, {
      customer_id: string; customer_name: string;
      buckets: ReturnType<typeof emptyDueAgingBuckets>;
      due_today: number; due_this_week: number; due_this_month: number;
      invoices: Array<{ id: string; invoice_number: string | null; sale_date: string; due_amount: number; days: number }>;
    }>();

    let totalOutstanding = 0;
    let totalDueToday = 0;
    let totalDueThisWeek = 0;
    let totalDueThisMonth = 0;
    const overallBuckets = emptyDueAgingBuckets();

    for (const sale of openSales) {
      const dueAmount = round2(Number(sale.due_amount) || 0);
      if (dueAmount <= 0.01) continue;
      const days = agingDaysFromSaleDate(sale.sale_date);
      addDueToAgingBuckets(overallBuckets, dueAmount, days);
      totalOutstanding = round2(totalOutstanding + dueAmount);

      const saleDate = new Date(sale.sale_date);
      const isToday = saleDate.toDateString() === today.toDateString();
      const isThisWeek = saleDate >= weekStart;
      const isThisMonth = saleDate >= monthStart;
      if (isToday) totalDueToday = round2(totalDueToday + dueAmount);
      if (isThisWeek) totalDueThisWeek = round2(totalDueThisWeek + dueAmount);
      if (isThisMonth) totalDueThisMonth = round2(totalDueThisMonth + dueAmount);

      let entry = byCustomer.get(sale.customer_id);
      if (!entry) {
        entry = {
          customer_id: sale.customer_id,
          customer_name: customerNameById.get(sale.customer_id) ?? '',
          buckets: emptyDueAgingBuckets(),
          due_today: 0, due_this_week: 0, due_this_month: 0,
          invoices: [],
        };
        byCustomer.set(sale.customer_id, entry);
      }
      addDueToAgingBuckets(entry.buckets, dueAmount, days);
      if (isToday) entry.due_today = round2(entry.due_today + dueAmount);
      if (isThisWeek) entry.due_this_week = round2(entry.due_this_week + dueAmount);
      if (isThisMonth) entry.due_this_month = round2(entry.due_this_month + dueAmount);
      entry.invoices.push({ id: sale.id, invoice_number: sale.invoice_number, sale_date: String(sale.sale_date), due_amount: dueAmount, days });
    }

    res.json({
      summary: {
        total_outstanding: totalOutstanding,
        due_today: totalDueToday,
        due_this_week: totalDueThisWeek,
        due_this_month: totalDueThisMonth,
        buckets: overallBuckets,
      },
      customers: Array.from(byCustomer.values()),
    });
  } catch (err: any) {
    console.error('[customer-aging]', err.message);
    res.status(500).json({ error: 'Failed to load customer aging report' });
  }
});

export default router;
