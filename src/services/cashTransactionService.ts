/**
 * cashTransactionService — V2 Sprint 6C.
 * Wraps the Cashbook's new write endpoints (POST /api/cashbook/receipt|payment).
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface CashBankTxResult {
  ledgerRowIds: string[];
  batchId: string | null;
}

export interface CashMovementInput {
  amount: number;
  description: string;
  entry_date?: string;
  payment_mode?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
}

async function post(path: string, dealerId: string, data: CashMovementInput): Promise<CashBankTxResult> {
  const r = await vpsAuthedFetch(`${path}?dealerId=${encodeURIComponent(dealerId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "Failed to record transaction");
  }
  return r.json();
}

export const cashTransactionService = {
  recordReceipt(dealerId: string, data: CashMovementInput) {
    return post("/api/cashbook/receipt", dealerId, data);
  },
  recordPayment(dealerId: string, data: CashMovementInput) {
    return post("/api/cashbook/payment", dealerId, data);
  },
};
