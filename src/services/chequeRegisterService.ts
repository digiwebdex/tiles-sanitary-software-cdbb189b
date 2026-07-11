/**
 * chequeRegisterService — V2 Sprint 6C.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type ChequeStatus = "issued" | "presented" | "cleared" | "bounced" | "cancelled";

export interface ChequeRow {
  id: string;
  bank_account_id: string;
  cheque_no: string;
  cheque_status: ChequeStatus;
  amount: number;
  description: string | null;
  entry_date: string;
  is_cleared: boolean;
  cleared_at: string | null;
  bank_name: string | null;
  account_number: string | null;
}

export const chequeRegisterService = {
  async list(dealerId: string, opts: { bankAccountId?: string; status?: ChequeStatus } = {}): Promise<{ rows: ChequeRow[] }> {
    const qs = new URLSearchParams({ dealerId });
    if (opts.bankAccountId) qs.set("bankAccountId", opts.bankAccountId);
    if (opts.status) qs.set("status", opts.status);
    const r = await vpsAuthedFetch(`/api/cheque-register?${qs}`);
    if (!r.ok) throw new Error("Failed to load cheque register");
    return r.json();
  },
  async updateStatus(dealerId: string, bankLedgerId: string, status: ChequeStatus): Promise<{ row: ChequeRow }> {
    const r = await vpsAuthedFetch(`/api/cheque-register/${bankLedgerId}/status?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || "Failed to update cheque status");
    }
    return r.json();
  },
};
