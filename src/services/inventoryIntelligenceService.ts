/**
 * Inventory Intelligence — V2 Sprint 3D.
 * Dead/Slow/Fast-moving analysis lives in the Reports module
 * (DemandPlanningReports.tsx) and Reorder Intelligence lives at
 * /purchases/auto-draft — both already fully built, not duplicated here.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface StockThreshold {
  id: string;
  dealer_id: string;
  product_id: string;
  min_stock: number | null;
  max_stock: number | null;
}

export type LowStockStatus = "understock" | "reorder" | "ok" | "overstock";

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

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export interface BatchAgingRow {
  id: string;
  product_id: string;
  product_name: string;
  batch_no: string;
  lot_no: string | null;
  shade_code: string | null;
  caliber: string | null;
  total_pieces: number;
  created_at: string;
  age_days: number;
  bucket: AgingBucket;
}

export interface StockAgingResponse {
  rows: BatchAgingRow[];
  bucketSummary: Array<{ bucket: AgingBucket; batchCount: number; totalPieces: number }>;
}

export interface AbcXyzRow {
  product_id: string;
  name: string;
  sku: string;
  stock_value: number;
  value_share_pct: number;
  cumulative_value_share_pct: number;
  abc_class: "A" | "B" | "C";
  xyz_class: "X" | "Y" | "Z";
  combined_class: string;
}

export interface InventoryValueBreakdown {
  totalStockValue: number;
  byWarehouse: Array<{ warehouse_id: string; warehouse_name: string; value: number }>;
  byGodown: Array<{ godown_id: string; godown_name: string; value: number }>;
}

export interface TurnoverResult {
  turnoverRatioAnnualized: number;
  daysSalesOfInventory: number | null;
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

async function vpsGet<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const inventoryIntelligenceService = {
  getThresholds: async (dealerId: string) => {
    const body = await vpsGet<{ rows: StockThreshold[] }>(`/api/inventory-intelligence/thresholds?dealerId=${encodeURIComponent(dealerId)}`);
    return body.rows ?? [];
  },
  setThreshold: async (dealerId: string, productId: string, patch: { min_stock?: number | null; max_stock?: number | null }) => {
    const res = await vpsAuthedFetch(`/api/inventory-intelligence/thresholds/${encodeURIComponent(productId)}?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as any)?.error ?? `Request failed (${res.status})`);
    return body as StockThreshold;
  },
  getLowStock: async (dealerId: string) => {
    const body = await vpsGet<{ rows: LowStockRow[] }>(`/api/inventory-intelligence/low-stock?dealerId=${encodeURIComponent(dealerId)}`);
    return body.rows ?? [];
  },
  getStockAging: (dealerId: string) =>
    vpsGet<StockAgingResponse>(`/api/inventory-intelligence/stock-aging?dealerId=${encodeURIComponent(dealerId)}`),
  getAnalytics: async (dealerId: string) => {
    const body = await vpsGet<{ rows: AbcXyzRow[] }>(`/api/inventory-intelligence/analytics?dealerId=${encodeURIComponent(dealerId)}`);
    return body.rows ?? [];
  },
  getValue: (dealerId: string) =>
    vpsGet<InventoryValueBreakdown>(`/api/inventory-intelligence/value?dealerId=${encodeURIComponent(dealerId)}`),
  getTurnover: (dealerId: string) =>
    vpsGet<TurnoverResult>(`/api/inventory-intelligence/turnover?dealerId=${encodeURIComponent(dealerId)}`),
  getHealth: (dealerId: string) =>
    vpsGet<InventoryHealthDashboard>(`/api/inventory-intelligence/health?dealerId=${encodeURIComponent(dealerId)}`),
};
