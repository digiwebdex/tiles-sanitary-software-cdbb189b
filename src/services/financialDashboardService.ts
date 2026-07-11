/**
 * financialDashboardService — V2 Sprint 6E.
 * Wraps /api/financial-dashboard.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface FinancialDashboard {
  period: { from: string | null; to: string | null };
  revenue: number;
  expenses: number;
  profit: number;
  cash_position: number;
  receivable: number;
  payable: number;
  inventory_value: number;
  current_ratio: number | null;
  working_capital: number;
  current_assets: number;
  current_liabilities: number;
  data_source: string;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const financialDashboardService = {
  async get(dealerId: string, from?: string, to?: string): Promise<FinancialDashboard> {
    const qs = new URLSearchParams({ dealerId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await vpsAuthedFetch(`/api/financial-dashboard?${qs.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load financial dashboard");
    return r.json();
  },
};
