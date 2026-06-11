import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface CashbookRow {
  id: string;
  entry_date: string;
  type: string;
  amount: number;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  account_kind: "cash" | "bank";
  bank_account_id: string | null;
  payment_mode: string | null;
  running_balance: number;
}

export interface CashbookResponse {
  opening: number;
  closing: number;
  rows: CashbookRow[];
  summary: Record<string, { in: number; out: number }>;
  filters: { from: string | null; to: string | null; account: string; bankAccountId: string | null };
}

export const cashbookService = {
  async fetch(dealerId: string, params: { from?: string; to?: string; account?: "cash" | "bank" | "all"; bankAccountId?: string } = {}): Promise<CashbookResponse> {
    const qs = new URLSearchParams({ dealerId });
    Object.entries(params).forEach(([k, v]) => { if (v != null) qs.set(k, String(v)); });
    const r = await vpsAuthedFetch(`/api/cashbook?${qs}`);
    if (!r.ok) throw new Error((await r.json()).error || "Failed to load cashbook");
    return r.json();
  },
};
