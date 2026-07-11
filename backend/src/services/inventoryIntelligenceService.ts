import { db } from '../db/connection';
import { getDemandRows } from '../routes/demandPlanning';

function num(v: unknown): number {
  return Number(v) || 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Stock Aging
// ─────────────────────────────────────────────────────────────────────────

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export function computeAgingBucket(ageDays: number): AgingBucket {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 60) return '31-60';
  if (ageDays <= 90) return '61-90';
  return '90+';
}

export interface BatchAgingInput {
  id: string;
  product_id: string;
  product_name: string;
  batch_no: string;
  lot_no: string | null;
  shade_code: string | null;
  caliber: string | null;
  total_pieces: number | string;
  created_at: string;
}

export interface BatchAgingRow extends Omit<BatchAgingInput, 'total_pieces'> {
  total_pieces: number;
  age_days: number;
  bucket: AgingBucket;
}

/**
 * V2 Sprint 3D — Stock Aging (pure — no DB access). Buckets each active
 * batch by age since receipt (`product_batches.created_at`). Satisfies
 * "Batch Aging"/"Lot Aging" directly — `lot_no` is already a column on the
 * same batch row, no separate lot table needed.
 */
export function computeStockAgingFromBatches(
  batches: BatchAgingInput[],
  asOfMs: number,
): { rows: BatchAgingRow[]; bucketSummary: Array<{ bucket: AgingBucket; batchCount: number; totalPieces: number }> } {
  const rows: BatchAgingRow[] = batches.map((b) => {
    const ageDays = Math.max(0, Math.floor((asOfMs - new Date(b.created_at).getTime()) / 86_400_000));
    return { ...b, total_pieces: num(b.total_pieces), age_days: ageDays, bucket: computeAgingBucket(ageDays) };
  });

  const order: AgingBucket[] = ['0-30', '31-60', '61-90', '90+'];
  const summaryMap = new Map<AgingBucket, { batchCount: number; totalPieces: number }>();
  for (const b of order) summaryMap.set(b, { batchCount: 0, totalPieces: 0 });
  for (const r of rows) {
    const s = summaryMap.get(r.bucket)!;
    s.batchCount += 1;
    s.totalPieces += r.total_pieces;
  }

  return {
    rows,
    bucketSummary: order.map((bucket) => ({ bucket, ...summaryMap.get(bucket)! })),
  };
}

export async function getStockAging(dealerId: string): Promise<ReturnType<typeof computeStockAgingFromBatches>> {
  const batches = await db('product_batches as pb')
    .innerJoin('products as p', 'p.id', 'pb.product_id')
    .where({ 'pb.dealer_id': dealerId, 'pb.status': 'active' })
    .select(
      'pb.id', 'pb.product_id', 'p.name as product_name', 'pb.batch_no',
      'pb.lot_no', 'pb.shade_code', 'pb.caliber', 'pb.total_pieces', 'pb.created_at',
    )
    .orderBy('pb.created_at', 'asc');
  return computeStockAgingFromBatches(batches as unknown as BatchAgingInput[], Date.now());
}

// ─────────────────────────────────────────────────────────────────────────
// Inventory Analytics — ABC (value Pareto) / XYZ (demand variability)
// ─────────────────────────────────────────────────────────────────────────

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

/** Standard 70/90 Pareto thresholds on cumulative value share. */
export function computeAbcClass(cumulativeValueSharePct: number): AbcClass {
  if (cumulativeValueSharePct <= 70) return 'A';
  if (cumulativeValueSharePct <= 90) return 'B';
  return 'C';
}

/**
 * Coefficient-of-variation thresholds on 3 demand samples (last three 30-day
 * windows). CV = stdev / mean. X = stable, Y = variable, Z = erratic/no data.
 */
export function computeXyzClass(samples: number[]): XyzClass {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mean <= 0) return 'Z';
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv <= 0.5) return 'X';
  if (cv <= 1.0) return 'Y';
  return 'Z';
}

export interface AbcXyzInput {
  product_id: string;
  name: string;
  sku: string;
  stock_value: number;
  sold_0_30: number;
  sold_31_60: number;
  sold_61_90: number;
}

export interface AbcXyzRow extends AbcXyzInput {
  value_share_pct: number;
  cumulative_value_share_pct: number;
  abc_class: AbcClass;
  xyz_class: XyzClass;
  combined_class: string;
}

