/**
 * Daily 11 PM WhatsApp summary for every active dealer admin.
 *
 * Metrics gathered per dealer (today = dealer's local date in Asia/Dhaka):
 *   1. Today's sales  — invoice count + total amount
 *   2. Today's cash collections — cash/bank received from customers
 *   3. Today's purchases — purchase count + total amount
 *   4. Total outstanding receivables (customer dues)
 *   5. Low / zero stock alerts (products at or below reorder level)
 *   6. Pending backorders count
 *   7. Today's top-selling product
 *   8. Overdue customers (balance > 0, no collection in 30 days)
 */

import { db } from '../db/connection';
import { sendWhatsApp } from './notificationService';

const BD_TZ = 'Asia/Dhaka';

/** Returns today's date in YYYY-MM-DD for Bangladesh timezone. */
function todayBD(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BD_TZ }).format(new Date());
}

/** Comma-format a number with ৳ sign. */
function taka(n: number): string {
  return '৳' + Math.round(n).toLocaleString('en-BD');
}

interface DailySummaryResult {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { dealer: string; error: string }[];
}

export async function sendDealerDailySummaries(): Promise<DailySummaryResult> {
  const today = todayBD();
  const result: DailySummaryResult = { total: 0, sent: 0, skipped: 0, failed: 0, errors: [] };

  // Fetch all active dealers with WhatsApp-enabled plans whose admin has a phone number
  const dealers = await db('dealers as d')
    .join('subscriptions as s', 's.dealer_id', 'd.id')
    .join('plans as p', 'p.id', 's.plan_id')
    .where('d.status', 'active')
    .where('s.status', 'active')
    .where('p.whatsapp_enabled', true)
    .whereNotNull('d.phone')
    .where('d.phone', '!=', '')
    .select('d.id as dealer_id', 'd.name as dealer_name', 'd.phone as admin_phone', 'd.owner_name as admin_name')
    .distinctOn('d.id');

  result.total = dealers.length;

  for (const dealer of dealers) {
    try {
      const msg = await buildSummaryMessage(dealer.dealer_id, dealer.dealer_name, dealer.admin_name, today);
      const ok = await sendWhatsApp({ to: dealer.admin_phone, text: msg });
      if (ok) {
        result.sent++;
      } else {
        result.failed++;
        result.errors.push({ dealer: dealer.dealer_name, error: 'WhatsApp send returned false' });
      }
      // Rate-limit: WasenderAPI free plan ~1 req/min; paid plan handles bursts fine.
      // Add a small gap between dealers to be safe.
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err: any) {
      result.failed++;
      result.errors.push({ dealer: dealer.dealer_name, error: err.message });
    }
  }

  return result;
}

