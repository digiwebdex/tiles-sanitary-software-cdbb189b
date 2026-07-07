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
  /** V2 Sprint 6E additions — all optional so pre-6E callers are unaffected. */
  cost_of_sales?: number;
  operating_expenses?: number;
  operating_profit?: number;
  other_income?: number;
  other_expenses?: number;
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
    /** V2 Sprint 6E additions. */
    fixed_assets_net?: number;
    current_assets?: number;
    non_current_assets?: number;
  };
  liabilities: {
    accounts_payable: number;
    total: number;
    /** V2 Sprint 6E additions. */
    vat_payable?: number;
    current_liabilities?: number;
    long_term_liabilities?: number;
  };
  equity: {
    director_capital?: number;
    retained_earnings?: number;
    owner_equity: number;
    total: number;
    /** V2 Sprint 6E addition — the figure actually posted by Fiscal Year Closing. */
    retained_earnings_from_closing?: number;
  };
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

/** V2 Sprint 6E — period/fiscal-year/branch-filtered Trial Balance, /api/gl/trial-balance. */
export interface AccountBalanceRow {
  source: "gl" | "journal";
  accountKey: string;
  accountLabel: string;
  accountType: string | null;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

export interface PeriodTrialBalance {
  gl_accounts: AccountBalanceRow[];
  journal_accounts: AccountBalanceRow[];
  totals: { opening_debit: number; opening_credit: number; period_debit: number; period_credit: number; closing_debit: number; closing_credit: number };
  gl_spine_enabled: boolean;
  from: string | null;
  to: string | null;
  branch_id: string | null;
  fiscal_year_id: string | null;
}

export interface JournalLine {
  id?: string;
  account: string;
  debit: number;
  credit: number;
  line_narration?: string | null;
}

/** V2 Sprint 6A — Draft/Approve/Post/Reverse workflow status. */
export type JournalEntryStatus = "draft" | "approved" | "posted";

export interface JournalEntry {
  id: string;
  voucher_no: string;
  entry_date: string;
  narration: string | null;
  total_debit?: number;
  total_credit?: number;
  lines?: JournalLine[];
  created_at?: string;
  /** V2 Sprint 6A additions — all optional so pre-6A callers are unaffected. */
  status?: JournalEntryStatus;
  posted_at?: string | null;
  approved_at?: string | null;
  reverses_journal_entry_id?: string | null;
  reversed_by_journal_entry_id?: string | null;
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
  async cashFlow(dealerId: string, from?: string, to?: string): Promise<CashFlow> {
    const qs = new URLSearchParams({ dealerId });
    if (from) qs.set("from", from); if (to) qs.set("to", to);
    const r = await vpsAuthedFetch(`/api/financials/cash-flow?${qs}`);
    if (!r.ok) throw new Error("Failed to load cash flow");
    return r.json();
  },
  /** V2 Sprint 6E — period/fiscal-year/branch-filtered Trial Balance (GL Spine, /api/gl/trial-balance). */
  async trialBalancePeriod(dealerId: string, opts: { from?: string; to?: string; fiscalYearId?: string; branchId?: string } = {}): Promise<PeriodTrialBalance> {
    const qs = new URLSearchParams({ dealerId });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    if (opts.fiscalYearId) qs.set("fiscalYearId", opts.fiscalYearId);
    if (opts.branchId) qs.set("branchId", opts.branchId);
    const r = await vpsAuthedFetch(`/api/gl/trial-balance?${qs}`);
    if (!r.ok) throw new Error("Failed to load trial balance");
    return r.json();
  },
};

export interface CashFlowActivity {
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashFlow {
  period: { from: string | null; to: string | null };
  opening_cash: number;
  inflows: { label: string; amount: number }[];
  outflows: { label: string; amount: number }[];
  total_in: number;
  total_out: number;
  net_cash_flow: number;
  closing_cash: number;
  /** V2 Sprint 6E additions. */
  operating_activities?: CashFlowActivity;
  investing_activities?: CashFlowActivity;
  financing_activities?: CashFlowActivity;
  internal_transfers?: number;
  net_cash_flow_classified?: number;
}

export const journalService = {
  async list(dealerId: string, opts: { from?: string; to?: string; limit?: number; offset?: number; status?: JournalEntryStatus } = {}): Promise<{ rows: JournalEntry[]; total: number }> {
    const qs = new URLSearchParams({ dealerId });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    if (opts.limit != null) qs.set("limit", String(opts.limit));
    if (opts.offset != null) qs.set("offset", String(opts.offset));
    if (opts.status) qs.set("status", opts.status);
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
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to delete entry"); }
  },
  // ── V2 Sprint 6A — Draft / Approve / Post / Reverse workflow ──
  async createDraft(dealerId: string, payload: { entry_date: string; narration?: string; lines: JournalLine[] }): Promise<{ id: string; voucher_no: string }> {
    const r = await vpsAuthedFetch(`/api/journal/draft?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to save draft"); }
    return r.json();
  },
  async approve(dealerId: string, id: string): Promise<JournalEntry> {
    const r = await vpsAuthedFetch(`/api/journal/${id}/approve?dealerId=${dealerId}`, { method: "POST" });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to approve entry"); }
    return r.json();
  },
  async post(dealerId: string, id: string): Promise<JournalEntry> {
    const r = await vpsAuthedFetch(`/api/journal/${id}/post?dealerId=${dealerId}`, { method: "POST" });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to post entry"); }
    return r.json();
  },
  async reverse(dealerId: string, id: string, opts: { entry_date?: string; narration?: string } = {}): Promise<{ original_id: string; reversal: { id: string; voucher_no: string } }> {
    const r = await vpsAuthedFetch(`/api/journal/${id}/reverse?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to reverse entry"); }
    return r.json();
  },
};
