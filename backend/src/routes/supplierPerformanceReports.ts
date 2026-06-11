/**
 * Supplier Performance Reports — VPS migration phase 3J-2 (reads only).
 *
 * Mirrors src/services/supplierPerformanceService.ts:
 *   GET /api/reports/supplier-performance?dealerId=&startDate=&endDate=
 *   GET /api/reports/supplier-performance/:supplierId?dealerId=
 *   GET /api/reports/supplier-performance/:supplierId/price-trend?dealerId=
 *   GET /api/reports/supplier-performance/dashboard?dealerId=
 *
 * Dealer-scoped, financial → dealer_admin/super_admin only.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { hasRole } from '../middleware/roles';
import { getSupplierOutstandingMapFromReadModel } from '../services/reportQueryService';

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

function requireFinancialRole(req: Request, res: Response): boolean {
  if (hasRole(req, 'dealer_admin') || hasRole(req, 'super_admin')) return true;
  res.status(403).json({ error: 'Reports require dealer_admin role' });
  return false;
}

type ReliabilityBand = 'reliable' | 'average' | 'at_risk' | 'inactive';
type PriceTrend = 'stable' | 'rising' | 'falling' | 'insufficient_data';

function classify(score: number, lastPurchaseDate: string | null): ReliabilityBand {
  if (!lastPurchaseDate) return 'inactive';
  const daysSince = Math.floor((Date.now() - new Date(lastPurchaseDate).getTime()) / 86_400_000);
  if (daysSince > 180) return 'inactive';
  if (score >= 80) return 'reliable';
  if (score >= 60) return 'average';
  return 'at_risk';
}

function computeScore(args: {
  returnRatePct: number;
  daysSinceLast: number | null;
  outstanding: number;
  avgPurchaseValue: number;
  delayedPct: number;
}): { score: number; factors: string[] } {
  let score = 100;
  const factors: string[] = [];
  const returnPenalty = Math.min(40, args.returnRatePct * 2);
  if (returnPenalty > 0) {
    score -= returnPenalty;
    factors.push(`-${Math.round(returnPenalty)} from ${args.returnRatePct.toFixed(1)}% return rate`);
  }
  if (args.daysSinceLast !== null && args.daysSinceLast > 90) {
    score -= 10;
    factors.push(`-10 inactive ${args.daysSinceLast}d`);
  }
  if (args.avgPurchaseValue > 0 && args.outstanding > args.avgPurchaseValue * 5) {
    score -= 10;
    factors.push(`-10 high outstanding exposure`);
  }
  if (args.delayedPct > 30) {
    score -= 10;
    factors.push(`-10 ${args.delayedPct.toFixed(0)}% delayed cadence`);
  }
  return { score: Math.max(0, Math.round(score)), factors };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dateStr(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v.length >= 10 ? v.slice(0, 10) : v;
  return new Date(v).toISOString().split('T')[0];
}

function computePriceTrends(
  purchases: { id: string; supplier_id: string | null; purchase_date: any }[],
  items: { purchase_id: string; product_id: string; purchase_rate: any; quantity: any }[],
): Map<string, { trend: PriceTrend; change_pct: number; products_compared: number }> {
  const purIndex = new Map<string, { supplier_id: string | null; date: string }>();
  for (const p of purchases) purIndex.set(p.id, { supplier_id: p.supplier_id, date: dateStr(p.purchase_date) });

  const bySupplierProduct = new Map<string, Map<string, { date: string; rate: number; qty: number }[]>>();
  for (const it of items) {
    const meta = purIndex.get(it.purchase_id);
    if (!meta || !meta.supplier_id) continue;
    const rate = Number(it.purchase_rate);
    if (!isFinite(rate) || rate <= 0) continue;
    const qty = Number(it.quantity) || 0;
    let prodMap = bySupplierProduct.get(meta.supplier_id);
    if (!prodMap) {
      prodMap = new Map();
      bySupplierProduct.set(meta.supplier_id, prodMap);
    }
    const arr = prodMap.get(it.product_id) ?? [];
    arr.push({ date: meta.date, rate, qty });
    prodMap.set(it.product_id, arr);
  }

  const out = new Map<string, { trend: PriceTrend; change_pct: number; products_compared: number }>();
  for (const [supplierId, prodMap] of bySupplierProduct) {
    let weightedDrift = 0, totalWeight = 0, productsCompared = 0;
    for (const arr of prodMap.values()) {
      if (arr.length < 2) continue;
      const sorted = arr.slice().sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted[sorted.length - 1];
      const prior = sorted.slice(Math.max(0, sorted.length - 4), sorted.length - 1);
      const priorAvg = prior.reduce((s, x) => s + x.rate, 0) / prior.length;
      if (priorAvg <= 0) continue;
      const driftPct = ((last.rate - priorAvg) / priorAvg) * 100;
      const weight = Math.max(1, last.qty);
      weightedDrift += driftPct * weight;
      totalWeight += weight;
      productsCompared += 1;
    }
    if (productsCompared === 0 || totalWeight === 0) {
      out.set(supplierId, { trend: 'insufficient_data', change_pct: 0, products_compared: 0 });
      continue;
    }
    const avgDrift = weightedDrift / totalWeight;
    const trend: PriceTrend = avgDrift > 3 ? 'rising' : avgDrift < -3 ? 'falling' : 'stable';
    out.set(supplierId, {
      trend,
      change_pct: Math.round(avgDrift * 100) / 100,
      products_compared: productsCompared,
    });
  }
  return out;
}

async function listInternal(dealerId: string, startDate?: string, endDate?: string) {
  let purQ = db('purchases').where({ dealer_id: dealerId });
  if (startDate) purQ = purQ.andWhere('purchase_date', '>=', startDate);
  if (endDate) purQ = purQ.andWhere('purchase_date', '<=', endDate);

  let retQ = db('purchase_returns').where({ dealer_id: dealerId });
  if (startDate) retQ = retQ.andWhere('return_date', '>=', startDate);
  if (endDate) retQ = retQ.andWhere('return_date', '<=', endDate);

  const [suppliers, purchases, returnsRaw, outstandingMap, items] = await Promise.all([
    db('suppliers').where({ dealer_id: dealerId }).select('id', 'name', 'status'),
    purQ.select('id', 'supplier_id', 'purchase_date', 'total_amount'),
    retQ.select('id', 'supplier_id', 'return_date', 'total_amount', 'status'),
    getSupplierOutstandingMapFromReadModel(dealerId),
    db('purchase_items').where({ dealer_id: dealerId }).select('purchase_id', 'product_id', 'purchase_rate', 'quantity'),
  ]);

  const returns = (returnsRaw as any[]).filter((r) => r.status !== 'cancelled');
  const trendMap = computePriceTrends(purchases as any, items as any);

  const purBySup = new Map<string, { date: string; amount: number }[]>();
  for (const p of purchases as any[]) {
    if (!p.supplier_id) continue;
    const arr = purBySup.get(p.supplier_id) ?? [];
    arr.push({ date: dateStr(p.purchase_date), amount: Number(p.total_amount) });
    purBySup.set(p.supplier_id, arr);
  }

  const retBySup = new Map<string, { count: number; total: number }>();
  for (const r of returns as any[]) {
    if (!r.supplier_id) continue;
    const cur = retBySup.get(r.supplier_id) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.total_amount ?? 0);
    retBySup.set(r.supplier_id, cur);
  }

  const today = Date.now();
  const thirtyDaysAgo = today - 30 * 86_400_000;

  return (suppliers as any[]).map((s) => {
    const pList = (purBySup.get(s.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const totalPurchases = pList.length;
    const totalPurchaseValue = pList.reduce((sum, p) => sum + p.amount, 0);
    const avgPurchaseValue = totalPurchases > 0 ? totalPurchaseValue / totalPurchases : 0;
    const lastPurchase = pList.length > 0 ? pList[pList.length - 1].date : null;
    const daysSinceLast = lastPurchase
      ? Math.floor((today - new Date(lastPurchase).getTime()) / 86_400_000)
      : null;

    const recentValue30d = pList
      .filter((p) => new Date(p.date).getTime() >= thirtyDaysAgo)
      .reduce((sum, p) => sum + p.amount, 0);

    let avgGap: number | null = null;
    let lastGap: number | null = null;
    let longestGap: number | null = null;
    let onTime = 0, delayed = 0, delayedPct = 0;

    if (pList.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < pList.length; i++) {
        const d = (new Date(pList[i].date).getTime() - new Date(pList[i - 1].date).getTime()) / 86_400_000;
        if (d >= 0) gaps.push(d);
      }
      if (gaps.length > 0) {
        avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
        lastGap = Math.round(gaps[gaps.length - 1]);
        longestGap = Math.round(Math.max(...gaps));
        const med = median(gaps);
        const tolerance = Math.max(med * 1.5, med + 7);
        for (const g of gaps) {
          if (g > tolerance) delayed += 1;
          else onTime += 1;
        }
        delayedPct = gaps.length > 0 ? Math.round((delayed / gaps.length) * 100) : 0;
      }
    }

    const retInfo = retBySup.get(s.id) ?? { count: 0, total: 0 };
    const returnRatePct = totalPurchaseValue > 0
      ? Math.round((retInfo.total / totalPurchaseValue) * 10_000) / 100
      : 0;

    const outstanding = outstandingMap.get(s.id) ?? 0;
    const trendInfo = trendMap.get(s.id) ?? { trend: 'insufficient_data' as PriceTrend, change_pct: 0, products_compared: 0 };

    const { score, factors } = computeScore({
      returnRatePct, daysSinceLast, outstanding, avgPurchaseValue, delayedPct,
    });

    return {
      supplier_id: s.id,
      supplier_name: s.name,
      status: s.status,
      total_purchases: totalPurchases,
      total_purchase_value: Math.round(totalPurchaseValue * 100) / 100,
      avg_purchase_value: Math.round(avgPurchaseValue * 100) / 100,
      last_purchase_date: lastPurchase,
      days_since_last_purchase: daysSinceLast,
      avg_days_between_purchases: avgGap,
      last_gap_days: lastGap,
      longest_gap_days: longestGap,
      on_time_count: onTime,
      delayed_count: delayed,
      delayed_pct: delayedPct,
      total_returns: retInfo.count,
      total_return_value: Math.round(retInfo.total * 100) / 100,
      return_rate_pct: returnRatePct,
      outstanding_amount: outstanding,
      recent_purchase_value_30d: Math.round(recentValue30d * 100) / 100,
      price_trend: trendInfo.trend,
      price_change_pct: trendInfo.change_pct,
      trend_products_compared: trendInfo.products_compared,
      reliability_score: score,
      reliability_band: classify(score, lastPurchase),
      score_factors: factors,
    };
  });
}

// ── 1. List ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const startDate = (req.query.startDate as string | undefined) || undefined;
  const endDate = (req.query.endDate as string | undefined) || undefined;

  try {
    const list = await listInternal(dealerId, startDate, endDate);
    res.json(list);
  } catch (err) {
    console.error('[supplier-perf.list]', err);
    res.status(500).json({ error: 'Failed to load supplier performance' });
  }
});

// ── 2. Dashboard (must come before :supplierId) ──────────────
router.get('/dashboard', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  try {
    const all = await listInternal(dealerId);
    const active = all.filter((s) => s.total_purchases > 0);

    const topReliable = active
      .filter((s) => s.reliability_band === 'reliable')
      .sort((a, b) => b.reliability_score - a.reliability_score || b.total_purchase_value - a.total_purchase_value)
      .slice(0, 5);

    const atRisk = active
      .filter((s) => s.reliability_band === 'at_risk')
      .sort((a, b) => a.reliability_score - b.reliability_score)
      .slice(0, 5);

    const highOutstanding = active
      .filter((s) => s.outstanding_amount > 0)
      .sort((a, b) => b.outstanding_amount - a.outstanding_amount)
      .slice(0, 5);

    const highReturn = active
      .filter((s) => s.return_rate_pct >= 5)
      .sort((a, b) => b.return_rate_pct - a.return_rate_pct)
      .slice(0, 5);

    const risingPrices = active
      .filter((s) => s.price_trend === 'rising')
      .sort((a, b) => b.price_change_pct - a.price_change_pct)
      .slice(0, 5);

    const delayedCount = active.filter(
      (s) => s.days_since_last_purchase !== null && s.days_since_last_purchase > 90,
    ).length;

    res.json({
      totalSuppliers: all.length,
      activeSuppliers: active.length,
      reliableCount: active.filter((s) => s.reliability_band === 'reliable').length,
      atRiskCount: atRisk.length,
      delayedCount,
      highReturnCount: highReturn.length,
      risingPriceCount: risingPrices.length,
      totalOutstanding:
        Math.round(active.reduce((sum, s) => sum + s.outstanding_amount, 0) * 100) / 100,
      topReliable,
      atRisk,
      highOutstanding,
      highReturn,
      risingPrices,
    });
  } catch (err) {
    console.error('[supplier-perf.dashboard]', err);
    res.status(500).json({ error: 'Failed to load supplier dashboard' });
  }
});

// ── 3. Per-supplier price-trend detail ───────────────────────
router.get('/:supplierId/price-trend', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const { supplierId } = req.params;
  try {
    const [purchases, items, products] = await Promise.all([
      db('purchases').where({ dealer_id: dealerId, supplier_id: supplierId }).select('id', 'supplier_id', 'purchase_date'),
      db('purchase_items').where({ dealer_id: dealerId }).select('purchase_id', 'product_id', 'purchase_rate', 'quantity'),
      db('products').where({ dealer_id: dealerId }).select('id', 'name', 'sku'),
    ]);

    const purIds = new Set((purchases as any[]).map((p) => p.id));
    const purDate = new Map((purchases as any[]).map((p) => [p.id, dateStr(p.purchase_date)] as const));
    const productMap = new Map((products as any[]).map((p) => [p.id, p] as const));

    const grouped = new Map<string, { date: string; rate: number; qty: number }[]>();
    for (const it of items as any[]) {
      if (!purIds.has(it.purchase_id)) continue;
      const rate = Number(it.purchase_rate);
      if (!isFinite(rate) || rate <= 0) continue;
      const arr = grouped.get(it.product_id) ?? [];
      arr.push({
        date: purDate.get(it.purchase_id) ?? '',
        rate,
        qty: Number(it.quantity) || 0,
      });
      grouped.set(it.product_id, arr);
    }

    const rows = Array.from(grouped.entries())
      .map(([productId, arr]) => {
        const sorted = arr.slice().sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1];
        const first = sorted[0];
        const prior = sorted.slice(Math.max(0, sorted.length - 4), sorted.length - 1);
        const priorAvg = prior.length > 0 ? prior.reduce((s, x) => s + x.rate, 0) / prior.length : last.rate;
        const driftPct = priorAvg > 0 ? ((last.rate - priorAvg) / priorAvg) * 100 : 0;
        const product = productMap.get(productId);
        return {
          product_id: productId,
          product_name: product?.name ?? 'Unknown',
          sku: product?.sku ?? '',
          purchases: sorted.length,
          first_rate: first.rate,
          last_rate: last.rate,
          avg_prior_rate: Math.round(priorAvg * 100) / 100,
          change_pct: Math.round(driftPct * 100) / 100,
          last_date: last.date,
        };
      })
      .filter((r) => r.purchases >= 2)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));

    res.json(rows);
  } catch (err) {
    console.error('[supplier-perf.price-trend]', err);
    res.status(500).json({ error: 'Failed to load price trend' });
  }
});

// ── 4. Per-supplier summary ──────────────────────────────────
router.get('/:supplierId', async (req, res) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireFinancialRole(req, res)) return;

  const { supplierId } = req.params;
  try {
    const all = await listInternal(dealerId);
    const found = all.find((s) => s.supplier_id === supplierId) ?? null;
    res.json(found);
  } catch (err) {
    console.error('[supplier-perf.get]', err);
    res.status(500).json({ error: 'Failed to load supplier' });
  }
});

export default router;
