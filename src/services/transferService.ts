/**
 * transferService — V2 Sprint 6C. Cash<->Bank and Bank<->Bank transfers.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type TransferEndpoint = { kind: "cash" } | { kind: "bank"; bank_account_id: string };

export interface TransferInput {
  from: TransferEndpoint;
  to: TransferEndpoint;
  amount: number;
  description: string;
  entry_date?: string;
}

export interface TransferResult {
  ledgerRowIds: string[];
  batchId: string | null;
}

export interface TransferLeg {
  id: string;
  amount: number;
  description: string | null;
  entry_date: string;
  reference_id: string | null;
  leg_kind: "cash" | "bank";
  bank_account_id?: string;
}

export const transferService = {
  async create(dealerId: string, data: TransferInput): Promise<TransferResult> {
    const r = await vpsAuthedFetch(`/api/transfers?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || "Failed to record transfer");
    }
    return r.json();
  },
  async list(dealerId: string, opts: { from?: string; to?: string } = {}): Promise<{ rows: Array<{ outLeg: TransferLeg; inLeg: TransferLeg }> }> {
    const qs = new URLSearchParams({ dealerId });
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    const r = await vpsAuthedFetch(`/api/transfers?${qs}`);
    if (!r.ok) throw new Error("Failed to load transfers");
    return r.json();
  },
};
