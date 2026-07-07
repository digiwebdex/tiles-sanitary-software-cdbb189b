/**
 * costCenterService — V2 Sprint 6D.
 * Wraps GET/POST/PUT/DELETE /api/cost-centers and its /:id/report endpoint.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface CostCenter {
  id: string;
  dealer_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  department_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  notes: string | null;
  department_name?: string | null;
  branch_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CostCenterInput {
  code: string;
  name: string;
  parent_id?: string | null;
  department_id?: string | null;
  branch_id?: string | null;
  notes?: string | null;
}

export interface CostCenterReport {
  cost_center: { id: string; code: string; name: string };
  from: string | null;
  to: string | null;
  total: number;
  by_domain: Record<string, number>;
  line_count: number;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const costCenterService = {
  async list(dealerId: string, activeOnly = true): Promise<{ rows: CostCenter[] }> {
    const r = await vpsAuthedFetch(`/api/cost-centers?dealerId=${dealerId}&activeOnly=${activeOnly}`);
    if (!r.ok) return parseError(r, "Failed to load cost centers");
    return r.json();
  },
  async create(dealerId: string, payload: CostCenterInput): Promise<{ row: CostCenter }> {
    const r = await vpsAuthedFetch(`/api/cost-centers?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create cost center");
    return r.json();
  },
  async update(dealerId: string, id: string, payload: Partial<CostCenterInput> & { is_active?: boolean }): Promise<{ row: CostCenter }> {
    const r = await vpsAuthedFetch(`/api/cost-centers/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to update cost center");
    return r.json();
  },
  async remove(dealerId: string, id: string): Promise<{ ok: true }> {
    const r = await vpsAuthedFetch(`/api/cost-centers/${id}?dealerId=${dealerId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId }),
    });
    if (!r.ok) return parseError(r, "Failed to delete cost center");
    return r.json();
  },
  async report(dealerId: string, id: string, from?: string, to?: string): Promise<CostCenterReport> {
    const params = new URLSearchParams({ dealerId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await vpsAuthedFetch(`/api/cost-centers/${id}/report?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load cost center report");
    return r.json();
  },
};
