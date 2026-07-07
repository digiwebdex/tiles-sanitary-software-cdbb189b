import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface FiscalYear {
  id: string;
  dealer_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  opening_balance_journal_id: string | null;
  created_at?: string;
}

export type PeriodStatus = "open" | "closed";

export interface AccountingPeriod {
  id: string;
  dealer_id: string;
  fiscal_year_id: string;
  period_no: number;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const fiscalYearService = {
  async list(dealerId: string): Promise<{ rows: FiscalYear[] }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load fiscal years");
    return r.json();
  },
  async current(dealerId: string): Promise<{ row: FiscalYear | null }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/current?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load current fiscal year");
    return r.json();
  },
  async create(dealerId: string, payload: { name: string; start_date: string; end_date: string; set_as_current?: boolean }): Promise<{ row: FiscalYear }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId, ...payload }),
    });
    if (!r.ok) return parseError(r, "Failed to create fiscal year");
    return r.json();
  },
  async setCurrent(dealerId: string, id: string): Promise<{ row: FiscalYear }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/${id}/set-current?dealerId=${dealerId}`, { method: "POST" });
    if (!r.ok) return parseError(r, "Failed to set current fiscal year");
    return r.json();
  },
  async setOpeningBalanceJournal(dealerId: string, id: string, journalEntryId: string): Promise<{ row: FiscalYear }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/${id}/set-opening-balance-journal?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journal_entry_id: journalEntryId }),
    });
    if (!r.ok) return parseError(r, "Failed to link opening balance journal entry");
    return r.json();
  },
  async periods(dealerId: string, fiscalYearId: string): Promise<{ rows: AccountingPeriod[] }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/${fiscalYearId}/periods?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load accounting periods");
    return r.json();
  },
  async closePeriod(dealerId: string, fiscalYearId: string, periodId: string): Promise<{ row: AccountingPeriod }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/${fiscalYearId}/periods/${periodId}/close?dealerId=${dealerId}`, { method: "POST" });
    if (!r.ok) return parseError(r, "Failed to close period");
    return r.json();
  },
  async reopenPeriod(dealerId: string, fiscalYearId: string, periodId: string, reason: string): Promise<{ row: AccountingPeriod }> {
    const r = await vpsAuthedFetch(`/api/fiscal-years/${fiscalYearId}/periods/${periodId}/reopen?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) return parseError(r, "Failed to reopen period");
    return r.json();
  },
};
