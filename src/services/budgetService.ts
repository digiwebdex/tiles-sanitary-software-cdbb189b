/**
 * budgetService — V2 Sprint 6D.
 * Wraps /api/budgets (allocation, revision, budget vs actual, variance).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type BudgetScopeType = "department" | "cost_center" | "project" | "account";

export interface Budget {
  id: string;
  dealer_id: string;
  fiscal_year_id: string;
  scope_type: BudgetScopeType;
  department_id: string | null;
  cost_center_id: string | null;
  project_id: string | null;
  account_code: string | null;
  period_type: "annual" | "monthly";
  period_start: string;
  period_end: string;
  amount: number;
  revision_no: number;
  supersedes_id: string | null;
  is_active: boolean;
  notes: string | null;
  department_name?: string | null;
  cost_center_name?: string | null;
  project_name?: string | null;
}

export interface BudgetInput {
  fiscal_year_id: string;
  scope_type: BudgetScopeType;
  department_id?: string | null;
  cost_center_id?: string | null;
  project_id?: string | null;
  account_code?: string | null;
  period_type?: "annual" | "monthly";
  period_start: string;
  period_end: string;
  amount: number;
  notes?: string | null;
}

export interface BudgetVariance {
  budget: Budget;
  actual: number;
  variance: number;
  variance_percent: number | null;
}

export interface VarianceReportRow {
  budget_id: string;
  scope_type: BudgetScopeType;
  department_id: string | null;
  cost_center_id: string | null;
  project_id: string | null;
  account_code: string | null;
  period_start: string;
  period_end: string;
  allocated: number;
  actual: number;
  variance: number;
  variance_percent: number | null;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const budgetService = {
  async list(dealerId: string, filters?: { fiscalYearId?: string; scopeType?: BudgetScopeType; departmentId?: string; costCenterId?: string; projectId?: string; activeOnly?: boolean }): Promise<{ rows: Budget[] }> {
    const params = new URLSearchParams({ dealerId });
    if (filters?.fiscalYearId) params.set("fiscalYearId", filters.fiscalYearId);
    if (filters?.scopeType) params.set("scopeType", filters.scopeType);
    if (filters?.departmentId) params.set("departmentId", filters.departmentId);
    if (filters?.costCenterId) params.set("costCenterId", filters.costCenterId);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.activeOnly === false) params.set("activeOnly", "false");
    const r = await vpsAuthedFetch(`/api/budgets?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load budgets");
    return r.json();
  },
  async get(dealerId: string, id: string): Promise<{ row: Budget }> {
    const r = await vpsAuthedFetch(`/api/budgets/${id}?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load budget");
    return r.json();
  },
  async create(dealerId: string, payload: BudgetInput): Promise<{ row: Budget }> {
    const r = await vpsAuthedFetch(`/api/budgets?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create budget");
    return r.json();
  },
  async revise(dealerId: string, id: string, payload: { amount: number; period_start?: string; period_end?: string; notes?: string | null }): Promise<{ row: Budget }> {
    const r = await vpsAuthedFetch(`/api/budgets/${id}/revise?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to revise budget");
    return r.json();
  },
  async variance(dealerId: string, id: string): Promise<BudgetVariance> {
    const r = await vpsAuthedFetch(`/api/budgets/${id}/variance?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load budget variance");
    return r.json();
  },
  async varianceReport(dealerId: string, filters?: { fiscalYearId?: string; scopeType?: BudgetScopeType }): Promise<{ rows: VarianceReportRow[] }> {
    const params = new URLSearchParams({ dealerId });
    if (filters?.fiscalYearId) params.set("fiscalYearId", filters.fiscalYearId);
    if (filters?.scopeType) params.set("scopeType", filters.scopeType);
    const r = await vpsAuthedFetch(`/api/budgets/variance-report?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load variance report");
    return r.json();
  },
};