/**
 * V2 Sprint 3D — ABC/XYZ classification (pure — no DB access). ABC ranks by
 * stock value contribution (Pareto); XYZ ranks by demand variability across
 * three trailing 30-day windows (reusing the same 30/60/90-day sales
 * aggregation demandPlanning.ts already computes — see getInventoryAnalytics()
 * below for how the windows are split into non-overlapping 30-day buckets).
 */
export function computeAbcXyzFromInputs(products: AbcXyzInput[]): AbcXyzRow[] {
  const totalValue = products.reduce((sum, p) => sum + p.stock_value, 0);
  const sorted = [...products].sort((a, b) => b.stock_value - a.stock_value);

  let cumulative = 0;
  return sorted.map((p) => {
    const share = totalValue > 0 ? (p.stock_value / totalValue) * 100 : 0;
    cumulative += share;
    const abc = computeAbcClass(cumulative);
    const xyz = computeXyzClass([p.sold_0_30, p.sold_31_60, p.sold_61_90]);
    return {
      ...p,
      value_share_pct: Math.round(share * 100) / 100,
      cumulative_value_share_pct: Math.round(cumulative * 100) / 100,
      abc_class: abc,
      xyz_class: xyz,
      combined_class: `${abc}${xyz}`,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Stock / Warehouse / Godown Value
// ─────────────────────────────────────────────────────────────────────────

/**
 * Value of a quantity at a location, using the SAME unit convention as
 * `stock.average_cost_per_unit` itself (see purchases.ts: "weighted by SFT
 * for box_sft, by qty for piece") — i.e. cost is per-SFT for tile products,
 * per-piece otherwise. Using box_qty or total_pieces here would silently
 * misvalue every box_sft product.
 */
export function computeLocationValue(unitType: 'box_sft' | 'piece', sftQty: number, pieceQty: number, avgCostPerUnit: number): number {
  const qty = unitType === 'box_sft' ? sftQty : pieceQty;
  return Math.round(qty * avgCostPerUnit * 100) / 100;
}

export interface InventoryValueBreakdown {
  totalStockValue: number;
  byWarehouse: Array<{ warehouse_id: string; warehouse_name: string; value: number }>;
  byGodown: Array<{ godown_id: string; godown_name: string; value: number }>;
}

export async function getInventoryValue(dealerId: string): Promise<InventoryValueBreakdown> {
  const products = await db('products')
    .where({ dealer_id: dealerId })
    .select('id', 'unit_type');
  const unitTypeMap = new Map(products.map((p: any) => [p.id, p.unit_type as 'box_sft' | 'piece']));

  const stockRows = await db('stock')
    .where({ dealer_id: dealerId })
    .select('product_id', 'sft_qty', 'piece_qty', 'average_cost_per_unit');
  let totalStockValue = 0;
  for (const s of stockRows as any[]) {
    const unitType = unitTypeMap.get(s.product_id) ?? 'piece';
    totalStockValue += computeLocationValue(unitType, num(s.sft_qty), num(s.piece_qty), num(s.average_cost_per_unit));
  }

  const costMap = new Map(stockRows.map((s: any) => [s.product_id, num(s.average_cost_per_unit)]));

  const warehouseRows = await db('warehouse_stock as ws')
    .innerJoin('warehouses as w', 'w.id', 'ws.warehouse_id')
    .where({ 'ws.dealer_id': dealerId })
    .select('ws.warehouse_id', 'w.name as warehouse_name', 'ws.product_id', 'ws.sft_qty', 'ws.piece_qty');
  const warehouseValueMap = new Map<string, { name: string; value: number }>();
  for (const r of warehouseRows as any[]) {
    const unitType = unitTypeMap.get(r.product_id) ?? 'piece';
    const cost = costMap.get(r.product_id) ?? 0;
    const value = computeLocationValue(unitType, num(r.sft_qty), num(r.piece_qty), cost);
    const cur = warehouseValueMap.get(r.warehouse_id) ?? { name: r.warehouse_name, value: 0 };
    cur.value += value;
    warehouseValueMap.set(r.warehouse_id, cur);
  }

  const godownRows = await db('godown_stock as gs')
    .innerJoin('godowns as g', 'g.id', 'gs.godown_id')
    .where({ 'gs.dealer_id': dealerId })
    .select('gs.godown_id', 'g.name as godown_name', 'gs.product_id', 'gs.sft_qty', 'gs.piece_qty');
  const godownValueMap = new Map<string, { name: string; value: number }>();
  for (const r of godownRows as any[]) {
    const unitType = unitTypeMap.get(r.product_id) ?? 'piece';
    const cost = costMap.get(r.product_id) ?? 0;
    const value = computeLocationValue(unitType, num(r.sft_qty), num(r.piece_qty), cost);
    const cur = godownValueMap.get(r.godown_id) ?? { name: r.godown_name, value: 0 };
    cur.value += value;
    godownValueMap.set(r.godown_id, cur);
  }

  return {
    totalStockValue: Math.round(totalStockValue * 100) / 100,
    byWarehouse: Array.from(warehouseValueMap.entries()).map(([warehouse_id, v]) => ({
      warehouse_id, warehouse_name: v.name, value: Math.round(v.value * 100) / 100,
    })),
    byGodown: Array.from(godownValueMap.entries()).map(([godown_id, v]) => ({
      godown_id, godown_name: v.name, value: Math.round(v.value * 100) / 100,
    })),
  };
}

export async function getInventoryAnalytics(dealerId: string): Promise<AbcXyzRow[]> {
  const { rows: demandRows } = await getDemandRows(dealerId);
  const stockRows = await db('stock').where({ dealer_id: dealerId }).select('product_id', 'sft_qty', 'piece_qty', 'average_cost_per_unit');
  const products = await db('products').where({ dealer_id: dealerId }).select('id', 'unit_type', 'name', 'sku');
  const unitTypeMap = new Map(products.map((p: any) => [p.id, p.unit_type as 'box_sft' | 'piece']));
  const nameMap = new Map(products.map((p: any) => [p.id, { name: p.name, sku: p.sku }]));
  const stockMap = new Map(stockRows.map((s: any) => [s.product_id, s]));

  const inputs: AbcXyzInput[] = demandRows.map((r) => {
    const s: any = stockMap.get(r.product_id);
    const unitType = unitTypeMap.get(r.product_id) ?? 'piece';
    const value = s ? computeLocationValue(unitType, num(s.sft_qty), num(s.piece_qty), num(s.average_cost_per_unit)) : 0;
    // 3 non-overlapping trailing 30-day windows from the cumulative 30/60/90 sums.
    const sold_0_30 = r.sold_30d;
    const sold_31_60 = Math.max(0, r.sold_60d - r.sold_30d);
    const sold_61_90 = Math.max(0, r.sold_90d - r.sold_60d);
    const meta = nameMap.get(r.product_id);
    return {
      product_id: r.product_id, name: meta?.name ?? r.name, sku: meta?.sku ?? r.sku,
      stock_value: value, sold_0_30, sold_31_60, sold_61_90,
    };
  });

  return computeAbcXyzFromInputs(inputs);
}

// ─────────────────────────────────────────────────────────────────────────
// Inventory Turnover
// ─────────────────────────────────────────────────────────────────────────

export interface TurnoverResult {
  turnoverRatioAnnualized: number;
  daysSalesOfInventory: number | null;
}

/**
 * Turnover ≈ (90-day COGS, annualized ×4) / current stock value. This is an
 * approximation — a true turnover ratio needs AVERAGE inventory value over
 * the period, which would require historical stock snapshots that don't
 * exist in this schema. Using the current value as the denominator is the
 * standard simplification when only a point-in-time snapshot is available;
 * documented here rather than silently assumed.
 */
export function computeTurnoverFromInputs(cogs90d: number, currentStockValue: number): TurnoverResult {
  if (currentStockValue <= 0) return { turnoverRatioAnnualized: 0, daysSalesOfInventory: null };
  const turnoverRatioAnnualized = Math.round(((cogs90d * 4) / currentStockValue) * 100) / 100;
  const daysSalesOfInventory = turnoverRatioAnnualized > 0 ? Math.round((365 / turnoverRatioAnnualized) * 10) / 10 : null;
  return { turnoverRatioAnnualized, daysSalesOfInventory };
}

/**
 * 90-day COGS, computed directly from `sale_items` rather than reused from
 * demandPlanning's `sold_90d` (which is in the product's native box/piece
 * unit) — `sale_items.total_sft` already exists precisely so box_sft
 * quantities can be valued in SFT, matching `average_cost_per_unit`'s own
 * per-SFT convention. Using total_sft directly avoids re-deriving it.
 */
async function getCogs90dByProduct(dealerId: string): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const rows = await db('sale_items as si')
    .innerJoin('sales as s', 's.id', 'si.sale_id')
    .innerJoin('products as p', 'p.id', 'si.product_id')
    .innerJoin('stock as st', function () {
      this.on('st.product_id', '=', 'si.product_id').andOn('st.dealer_id', '=', 'si.dealer_id');
    })
    .where('si.dealer_id', dealerId)
    .where('s.created_at', '>=', since)
    .select('si.product_id', 'si.quantity', 'si.total_sft', 'p.unit_type', 'st.average_cost_per_unit');

  const m = new Map<string, number>();
  for (const r of rows as any[]) {
    const qty = r.unit_type === 'box_sft' ? num(r.total_sft) : num(r.quantity);
    const cogs = qty * num(r.average_cost_per_unit);
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + cogs);
  }
  return m;
}

export async function getInventoryTurnover(dealerId: string): Promise<TurnoverResult> {
  const [cogsMap, value] = await Promise.all([
    getCogs90dByProduct(dealerId),
    getInventoryValue(dealerId),
  ]);
  const cogs90d = Array.from(cogsMap.values()).reduce((sum, v) => sum + v, 0);
  return computeTurnoverFromInputs(cogs90d, value.totalStockValue);
}

// ─────────────────────────────────────────────────────────────────────────
// Low Stock Monitoring — Min/Max Stock thresholds (new, additive table)
// ─────────────────────────────────────────────────────────────────────────

export interface StockThreshold {
  id: string;
  dealer_id: string;
  product_id: string;
  min_stock: number | null;
  max_stock: number | null;
}

export async function listStockThresholds(dealerId: string): Promise<StockThreshold[]> {
  return db('product_stock_thresholds').where({ dealer_id: dealerId }).select('*');
}

export async function upsertStockThreshold(
  dealerId: string,
  productId: string,
  patch: { min_stock?: number | null; max_stock?: number | null },
): Promise<StockThreshold> {
  const existing = await db('product_stock_thresholds').where({ dealer_id: dealerId, product_id: productId }).first();
  if (existing) {
    const [row] = await db('product_stock_thresholds')
      .where({ id: existing.id })
      .update({ ...patch, updated_at: db.fn.now() })
      .returning('*');
    return row;
  }
  const [row] = await db('product_stock_thresholds')
    .insert({ dealer_id: dealerId, product_id: productId, ...patch })
    .returning('*');
  return row;
}

export type LowStockStatus = 'understock' | 'reorder' | 'ok' | 'overstock';

export function computeLowStockStatus(freeStock: number, reorderLevel: number, minStock: number | null, maxStock: number | null): LowStockStatus {
  if (minStock != null && freeStock < minStock) return 'understock';
  if (maxStock != null && freeStock > maxStock) return 'overstock';
  if (freeStock <= reorderLevel) return 'reorder';
  return 'ok';
}

export interface LowStockRow {
  product_id: string;
  name: string;
  sku: string;
  free_stock: number;
  reorder_level: number;
  min_stock: number | null;
  max_stock: number | null;
  status: LowStockStatus;
}

/**
 * V2 Sprint 3D — Low Stock Monitoring. Reuses demandPlanning.ts's existing
 * `free_stock`/`reorder_level` computation (velocity, safety-stock-aware)
 * rather than re-deriving it, and layers the new min/max thresholds on top.
 */
export async function getLowStockView(dealerId: string): Promise<LowStockRow[]> {
  const [{ rows: demandRows }, thresholds] = await Promise.all([
    getDemandRows(dealerId),
    listStockThresholds(dealerId),
  ]);
  const thresholdMap = new Map(thresholds.map((t) => [t.product_id, t]));

  return demandRows.map((r) => {
    const t = thresholdMap.get(r.product_id);
    const minStock = t?.min_stock ?? null;
    const maxStock = t?.max_stock ?? null;
    return {
      product_id: r.product_id, name: r.name, sku: r.sku,
      free_stock: r.free_stock, reorder_level: r.reorder_level,
      min_stock: minStock, max_stock: maxStock,
      status: computeLowStockStatus(r.free_stock, r.reorder_level, minStock, maxStock),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Inventory Health Dashboard
// ─────────────────────────────────────────────────────────────────────────

export interface HealthScoreInputs {
  totalActiveProducts: number;
  understockCount: number;
  overstockCount: number;
  stockoutRiskCount: number;
  slowMovingCount: number;
  deadStockValue: number;
  totalStockValue: number;
}

export interface HealthScoreResult {
  score: number;
  breakdown: { label: string; penalty: number }[];
}

/**
 * V2 Sprint 3D — Inventory Health Score (pure — no DB access). Starts at
 * 100 and subtracts weighted penalties. Weights: stockout risk and dead
 * stock value are the worst outcomes (25 pts each), understock is serious
 * (25 pts), overstock less severe (15 pts), slow-moving is a minor signal
 * (10 pts) — total addressable penalty = 100. Documented explicitly rather
 * than left as an unexplained black-box number.
 */
export function computeHealthScoreFromInputs(inputs: HealthScoreInputs): HealthScoreResult {
  const n = Math.max(1, inputs.totalActiveProducts);
  const deadStockValueRatio = inputs.totalStockValue > 0 ? inputs.deadStockValue / inputs.totalStockValue : 0;

  const breakdown = [
    { label: 'Stockout risk', penalty: Math.round((inputs.stockoutRiskCount / n) * 25 * 100) / 100 },
    { label: 'Understock (below Min Stock)', penalty: Math.round((inputs.understockCount / n) * 25 * 100) / 100 },
    { label: 'Dead stock value share', penalty: Math.round(deadStockValueRatio * 25 * 100) / 100 },
    { label: 'Overstock (above Max Stock)', penalty: Math.round((inputs.overstockCount / n) * 15 * 100) / 100 },
    { label: 'Slow-moving items', penalty: Math.round((inputs.slowMovingCount / n) * 10 * 100) / 100 },
  ];

  const totalPenalty = breakdown.reduce((sum, b) => sum + b.penalty, 0);
  const score = Math.max(0, Math.min(100, Math.round((100 - totalPenalty) * 100) / 100));
  return { score, breakdown };
}

export interface InventoryHealthDashboard {
  score: number;
  breakdown: { label: string; penalty: number }[];
  totalActiveProducts: number;
  understockCount: number;
  overstockCount: number;
  stockoutRiskCount: number;
  fastMovingCount: number;
  slowMovingCount: number;
  deadStockCount: number;
  deadStockValue: number;
  totalStockValue: number;
}

export async function getInventoryHealth(dealerId: string): Promise<InventoryHealthDashboard> {
  const [{ rows: demandRows, products }, lowStockRows, value] = await Promise.all([
    getDemandRows(dealerId),
    getLowStockView(dealerId),
    getInventoryValue(dealerId),
  ]);

  const costMap = new Map(products.map((p) => [p.id, p.cost_price]));
  let deadStockValue = 0;
  let stockoutRiskCount = 0, fastMovingCount = 0, slowMovingCount = 0, deadStockCount = 0;
  for (const r of demandRows) {
    if (r.flags.includes('stockout_risk')) stockoutRiskCount++;
    if (r.flags.includes('fast_moving')) fastMovingCount++;
    if (r.flags.includes('slow_moving')) slowMovingCount++;
    if (r.flags.includes('dead_stock')) {
      deadStockCount++;
      deadStockValue += r.total_stock * (costMap.get(r.product_id) ?? 0);
    }
  }
  const understockCount = lowStockRows.filter((r) => r.status === 'understock').length;
  const overstockCount = lowStockRows.filter((r) => r.status === 'overstock').length;

  const { score, breakdown } = computeHealthScoreFromInputs({
    totalActiveProducts: products.length,
    understockCount, overstockCount, stockoutRiskCount, slowMovingCount,
    deadStockValue, totalStockValue: value.totalStockValue,
  });

  return {
    score, breakdown, totalActiveProducts: products.length,
    understockCount, overstockCount, stockoutRiskCount, fastMovingCount, slowMovingCount,
    deadStockCount, deadStockValue: Math.round(deadStockValue * 100) / 100,
    totalStockValue: value.totalStockValue,
  };
}
