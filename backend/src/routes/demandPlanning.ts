/**
 * Demand Planning route — Phase 3U-16.
 *
 *   GET   /api/demand-planning/rows?dealerId=
 *   GET   /api/demand-planning/dashboard-stats?dealerId=
 *   GET   /api/demand-planning/project-rows?dealerId=
 *
 * Server-side recreation of the previous client aggregator (Demand Planning /
 * Reorder Intelligence). READ-ONLY: no stock or ledger side effects.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';

const router = Router();
router.use(authenticate, tenantGuard);

const DEFAULTS = {
  velocity_window_days: 30,
  stockout_cover_days: 7,
  reorder_cover_days: 14,
  target_cover_days: 30,
  fast_moving_30d_qty: 20,
  slow_moving_30d_max: 5,
  dead_stock_days: 90,
  incoming_window_days: 30,
  safety_stock_days: 0,
};
type Settings = typeof DEFAULTS;

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || undefined;
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
const daysBetween = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
};

async function loadSettings(dealerId: string): Promise<Settings> {
  try {
    const row = await db('demand_planning_settings').where('dealer_id', dealerId).first('*');
    if (!row) return { ...DEFAULTS };
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (row[k] != null) out[k] = Number(row[k]);
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

interface ProductLite {
  id: string; sku: string; name: string; brand: string | null;
  category: string; size: string | null; unit_type: string;
  reorder_level: number; cost_price: number;
}

async function loadProducts(dealerId: string): Promise<ProductLite[]> {
  const rows = await db('products')
    .where({ dealer_id: dealerId, active: true })
    .select('id', 'sku', 'name', 'brand', 'category', 'size', 'unit_type', 'reorder_level', 'cost_price');
  return rows.map((p: any) => ({
    id: p.id, sku: p.sku, name: p.name, brand: p.brand ?? null,
    category: String(p.category), size: p.size ?? null, unit_type: String(p.unit_type),
    reorder_level: Number(p.reorder_level ?? 0), cost_price: Number(p.cost_price ?? 0),
  }));
}

async function loadStockMap(dealerId: string, ids: string[]) {
  const m = new Map<string, { total: number }>();
  if (!ids.length) return m;
  const rows = await db('stock')
    .where('dealer_id', dealerId).whereIn('product_id', ids)
    .select('product_id', 'box_qty', 'piece_qty');
  for (const s of rows as any[]) m.set(s.product_id, { total: Number(s.box_qty ?? 0) + Number(s.piece_qty ?? 0) });
  return m;
}

async function loadReservedMap(dealerId: string, ids: string[]) {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const rows = await db('product_batches')
    .where('dealer_id', dealerId).whereIn('product_id', ids)
    .select('product_id', 'reserved_box_qty', 'reserved_piece_qty');
  for (const b of rows as any[]) {
    const r = Number(b.reserved_box_qty ?? 0) + Number(b.reserved_piece_qty ?? 0);
    m.set(b.product_id, (m.get(b.product_id) ?? 0) + r);
  }
  return m;
}

async function loadShortageMap(dealerId: string, ids: string[]) {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const rows = await db('sale_items')
    .where('dealer_id', dealerId).whereIn('product_id', ids).where('backorder_qty', '>', 0)
    .select('product_id', 'backorder_qty', 'allocated_qty');
  for (const r of rows as any[]) {
    const open = Math.max(0, Number(r.backorder_qty ?? 0) - Number(r.allocated_qty ?? 0));
    if (open > 0) m.set(r.product_id, (m.get(r.product_id) ?? 0) + open);
  }
  return m;
}

interface SalesAgg { sold30: number; sold60: number; sold90: number; lastSale: string | null }

async function loadSalesMap(dealerId: string, ids: string[], settings: Settings) {
  const m = new Map<string, SalesAgg>();
  if (!ids.length) return m;
  const longWindow = Math.max(settings.dead_stock_days, 90);
  const sinceLong = isoDaysAgo(longWindow);

  const rows = await db('sale_items as si')
    .innerJoin('sales as s', 's.id', 'si.sale_id')
    .where('si.dealer_id', dealerId)
    .whereIn('si.product_id', ids)
    .where('s.created_at', '>=', sinceLong)
    .select('si.product_id', 'si.quantity', 's.created_at as s_created_at');

  const now = Date.now();
  const cutoffShort = now - settings.velocity_window_days * 86_400_000;
  const cutoff60 = now - 60 * 86_400_000;
  for (const row of rows as any[]) {
    const createdAt = row.s_created_at ? new Date(row.s_created_at).toISOString() : null;
    if (!createdAt) continue;
    const ts = new Date(createdAt).getTime();
    const qty = Number(row.quantity ?? 0);
    const cur = m.get(row.product_id) ?? { sold30: 0, sold60: 0, sold90: 0, lastSale: null };
    cur.sold90 += qty;
    if (ts >= cutoff60) cur.sold60 += qty;
    if (ts >= cutoffShort) cur.sold30 += qty;
    if (!cur.lastSale || createdAt > cur.lastSale) cur.lastSale = createdAt;
    m.set(row.product_id, cur);
  }
  return m;
}

async function loadIncomingMap(dealerId: string, ids: string[], windowDays: number) {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const since = isoDaysAgo(windowDays).slice(0, 10);
  const rows = await db('purchase_items as pi')
    .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
    .where('pi.dealer_id', dealerId)
    .whereIn('pi.product_id', ids)
    .where('p.purchase_date', '>=', since)
    .select('pi.product_id', 'pi.quantity');
  for (const row of rows as any[]) {
    m.set(row.product_id, (m.get(row.product_id) ?? 0) + Number(row.quantity ?? 0));
  }
  return m;
}

type DemandFlag = 'stockout_risk' | 'low_stock' | 'reorder_suggested' | 'fast_moving' | 'slow_moving' | 'dead_stock' | 'ok';
type CoverageStatus = 'uncovered' | 'partial' | 'covered' | 'no_need';

function pickPrimary(flags: DemandFlag[]): DemandFlag {
  const order: DemandFlag[] = ['stockout_risk', 'dead_stock', 'low_stock', 'reorder_suggested', 'slow_moving', 'fast_moving', 'ok'];
  for (const f of order) if (flags.includes(f)) return f;
  return 'ok';
}

function classify(
  p: ProductLite, totalStock: number, reserved: number, shortage: number, incoming: number,
  sold30: number, sold60: number, sold90: number, lastSale: string | null, s: Settings,
) {
  const free = Math.max(0, totalStock - reserved);
  const velocity = sold30 / s.velocity_window_days;
  const safety = Math.ceil(velocity * s.safety_stock_days);
  const sellable = Math.max(0, free - safety);
  const cover = velocity > 0 ? sellable / velocity : null;

  const prior30 = Math.max(0, sold60 - sold30);
  let velocity_trend: 'rising' | 'steady' | 'falling' | 'flat' = 'flat';
  if (sold30 === 0 && prior30 === 0) velocity_trend = 'flat';
  else if (prior30 === 0) velocity_trend = sold30 > 0 ? 'rising' : 'flat';
  else {
    const ratio = sold30 / prior30;
    if (ratio >= 1.25) velocity_trend = 'rising';
    else if (ratio <= 0.75) velocity_trend = 'falling';
    else velocity_trend = 'steady';
  }

  const flags: DemandFlag[] = [];
  const reasons: string[] = [];

  if (velocity > 0 && (free <= safety || (cover !== null && cover < s.stockout_cover_days))) {
    flags.push('stockout_risk');
    reasons.push(cover !== null
      ? `Only ~${cover.toFixed(1)} days of cover at current velocity (target ≥ ${s.stockout_cover_days}d).`
      : `Free stock at or below safety cushion (${safety}).`);
  }
  if (velocity > 0 && free <= p.reorder_level + safety) {
    flags.push('low_stock');
    reasons.push(`Free stock ${free} ≤ reorder level ${p.reorder_level} + safety ${safety}.`);
  }
  if (velocity > 0 && (free <= p.reorder_level + safety || (cover !== null && cover < s.reorder_cover_days))) {
    flags.push('reorder_suggested');
    reasons.push(cover !== null && cover < s.reorder_cover_days
      ? `Cover ${cover.toFixed(1)}d is below reorder threshold (${s.reorder_cover_days}d).`
      : `Free stock has reached the reorder line.`);
  }
  if (sold30 >= s.fast_moving_30d_qty) {
    flags.push('fast_moving');
    reasons.push(`Sold ${sold30} units in last 30d (≥ ${s.fast_moving_30d_qty}).`);
  }
  if (sold90 > 0 && sold30 < s.slow_moving_30d_max) {
    flags.push('slow_moving');
    reasons.push(`Only ${sold30} sold in last 30d (threshold < ${s.slow_moving_30d_max}).`);
  }
  const daysSince = daysBetween(lastSale);
  if (totalStock > 0 && (daysSince === null || daysSince >= s.dead_stock_days) && sold90 === 0) {
    flags.push('dead_stock');
    reasons.push(daysSince === null
      ? `Stock on hand but no sale ever recorded.`
      : `${daysSince} days since last sale (dead after ${s.dead_stock_days}d).`);
  }

  const targetQty = Math.ceil(velocity * s.target_cover_days) + safety;
  const fromTarget = Math.max(0, targetQty - free + shortage);
  const fromReorder = Math.max(0, p.reorder_level * 2 - free);
  const suggested = Math.max(fromTarget, fromReorder);

  const need = shortage + Math.max(0, p.reorder_level + safety - free);
  let coverage_status: CoverageStatus;
  let coverage_ratio: number | null;
  if (need <= 0) { coverage_status = 'no_need'; coverage_ratio = null; }
  else if (incoming <= 0) { coverage_status = 'uncovered'; coverage_ratio = 0; }
  else if (incoming >= need) { coverage_status = 'covered'; coverage_ratio = 1; }
  else { coverage_status = 'partial'; coverage_ratio = Math.round((incoming / need) * 100) / 100; }
  const uncovered_gap = Math.max(0, need - incoming);

  return {
    flags: flags.length ? flags : (['ok'] as DemandFlag[]),
    reasons, velocity, velocity_trend, cover, suggested, safety,
    coverage_status, coverage_ratio, uncovered_gap,
  };
}

export async function getDemandRows(dealerId: string) {
  const settings = await loadSettings(dealerId);
  const products = await loadProducts(dealerId);
  if (!products.length) return { rows: [], settings, products };
  const ids = products.map((p) => p.id);
  const [stockMap, reservedMap, shortageMap, salesMap, incomingMap] = await Promise.all([
    loadStockMap(dealerId, ids),
    loadReservedMap(dealerId, ids),
    loadShortageMap(dealerId, ids),
    loadSalesMap(dealerId, ids, settings),
    loadIncomingMap(dealerId, ids, settings.incoming_window_days),
  ]);

  const rows = products.map((p) => {
    const total = stockMap.get(p.id)?.total ?? 0;
    const reserved = reservedMap.get(p.id) ?? 0;
    const shortage = shortageMap.get(p.id) ?? 0;
    const incoming = incomingMap.get(p.id) ?? 0;
    const sales = salesMap.get(p.id) ?? { sold30: 0, sold60: 0, sold90: 0, lastSale: null };
    const c = classify(p, total, reserved, shortage, incoming, sales.sold30, sales.sold60, sales.sold90, sales.lastSale, settings);
    return {
      product_id: p.id, sku: p.sku, name: p.name, brand: p.brand, category: p.category,
      size: p.size, unit_type: p.unit_type, reorder_level: p.reorder_level,
      total_stock: total, reserved_stock: reserved, free_stock: Math.max(0, total - reserved),
      safety_stock: c.safety, open_shortage: shortage, incoming_qty: incoming,
      uncovered_gap: c.uncovered_gap, coverage_status: c.coverage_status, coverage_ratio: c.coverage_ratio,
      sold_30d: sales.sold30, sold_60d: sales.sold60, sold_90d: sales.sold90,
      velocity_per_day: Math.round(c.velocity * 100) / 100, velocity_trend: c.velocity_trend,
      days_of_cover: c.cover === null ? null : Math.round(c.cover * 10) / 10,
      last_sale_date: sales.lastSale, days_since_last_sale: daysBetween(sales.lastSale),
      suggested_reorder_qty: c.suggested, flags: c.flags,
      primary_flag: pickPrimary(c.flags), flag_reasons: c.reasons,
    };
  });
  return { rows, settings, products };
}

async function getProjectRows(dealerId: string) {
  const rows = await db('sale_items as si')
    .innerJoin('sales as s', 's.id', 'si.sale_id')
    .leftJoin('customers as c', 'c.id', 's.customer_id')
    .leftJoin('projects as p', 'p.id', 's.project_id')
    .leftJoin('project_sites as ps', 'ps.id', 's.site_id')
    .where('si.dealer_id', dealerId)
    .where('si.backorder_qty', '>', 0)
    .whereNotNull('s.project_id')
    .select(
      'si.product_id', 'si.backorder_qty', 'si.allocated_qty',
      's.created_at as s_created_at', 's.project_id', 's.site_id', 's.customer_id',
      'c.name as c_name', 'p.id as p_id', 'p.project_name as p_name',
      'ps.id as ps_id', 'ps.site_name as ps_name',
    );

  type Agg = {
    project_id: string; project_name: string;
    site_id: string | null; site_name: string | null;
    customer_id: string | null; customer_name: string | null;
    products: Set<string>; open_shortage: number; oldest: string | null;
  };
  const map = new Map<string, Agg>();
  for (const r of rows as any[]) {
    const open = Math.max(0, Number(r.backorder_qty ?? 0) - Number(r.allocated_qty ?? 0));
    if (open <= 0) continue;
    if (!r.project_id || !r.p_id) continue;
    const key = `${r.project_id}::${r.site_id ?? '_'}`;
    const cur = map.get(key) ?? {
      project_id: r.project_id, project_name: r.p_name,
      site_id: r.site_id ?? null, site_name: r.ps_name ?? null,
      customer_id: r.customer_id ?? null, customer_name: r.c_name ?? null,
      products: new Set<string>(), open_shortage: 0, oldest: null as string | null,
    };
    cur.products.add(r.product_id);
    cur.open_shortage += open;
    const createdAt = r.s_created_at ? new Date(r.s_created_at).toISOString() : null;
    if (createdAt && (!cur.oldest || createdAt < cur.oldest)) cur.oldest = createdAt;
    map.set(key, cur);
  }
  if (map.size === 0) return [];

  const settings = await loadSettings(dealerId);
  const allIds = Array.from(new Set(Array.from(map.values()).flatMap((a) => Array.from(a.products))));
  const incomingMap = await loadIncomingMap(dealerId, allIds, settings.incoming_window_days);

  return Array.from(map.values())
    .map((a) => {
      const incoming = Array.from(a.products).reduce((sum, pid) => sum + (incomingMap.get(pid) ?? 0), 0);
      return {
        project_id: a.project_id, project_name: a.project_name,
        site_id: a.site_id, site_name: a.site_name,
        customer_id: a.customer_id, customer_name: a.customer_name,
        product_count: a.products.size,
        open_shortage_total: a.open_shortage,
        incoming_total: incoming,
        uncovered_gap: Math.max(0, a.open_shortage - incoming),
        oldest_shortage_date: a.oldest,
        days_waiting: daysBetween(a.oldest),
      };
    })
    .sort((x, y) => y.open_shortage_total - x.open_shortage_total);
}

router.get('/rows', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const { rows } = await getDemandRows(dealerId);
    res.json({ rows });
  } catch (e: any) {
    console.error('[demand-planning rows]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load demand rows' });
  }
});

router.get('/project-rows', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const rows = await getProjectRows(dealerId);
    res.json({ rows });
  } catch (e: any) {
    console.error('[demand-planning project-rows]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load project rows' });
  }
});

router.get('/dashboard-stats', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const [{ rows, products }, projectRows] = await Promise.all([
      getDemandRows(dealerId),
      getProjectRows(dealerId),
    ]);
    const costMap = new Map(products.map((p) => [p.id, p.cost_price]));

    let deadValue = 0;
    let reorder = 0, low = 0, risk = 0, dead = 0, fast = 0, slow = 0, incoming = 0, gap = 0;
    const byCategory = new Map<string, number>();
    const byBrand = new Map<string, number>();

    for (const r of rows) {
      if (r.flags.includes('reorder_suggested')) reorder++;
      if (r.flags.includes('low_stock')) low++;
      if (r.flags.includes('stockout_risk')) risk++;
      if (r.flags.includes('dead_stock')) {
        dead++;
        deadValue += r.total_stock * (costMap.get(r.product_id) ?? 0);
      }
      if (r.flags.includes('fast_moving')) fast++;
      if (r.flags.includes('slow_moving')) slow++;
      if (r.incoming_qty > 0) incoming++;
      if (r.uncovered_gap > 0) gap++;

      const isAtRisk = r.flags.includes('stockout_risk') || r.flags.includes('low_stock') || r.flags.includes('reorder_suggested');
      if (isAtRisk) {
        byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
        const b = (r.brand ?? '—').trim() || '—';
        byBrand.set(b, (byBrand.get(b) ?? 0) + 1);
      }
    }

    const topN = (m: Map<string, number>, n = 3) =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));

    const projectAgg = new Map<string, { name: string; open: number; days: number }>();
    for (const r of projectRows) {
      const cur = projectAgg.get(r.project_id) ?? { name: r.project_name, open: 0, days: 0 };
      cur.open += r.open_shortage_total;
      cur.days = Math.max(cur.days, r.days_waiting ?? 0);
      projectAgg.set(r.project_id, cur);
    }
    const topWaitingProjects = Array.from(projectAgg.entries())
      .map(([project_id, v]) => ({ project_id, project_name: v.name, open_shortage: v.open, days_waiting: v.days }))
      .sort((a, b) => b.open_shortage - a.open_shortage).slice(0, 5);

    res.json({
      data: {
        reorderNeededCount: reorder, lowStockCount: low, stockoutRiskCount: risk,
        deadStockCount: dead, deadStockValue: Math.round(deadValue * 100) / 100,
        fastMovingCount: fast, slowMovingCount: slow,
        incomingCoverageProductCount: incoming, uncoveredGapCount: gap,
        topCategoriesAtRisk: topN(byCategory), topBrandsAtRisk: topN(byBrand),
        topWaitingProjects,
      },
    });
  } catch (e: any) {
    console.error('[demand-planning dashboard]', e.message);
    res.status(500).json({ error: e.message || 'Failed to load stats' });
  }
});

export default router;
