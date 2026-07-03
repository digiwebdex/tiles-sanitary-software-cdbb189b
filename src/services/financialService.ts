import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface ProfitLoss {
  period: { from: string | null; to: string | null };
  revenue: number;
  sales_returns: number;
  net_revenue: number;
  cogs: number;
  cogs_reversal?: number;
  net_cogs?: number;
  gross_profit: number;
  expenses_by_category: { category: string; amount: number }[];
  total_expenses: number;
  net_profit: number;
  /**
   * Track 1 Phase 1 transparency fields. Both are optional so older
   * backend builds (pre-hotfix) continue to deserialize without losing
   * any existing numeric fields.
   */
  data_source?: string;
  warnings?: string[];
}

export interface BalanceSheet {
  as_of: string | null;
  assets: {
    cash: number;
    bank_total: number;
    bank_accounts: { bank_account_id: string; bank_name: string; account_number: string; balance: number }[];
    inventory: number;
    accounts_receivable: number;
    total: number;
  };
  liabilities: { accounts_payable: number; total: number };
  equity: { director_capital?: number; retained_earnings?: number; owner_equity: number; total: number };
  warnings?: string[];
}

export interface TrialBalance {
  as_of: string | null;
  accounts: { account: string; debit: number; credit: number }[];
  total_debit: number;
  total_credit: number;
  difference: number;
  data_source?: "legacy_subledgers" | "gl_spine";
  warnings?: string[];
}

export interface JournalLine {
  id?: string;
  account: string;
  debit: number;
  credit: number;
  line_narration?: string | null;
}

export interface JournalEntry {
  id: string;
  voucher_no: string;
  entry_date: string;
  narration: string | null;
  total_debit?: number;
  total_credit?: number;
  lines?: JournalLine[];
  created_at?: string;
}

export const financialService = {
  async profitLoss(dealerId: string, from?: string, to?: string): Promise<ProfitLoss> {
    const qs = new URLSearchParams({ dealerId });
    if (from) qs.set("from", from); if (to) qs.set("to", to);
    const r = await vpsAuthedFetch(`/api/financials/p-and-l?${qs}`);
    if (!r.ok) throw new Error("Failed to load P&L");
    return r.json();
  },
  async balanceSheet(dealerId: string, asOf?: string): Promise<BalanceSheet> {
    const qs = new URLSearchParams({ dealerId });
    if (asOf) qs.set("asOf", asOf);
    const r = await vpsAuthedFetch(`/api/financials/balance-sheet?${qs}`);
    if (!r.ok) throw new Error("Failed to load balance sheet");
    return r.json();
  },
  async trialBalance(
    dealerId: string,
    asOf?: string,
    source?: "auto" | "gl" | "legacy",
  ): Promise<TrialBalance> {
    const qs = new URLSearchParams({ dealerId });
    if (asOf) qs.set("asOf", asOf);
    if (source) qs.set("source", source);
    const r = await vpsAuthedFetch(`/api/financials/trial-balance?${qs}`);
    if (!r.ok) throw new Error("Failed to load trial balance");
    return r.json();
  },
};

export const journalService = {
  async list(dealerId: string, opts: { from?: string; to?: string; limit?: number; offset?: number } = {}): Promise<{ rows: JournalEntry[]; total: number }> {
    const qs = new URLSearchParams({ dealerId });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    if (opts.limit != null) qs.set("limit", String(opts.limit));
    if (opts.offset != null) qs.set("offset", String(opts.offset));
    const r = await vpsAuthedFetch(`/api/journal?${qs}`);
    if (!r.ok) throw new Error("Failed to load journal");
    return r.json();
  },
  async get(dealerId: string, id: string): Promise<JournalEntry> {
    const r = await vpsAuthedFetch(`/api/journal/${id}?dealerId=${dealerId}`);
    if (!r.ok) throw new Error("Failed to load entry");
    return r.json();
  },
  async create(dealerId: string, payload: { entry_date: string; narration?: string; lines: JournalLine[] }): Promise<{ id: string; voucher_no: string }> {
    const r = await vpsAuthedFetch(`/api/journal?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to create entry"); }
    return r.json();
  },
  async remove(dealerId: string, id: string): Promise<void> {
    const r = await vpsAuthedFetch(`/api/journal/${id}?dealerId=${dealerId}`, { method: "DELETE" });
    if (!r.ok) throw new Error("Failed to delete entry");
  },
};
