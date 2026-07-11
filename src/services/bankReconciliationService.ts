/**
 * bankReconciliationService — V2 Sprint 6C.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface StatementLine {
  id: string;
  bank_account_id: string;
  entry_date: string;
  description: string | null;
  amount: number;
  reference: string | null;
  source: "csv" | "manual";
  status: "unmatched" | "matched" | "ignored";
  matched_bank_ledger_id: string | null;
}

export interface LedgerRow {
  id: string;
  amount: number;
  description: string | null;
  entry_date: string;
  type: string;
  cheque_no?: string | null;
}

export interface ReconciliationSummary {
  as_of: string | null;
  book_balance: number;
  cleared_balance: number;
  outstanding_deposits: number;
  outstanding_cheques: number;
  unmatched_statement_line_count: number;
  difference: number;
}

export const bankReconciliationService = {
  async importCsv(dealerId: string, bankAccountId: string, csvText: string): Promise<{ imported: number; skipped: number }> {
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/${bankAccountId}/import?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Import failed"); }
    return r.json();
  },
  async addManualLine(dealerId: string, bankAccountId: string, data: { entry_date: string; description: string; amount: number; reference?: string }): Promise<{ row: StatementLine }> {
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/${bankAccountId}/manual-line?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to add statement line"); }
    return r.json();
  },
  async getMatching(dealerId: string, bankAccountId: string): Promise<{ unmatched_statement_lines: StatementLine[]; unmatched_ledger_rows: LedgerRow[]; matched: any[] }> {
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/${bankAccountId}?dealerId=${encodeURIComponent(dealerId)}`);
    if (!r.ok) throw new Error("Failed to load reconciliation data");
    return r.json();
  },
  async match(dealerId: string, statementLineId: string, bankLedgerId: string) {
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/match?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement_line_id: statementLineId, bank_ledger_id: bankLedgerId }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Match failed"); }
    return r.json();
  },
  async unmatch(dealerId: string, statementLineId: string) {
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/unmatch?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement_line_id: statementLineId }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Unmatch failed"); }
    return r.json();
  },
  async summary(dealerId: string, bankAccountId: string, asOf?: string): Promise<ReconciliationSummary> {
    const qs = new URLSearchParams({ dealerId });
    if (asOf) qs.set("asOf", asOf);
    const r = await vpsAuthedFetch(`/api/bank-reconciliation/${bankAccountId}/summary?${qs}`);
    if (!r.ok) throw new Error("Failed to load reconciliation summary");
    return r.json();
  },
};
