/**
 * financialClosingService — V2 Sprint 6E.
 * Wraps /api/financial-closing (Fiscal Year Closing readiness/action/journal view).
 * Period Closing itself uses fiscalYearService.ts's existing closePeriod/reopenPeriod.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface FiscalYearReadiness {
  fiscal_year: { id: string; name: string; status: "open" | "closed"; start_date: string; end_date: string };
  ready: boolean;
  open_periods: { id: string; period_no: number; start_date: string; end_date: string }[];
  blocking_earlier_fiscal_year: { id: string; name: string } | null;
}

export interface CloseFiscalYearResult {
  fiscalYearId: string;
  closingJournalEntryId: string | null;
  netIncomeClosedToRetainedEarnings: number;
  accountsClosedCount: number;
}

export interface ClosingJournalLine {
  account: string;
  debit: number;
  credit: number;
  line_narration: string | null;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const financialClosingService = {
  async readiness(dealerId: string, fiscalYearId: string): Promise<FiscalYearReadiness> {
    const r = await vpsAuthedFetch(`/api/financial-closing/fiscal-years/${fiscalYearId}/readiness?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load fiscal year readiness");
    return r.json();
  },
  async close(dealerId: string, fiscalYearId: string): Promise<CloseFiscalYearResult> {
    const r = await vpsAuthedFetch(`/api/financial-closing/fiscal-years/${fiscalYearId}/close?dealerId=${dealerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerId }),
    });
    if (!r.ok) return parseError(r, "Failed to close fiscal year");
    return r.json();
  },
  async closingJournal(dealerId: string, fiscalYearId: string): Promise<{ journal: { id: string; voucher_no: string; entry_date: string; narration: string | null } | null; lines: ClosingJournalLine[] }> {
    const r = await vpsAuthedFetch(`/api/financial-closing/fiscal-years/${fiscalYearId}/closing-journal?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load closing journal");
    return r.json();
  },
};
