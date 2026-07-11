import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type GlAccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type NormalBalance = "debit" | "credit";

export interface GlAccount {
  id: string;
  dealer_id: string;
  code: string;
  name: string;
  account_type: GlAccountType;
  parent_code: string | null;
  normal_balance: NormalBalance;
  is_contra: boolean;
  is_group: boolean;
  category: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at?: string;
}

export interface NewGlAccountInput {
  code: string;
  name: string;
  account_type: GlAccountType;
  parent_code?: string | null;
  normal_balance?: NormalBalance;
  is_contra?: boolean;
  is_group?: boolean;
  category?: string | null;
}

export interface GlAccountUpdateInput {
  name?: string;
  parent_code?: string | null;
  category?: string | null;
  is_active?: boolean;
  is_contra?: boolean;
  is_group?: boolean;
  normal_balance?: NormalBalance;
}

export interface ConsistencyCheckResult {
  checked_at: string;
  unbalanced_count: number;
  unbalanced: { journal_entry_id: string; total_debit: number; total_credit: number; difference: number }[];
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const glAccountService = {
  async list(dealerId: string): Promise<{ rows: GlAccount[]; gl_spine_enabled: boolean; posting_engine_enabled: boolean }> {
    const r = await vpsAuthedFetch(`/api/gl/accounts?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load chart of accounts");
    return r.json();
  },
  async create(dealerId: string, payload: NewGlAccountInput): Promise<{ row: GlAccount }> {
    const r = await vpsAuthedFetch(`/api/gl/accounts?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create account");
    return r.json();
  },
  async update(dealerId: string, id: string, payload: GlAccountUpdateInput): Promise<{ row: GlAccount }> {
    const r = await vpsAuthedFetch(`/api/gl/accounts/${id}?dealerId=${dealerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to update account");
    return r.json();
  },
  async seedDefaults(dealerId: string): Promise<{ success: true; count: number; rows: GlAccount[] }> {
    const r = await vpsAuthedFetch(`/api/gl/accounts/seed?dealerId=${dealerId}`, { method: "POST" });
    if (!r.ok) return parseError(r, "Failed to seed default chart");
    return r.json();
  },
  async consistencyCheck(dealerId: string): Promise<ConsistencyCheckResult> {
    const r = await vpsAuthedFetch(`/api/gl/consistency-check?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to run consistency check");
    return r.json();
  },
};
