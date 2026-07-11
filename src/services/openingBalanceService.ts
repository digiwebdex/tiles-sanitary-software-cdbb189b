/**
 * openingBalancePosting — V2 Sprint 6B.
 * Explicit, idempotent action to mirror a customer's/supplier's
 * `opening_balance` (set once at creation, never edited) into the ledger
 * and GL — see backend/src/services/accounting/openingBalancePosting.ts.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface OpeningBalancePostResult {
  posted: boolean;
  ledgerRowId?: string;
  batchId?: string | null;
}

async function post(path: string, dealerId: string): Promise<OpeningBalancePostResult> {
  const r = await vpsAuthedFetch(`${path}?dealerId=${encodeURIComponent(dealerId)}`, { method: "POST" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "Failed to post opening balance");
  }
  return r.json();
}

export const openingBalanceService = {
  postCustomer(dealerId: string, customerId: string) {
    return post(`/api/opening-balance/customers/${customerId}/post`, dealerId);
  },
  postSupplier(dealerId: string, supplierId: string) {
    return post(`/api/opening-balance/suppliers/${supplierId}/post`, dealerId);
  },
};
