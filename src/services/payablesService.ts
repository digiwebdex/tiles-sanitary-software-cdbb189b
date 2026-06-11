import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body as T;
}

export interface PayablePurchaseRow {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  supplier_id: string;
  total_amount: number;
  net_payable: number;
  paid_amount: number;
  due_amount: number;
  payment_status: string;
  suppliers: { id: string; name: string; phone?: string | null } | null;
}

export interface PayablesOutstandingSummary {
  source: "read_model";
  totalOutstanding: number;
  billLevelTotal: number;
  suppliers: Array<{ supplierId: string; name: string; outstanding: number }>;
}

export interface PayablesOutstandingResponse {
  rows: PayablePurchaseRow[];
  summary: PayablesOutstandingSummary;
}

export const payablesService = {
  async listOutstanding(dealerId: string): Promise<PayablesOutstandingResponse> {
    return vpsRequest<PayablesOutstandingResponse>(
      `/api/payables/outstanding?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  /** Pay supplier — allocates to oldest due purchase bills first (FIFO). */
  async recordPayment(
    dealerId: string,
    input: {
      supplier_id: string;
      amount: number;
      note?: string;
      paid_account_id?: string | null;
      purchase_id?: string;
    },
  ) {
    return await vpsRequest<{
      ok: boolean;
      allocations: Array<{
        purchaseId: string;
        invoiceNumber: string | null;
        amount: number;
        dueAfter: number;
        payment_status: string;
      }>;
      totalApplied: number;
    }>(`/api/payables/payment?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
