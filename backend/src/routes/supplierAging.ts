/**
 * Supplier Accounts Payable Aging — V2 Sprint 5D (Purchase Invoice).
 *
 *   GET /api/supplier-aging?dealerId=
 *
 * Reuses the existing, already-generic aging-bucket utilities from
 * `reportQueryService.ts` (`emptyDueAgingBuckets`/`addDueToAgingBuckets`/
 * `agingDaysFromSaleDate`) — despite their sale-oriented names, their
 * actual signatures take a plain date + due amount, so they apply to
 * supplier bills unmodified. Also reuses `attachPurchasePaymentSummaries`
 * (purchasePaymentSummary.ts) for the due-amount-per-bill computation,
 * the exact same function `purchases.ts`'s own list endpoint uses.
 *
 * No due-date/payment-terms field exists anywhere in this codebase (not
 * even on Customers) — "Due Today/This Week/This Month" is therefore
 * bucketed by how recently each bill was incurred (`purchase_date`
 * recency), matching the same convention the existing Aging buckets
 * (current/d30/d60/d90/d90plus) already use, rather than a genuine forward
 * payment-due schedule that this codebase has no concept of.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { attachPurchasePaymentSummaries } from '../lib/purchasePaymentSummary';
import { emptyDueAgingBuckets, addDueToAgingBuckets, agingDaysFromSaleDate } from '../services/reportQueryService';

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

    const purchases = await db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where({ 'p.dealer_id': dealerId, 'p.document_status': 'posted' })
      .select('p.id', 'p.invoice_number', 'p.purchase_date', 'p.total_amount', 'p.voucher_discount', 'p.supplier_id', 's.name as supplier_name');

    const withSummary = await attachPurchasePaymentSummaries(dealerId, purchases);
    const openBills = withSummary.filter((p) => p.due_amount > 0.01);

    const today = new Date();
    const weekStart = startOfWeek(today);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const bySupplier = new Map<string, {
      supplier_id: string; supplier_name: string;
      buckets: ReturnType<typeof emptyDueAgingBuckets>;
      due_today: number; due_this_week: number; due_this_month: number;
      bills: Array<{ id: string; invoice_number: string | null; purchase_date: string; due_amount: number; days: number }>;
    }>();

    let totalOutstanding = 0;
    let totalDueToday = 0;
    let totalDueThisWeek = 0;
    let totalDueThisMonth = 0;
    const overallBuckets = emptyDueAgingBuckets();

    for (const bill of openBills) {
      const days = agingDaysFromSaleDate(bill.purchase_date);
      addDueToAgingBuckets(overallBuckets, bill.due_amount, days);
      totalOutstanding = round2(totalOutstanding + bill.due_amount);

      const billDate = new Date(bill.purchase_date);
      const isToday = billDate.toDateString() === today.toDateString();
      const isThisWeek = billDate >= weekStart;
      const isThisMonth = billDate >= monthStart;
      if (isToday) totalDueToday = round2(totalDueToday + bill.due_amount);
      if (isThisWeek) totalDueThisWeek = round2(totalDueThisWeek + bill.due_amount);
      if (isThisMonth) totalDueThisMonth = round2(totalDueThisMonth + bill.due_amount);

      let entry = bySupplier.get(bill.supplier_id);
      if (!entry) {
        entry = {
          supplier_id: bill.supplier_id,
          supplier_name: bill.supplier_name ?? '',
          buckets: emptyDueAgingBuckets(),
          due_today: 0, due_this_week: 0, due_this_month: 0,
          bills: [],
        };
        bySupplier.set(bill.supplier_id, entry);
      }
      addDueToAgingBuckets(entry.buckets, bill.due_amount, days);
      if (isToday) entry.due_today = round2(entry.due_today + bill.due_amount);
      if (isThisWeek) entry.due_this_week = round2(entry.due_this_week + bill.due_amount);
      if (isThisMonth) entry.due_this_month = round2(entry.due_this_month + bill.due_amount);
      entry.bills.push({ id: bill.id, invoice_number: bill.invoice_number, purchase_date: bill.purchase_date, due_amount: bill.due_amount, days });
    }

    res.json({
      summary: {
        total_outstanding: totalOutstanding,
        due_today: totalDueToday,
        due_this_week: totalDueThisWeek,
        due_this_month: totalDueThisMonth,
        buckets: overallBuckets,
      },
      suppliers: Array.from(bySupplier.values()),
    });
  } catch (err: any) {
    console.error('[supplier-aging]', err.message);
    res.status(500).json({ error: 'Failed to load supplier aging report' });
  }
});

export default router;
