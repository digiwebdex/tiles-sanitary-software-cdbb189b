/**
 * fixedAssetService — V2 Sprint 6D.
 * Wraps /api/fixed-assets (categories, register, depreciation, disposal, reports).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface AssetCategory {
  id: string;
  dealer_id: string;
  name: string;
  default_useful_life_months: number | null;
  default_salvage_percent: number;
  default_depreciation_method: "straight_line" | "declining_balance";
  is_active: boolean;
}

export interface AssetCategoryInput {
  name: string;
  default_useful_life_months?: number | null;
  default_salvage_percent?: number;
  default_depreciation_method?: "straight_line" | "declining_balance";
}

export interface FixedAsset {
  id: string;
  dealer_id: string;
  tag: string;
  name: string;
  category: string | null;
  asset_category_id: string | null;
  category_name?: string | null;
  cost_center_name?: string | null;
  serial_no: string | null;
  brand: string | null;
  model: string | null;
  purchase_date: string | null;
  purchase_cost: number;
  status: string;
  useful_life_months: number | null;
  salvage_value: number;
  depreciation_method: "straight_line" | "declining_balance" | null;
  depreciation_rate: number | null;
  accumulated_depreciation: number;
  depreciation_start_date: string | null;
  disposed_at: string | null;
  disposal_proceeds: number | null;
  disposal_reason: string | null;
  purchase_posting_batch_id: string | null;
  disposal_posting_batch_id: string | null;
  cost_center_id: string | null;
  project_id: string | null;
  notes: string | null;
}

export type AssetFundingSource = { kind: "cash" } | { kind: "bank"; bank_account_id: string };

export interface CreateFixedAssetInput {
  tag: string;
  name: string;
  asset_category_id?: string | null;
  serial_no?: string | null;
  brand?: string | null;
  model?: string | null;
  purchase_date: string;
  amount: number;
  useful_life_months?: number | null;
  salvage_value?: number | null;
  depreciation_method?: "straight_line" | "declining_balance" | null;
  depreciation_rate?: number | null;
  depreciation_start_date?: string | null;
  cost_center_id?: string | null;
  project_id?: string | null;
  funded_by?: AssetFundingSource | null;
  notes?: string | null;
}

export interface DepreciationScheduleRow {
  id: string;
  asset_id: string;
  period_no: number;
  period_start: string;
  period_end: string;
  depreciation_amount: number;
  accumulated_after: number;
  book_value_after: number;
  status: string;
  posting_batch_id: string | null;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const fixedAssetService = {
  // ── Categories ──
  async listCategories(dealerId: string, activeOnly = true): Promise<{ rows: AssetCategory[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/categories?dealerId=${dealerId}&activeOnly=${activeOnly}`);
    if (!r.ok) return parseError(r, "Failed to load asset categories");
    return r.json();
  },
  async createCategory(dealerId: string, payload: AssetCategoryInput): Promise<{ row: AssetCategory }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/categories?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create asset category");
    return r.json();
  },
  async updateCategory(dealerId: string, id: string, payload: Partial<AssetCategoryInput> & { is_active?: boolean }): Promise<{ row: AssetCategory }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/categories/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to update asset category");
    return r.json();
  },
  async removeCategory(dealerId: string, id: string): Promise<{ ok: true }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/categories/${id}?dealerId=${dealerId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId }),
    });
    if (!r.ok) return parseError(r, "Failed to delete asset category");
    return r.json();
  },

  // ── Register ──
  async list(dealerId: string, filters?: { status?: string; categoryId?: string; costCenterId?: string; projectId?: string }): Promise<{ rows: FixedAsset[] }> {
    const params = new URLSearchParams({ dealerId });
    if (filters?.status) params.set("status", filters.status);
    if (filters?.categoryId) params.set("categoryId", filters.categoryId);
    if (filters?.costCenterId) params.set("costCenterId", filters.costCenterId);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    const r = await vpsAuthedFetch(`/api/fixed-assets?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load fixed assets");
    return r.json();
  },
  async get(dealerId: string, id: string): Promise<{ asset: FixedAsset; schedule: DepreciationScheduleRow[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load fixed asset");
    return r.json();
  },
  async create(dealerId: string, payload: CreateFixedAssetInput): Promise<{ asset: FixedAsset }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create fixed asset");
    return r.json();
  },
  async update(dealerId: string, id: string, payload: Partial<CreateFixedAssetInput>): Promise<{ row: FixedAsset }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to update fixed asset");
    return r.json();
  },

  // ── Depreciation ──
  async runDepreciation(dealerId: string, id: string, entryDate?: string): Promise<{ schedule: DepreciationScheduleRow; asset: FixedAsset }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}/depreciation/run?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, entry_date: entryDate }),
    });
    if (!r.ok) return parseError(r, "Failed to run depreciation");
    return r.json();
  },
  async runDepreciationForAll(dealerId: string, entryDate?: string): Promise<{ posted: unknown[]; skipped: unknown[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/depreciation/run-all?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, entry_date: entryDate }),
    });
    if (!r.ok) return parseError(r, "Failed to run depreciation batch");
    return r.json();
  },
  async depreciationSchedule(dealerId: string, id: string): Promise<{ rows: DepreciationScheduleRow[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}/depreciation-schedule?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load depreciation schedule");
    return r.json();
  },

  // ── Disposal ──
  async dispose(dealerId: string, id: string, payload: { entry_date: string; disposal_proceeds?: number; proceeds_via?: AssetFundingSource | null; disposal_reason?: string | null }): Promise<{ asset: FixedAsset; disposal_posting_batch_id: string | null; gain_loss: number }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}/dispose?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to dispose asset");
    return r.json();
  },

  // ── Reports / Ledger ──
  async registerReport(dealerId: string): Promise<{ rows: (FixedAsset & { book_value: number; category_name: string | null })[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/register-report?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load asset register report");
    return r.json();
  },
  async depreciationReport(dealerId: string, from?: string, to?: string): Promise<{ rows: (DepreciationScheduleRow & { tag: string; asset_name: string })[] }> {
    const params = new URLSearchParams({ dealerId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await vpsAuthedFetch(`/api/fixed-assets/depreciation-report?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load depreciation report");
    return r.json();
  },
  async ledger(dealerId: string, id: string): Promise<{ batches: unknown[]; lines: unknown[] }> {
    const r = await vpsAuthedFetch(`/api/fixed-assets/${id}/ledger?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load asset ledger");
    return r.json();
  },
};