async function buildSummaryMessage(
  dealerId: string,
  dealerName: string,
  adminName: string,
  today: string,
): Promise<string> {
  const [
    salesData,
    collectionsData,
    purchasesData,
    receivables,
    lowStock,
    backorders,
    topProduct,
    overdueCount,
  ] = await Promise.all([
    getTodaySales(dealerId, today),
    getTodayCollections(dealerId, today),
    getTodayPurchases(dealerId, today),
    getTotalReceivables(dealerId),
    getLowStockItems(dealerId),
    getPendingBackorders(dealerId),
    getTodayTopProduct(dealerId, today),
    getOverdueCustomerCount(dealerId),
  ]);

  // Format date nicely: "Tuesday, 1 July 2025"
  const dateLabel = new Date(today + 'T00:00:00+06:00').toLocaleDateString('en-BD', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: BD_TZ,
  });

  const lines: string[] = [];

  lines.push(`🏪 *${dealerName}*`);
  lines.push(`📅 *Daily Report — ${dateLabel}*`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');

  // 1. Today's Sales
  if (salesData.count > 0) {
    lines.push(`\n📦 *আজকের বিক্রয় (Today's Sales)*`);
    lines.push(`  • Invoices: ${salesData.count}`);
    lines.push(`  • Total: ${taka(salesData.total)}`);
    lines.push(`  • Collected: ${taka(salesData.paid)}`);
    if (salesData.total - salesData.paid > 0.5) {
      lines.push(`  • On Credit: ${taka(salesData.total - salesData.paid)}`);
    }
  } else {
    lines.push(`\n📦 *আজকের বিক্রয়:* কোনো বিক্রয় নেই`);
  }

  // 2. Today's Collections
  if (collectionsData > 0) {
    lines.push(`\n💰 *আজকের কালেকশন (Collections)*`);
    lines.push(`  • Cash/Bank Received: ${taka(collectionsData)}`);
  }

  // 3. Today's Purchases
  if (purchasesData.count > 0) {
    lines.push(`\n🛒 *আজকের ক্রয় (Purchases)*`);
    lines.push(`  • Bills: ${purchasesData.count}`);
    lines.push(`  • Total: ${taka(purchasesData.total)}`);
  }

  // 4. Outstanding Receivables
  lines.push(`\n💳 *বকেয়া পাওনা (Receivables)*`);
  if (receivables.totalDue > 0) {
    lines.push(`  • Total Outstanding: ${taka(receivables.totalDue)}`);
    lines.push(`  • Customers with dues: ${receivables.customerCount}`);
  } else {
    lines.push(`  • সব পেমেন্ট পরিশোধিত ✅`);
  }

  // 5. Top Seller Today
  if (topProduct) {
    lines.push(`\n🏆 *আজকের সেরা পণ্য (Top Seller)*`);
    lines.push(`  • ${topProduct.name}: ${topProduct.qty} ${topProduct.unit}`);
    lines.push(`  • Revenue: ${taka(topProduct.amount)}`);
  }

  lines.push(`\n⚠️ *সতর্কতা (Alerts)*`);
  let hasAlert = false;

  // 6. Low Stock
  if (lowStock.length > 0) {
    hasAlert = true;
    lines.push(`  📉 কম স্টক (Low Stock): ${lowStock.length} টি পণ্য`);
    lowStock.slice(0, 3).forEach((p) => {
      lines.push(`     ‣ ${p.name}: ${p.stockLabel}`);
    });
    if (lowStock.length > 3) {
      lines.push(`     ‣ ...এবং আরো ${lowStock.length - 3}টি পণ্য`);
    }
  }

  // 7. Backorders
  if (backorders > 0) {
    hasAlert = true;
    lines.push(`  🔄 অপেক্ষমাণ ব্যাকঅর্ডার: ${backorders}টি`);
  }

  // 8. Overdue Customers
  if (overdueCount > 0) {
    hasAlert = true;
    lines.push(`  ⏰ ৩০+ দিনের বকেয়া গ্রাহক: ${overdueCount} জন`);
  }

  if (!hasAlert) {
    lines.push(`  সব ঠিকঠাক আছে ✅`);
  }

  lines.push(`\n━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`_Tiles & Sanitary ERP — সন্ধ্যা রিপোর্ট_`);
  lines.push(`_sanitileserp.com_`);

  return lines.join('\n');
}

// ─── Data Fetchers ───────────────────────────────────────────────────────────

async function getTodaySales(dealerId: string, today: string) {
  const row = await db('sales')
    .where({ dealer_id: dealerId })
    .where('sale_date', today)
    .where('document_status', 'posted')
    .select(
      db.raw('count(*) as count'),
      db.raw('coalesce(sum(total_amount), 0) as total'),
      db.raw('coalesce(sum(paid_amount), 0) as paid'),
    )
    .first();
  return {
    count: Number(row?.count ?? 0),
    total: Number(row?.total ?? 0),
    paid: Number(row?.paid ?? 0),
  };
}

async function getTodayCollections(dealerId: string, today: string): Promise<number> {
  // Cash/bank received from customers today (positive entries on cash/bank ledger with reference_type='sales')
  const cashRow = await db('cash_ledger')
    .where({ dealer_id: dealerId })
    .where('entry_date', today)
    .where('type', 'payment')
    .where('amount', '>', 0)
    .sum('amount as total')
    .first();

  const bankRow = await db('bank_ledger')
    .where({ dealer_id: dealerId })
    .where('entry_date', today)
    .where('type', 'receipt')
    .sum('amount as total')
    .first();

  return Number(cashRow?.total ?? 0) + Number(bankRow?.total ?? 0);
}

async function getTodayPurchases(dealerId: string, today: string) {
  const row = await db('purchases')
    .where({ dealer_id: dealerId })
    .where('purchase_date', today)
    .where('document_status', 'posted')
    .select(
      db.raw('count(*) as count'),
      db.raw('coalesce(sum(total_amount), 0) as total'),
    )
    .first();
  return { count: Number(row?.count ?? 0), total: Number(row?.total ?? 0) };
}

async function getTotalReceivables(dealerId: string) {
  // Sum per customer: positive = sale/charge, negative = payment/credit
  // Net positive means customer owes us
  const rows = await db('customer_ledger')
    .where({ dealer_id: dealerId })
    .select('customer_id')
    .sum('amount as balance')
    .groupBy('customer_id')
    .havingRaw('sum(amount) > 0.5');

  const totalDue = rows.reduce((s: number, r: any) => s + Number(r.balance), 0);
  return { totalDue, customerCount: rows.length };
}

async function getLowStockItems(dealerId: string) {
  const rows = await db('stock as st')
    .join('products as p', 'p.id', 'st.product_id')
    .where('st.dealer_id', dealerId)
    .whereRaw('st.total_pieces <= p.reorder_level * COALESCE(p.pieces_per_box, 1)')
    .select('p.name', 'p.unit_type', 'p.pieces_per_box', 'st.total_pieces', 'st.box_qty', 'st.piece_qty', 'p.reorder_level')
    .orderBy('st.total_pieces', 'asc')
    .limit(10);

  return (rows as any[]).map((r) => {
    let stockLabel: string;
    if (Number(r.total_pieces) <= 0) {
      stockLabel = 'স্টক শেষ (Out of Stock)';
    } else if (r.unit_type === 'box_sft') {
      stockLabel = `${Number(r.box_qty).toFixed(1)} box`;
    } else {
      stockLabel = `${Number(r.piece_qty).toFixed(0)} pcs`;
    }
    return { name: r.name as string, stockLabel };
  });
}

async function getPendingBackorders(dealerId: string): Promise<number> {
  const row = await db('sales')
    .where({ dealer_id: dealerId, has_backorder: true })
    .where('document_status', 'posted')
    .count('id as cnt')
    .first();
  return Number(row?.cnt ?? 0);
}

async function getTodayTopProduct(dealerId: string, today: string) {
  const row = await db('sale_items as si')
    .join('sales as s', 's.id', 'si.sale_id')
    .join('products as p', 'p.id', 'si.product_id')
    .where('s.dealer_id', dealerId)
    .where('s.sale_date', today)
    .where('s.document_status', 'posted')
    .select(
      'p.name',
      'p.unit_type',
      db.raw('sum(si.quantity) as qty'),
      db.raw('sum(si.total) as amount'),
    )
    .groupBy('p.id', 'p.name', 'p.unit_type')
    .orderBy('amount', 'desc')
    .first();

  if (!row) return null;
  const unit = row.unit_type === 'box_sft' ? 'box' : 'pcs';
  return { name: row.name as string, qty: Number(row.qty).toFixed(1), unit, amount: Number(row.amount) };
}

async function getOverdueCustomerCount(dealerId: string): Promise<number> {
  // Customers with outstanding balance who had their last payment > 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  // Customers with positive balance
  const withBalance = await db('customer_ledger')
    .where({ dealer_id: dealerId })
    .select('customer_id')
    .sum('amount as balance')
    .groupBy('customer_id')
    .havingRaw('sum(amount) > 0.5');

  if (!withBalance.length) return 0;

  const customerIds = withBalance.map((r: any) => r.customer_id);

  // Of those, find ones whose last payment (negative entry) was before cutoff
  const overdue = await db('customer_ledger')
    .where({ dealer_id: dealerId })
    .whereIn('customer_id', customerIds)
    .where('amount', '<', 0)
    .select('customer_id')
    .max('entry_date as last_payment')
    .groupBy('customer_id')
    .havingRaw('max(entry_date) < ?', [cutoff]);

  // Also count customers who never paid at all (no negative entries)
  const neverPaid = customerIds.filter(
    (id: string) => !overdue.some((r: any) => r.customer_id === id),
  );
  // Among neverPaid, include those whose first sale was > 30 days ago
  const oldNeverPaid = await db('customer_ledger')
    .where({ dealer_id: dealerId })
    .whereIn('customer_id', neverPaid)
    .select('customer_id')
    .min('entry_date as first_date')
    .groupBy('customer_id')
    .havingRaw('min(entry_date) < ?', [cutoff]);

  return overdue.length + oldNeverPaid.length;
}
