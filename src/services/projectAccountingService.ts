/**
 * projectAccountingService — V2 Sprint 6D.
 * Wraps /api/project-accounting (budget/revenue/expense/profitability/ledger
 * for a single project). Project Master CRUD itself lives in projectService.ts
 * (pre-existing, untouched) — this service is purely the accounting overlay.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface ProjectAccountingSummary {
  project: { id: string; project_name: string; project_code: string; status: string };
  budget: { amount: number; period_start: string; period_end: string; revision_no: number } | null;
  revenue: number;
  expense: number;
  profit: number;
  margin_percent: number | null;
  budget_variance: number | null;
}

export interface ProjectProfitability {
  project_id: string;
  from: string | null;
  to: string | null;
  revenue: number;
  expense: number;
  profit: number;
  margin_percent: number | null;
}

export interface ProjectLedger {
  project_id: string;
  from: string | null;
  to: string | null;
  total: number;
  by_domain: Record<string, number>;
  line_count: number;
  lines: Array<{ line_domain: string; line_type: string; amount: number; entry_date: string; posting_batch_id: string }>;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const projectAccountingService = {
  async summary(dealerId: string, projectId: string): Promise<ProjectAccountingSummary> {
    const r = await vpsAuthedFetch(`/api/project-accounting/${projectId}/summary?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load project accounting summary");
    return r.json();
  },
  async profitability(dealerId: string, projectId: string, from?: string, to?: string): Promise<ProjectProfitability> {
    const params = new URLSearchParams({ dealerId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await vpsAuthedFetch(`/api/project-accounting/${projectId}/profitability?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load project profitability");
    return r.json();
  },
  async expenses(dealerId: string, projectId: string, from?: string, to?: string): Promise<{ rows: Array<{ id: string; description: string; amount: number; expense_date: string; category: string | null }> }> {
    const params = new URLSearchParams({ dealerId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await vpsAuthedFetch(`/api/project-accounting/${projectId}/expenses?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load project expenses");
    return r.json();
  },
  async ledger(dealerId: string, projectId: string, from?: string, to?: string): Promise<ProjectLedger> {
    const params = new URLSearchParams({ dealerId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await vpsAuthedFetch(`/api/project-accounting/${projectId}/ledger?${params.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load project ledger");
    return r.json();
  },
};
