/**
 * generalLedgerService — V2 Sprint 6E.
 * Wraps /api/general-ledger (account picker, drill-down, CSV export).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface LedgerAccountOption {
  source: "gl" | "journal";
  accountKey: string;
  accountLabel: string;
  accountType: string | null;
}

export interface LedgerTransaction {
  source: "gl" | "journal";
  date: string;
  debit: number;
  credit: number;
  description: string | null;
  documentType: string | null;
  documentId: string | null;
  journalEntryId: string | null;
  voucherNo: string | null;
  postingBatchId: string | null;
  runningBalance: number;
}

export interface AccountLedgerResult {
  accountKey: string;
  accountLabel: string;
  openingBalance: number;
  transactions: LedgerTransaction[];
  closingBalance: number;
}

async function parseError(r: Response, fallback: string): Promise<never> {
  const body = await r.json().catch(() => ({}));
  throw new Error(body.error || fallback);
}

export const generalLedgerService = {
  async accounts(dealerId: string): Promise<{ gl_accounts: LedgerAccountOption[]; journal_accounts: LedgerAccountOption[] }> {
    const r = await vpsAuthedFetch(`/api/general-ledger/accounts?dealerId=${dealerId}`);
    if (!r.ok) return parseError(r, "Failed to load account list");
    return r.json();
  },
  async ledger(dealerId: string, source: "gl" | "journal", account: string, opts: { from?: string; to?: string; branchId?: string } = {}): Promise<AccountLedgerResult> {
    const qs = new URLSearchParams({ dealerId, source, account });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    if (opts.branchId) qs.set("branchId", opts.branchId);
    const r = await vpsAuthedFetch(`/api/general-ledger/ledger?${qs.toString()}`);
    if (!r.ok) return parseError(r, "Failed to load account ledger");
    return r.json();
  },
  /** Fetches the CSV (auth headers required) and triggers a browser download. */
  async downloadCsv(dealerId: string, source: "gl" | "journal", account: string, opts: { from?: string; to?: string; branchId?: string } = {}): Promise<void> {
    const qs = new URLSearchParams({ dealerId, source, account });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    if (opts.branchId) qs.set("branchId", opts.branchId);
    const r = await vpsAuthedFetch(`/api/general-ledger/ledger/export.csv?${qs.toString()}`);
    if (!r.ok) return parseError(r, "Failed to export ledger");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger_${source}_${account.replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
