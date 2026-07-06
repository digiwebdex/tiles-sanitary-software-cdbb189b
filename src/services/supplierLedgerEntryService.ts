/**
 * supplierLedgerEntryService — V2 Sprint 5D (Purchase Invoice / Supplier Ledger).
 * VPS-backed via /api/supplier-ledger-entries.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const supplierLedgerEntryService = {
  async recordAdvancePayment(
    dealerId: string,
    input: { supplier_id: string; amount: number; note?: string | null; paid_account_id?: string | null; entry_date?: string },
  ) {
    await vpsRequest<{ ok: true }>(`/api/supplier-ledger-entries/advance-payment?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async recordCreditNote(
    dealerId: string,
    input: { supplier_id: string; amount: number; reason: string; entry_date?: string },
  ) {
    const body = await vpsRequest<{ row: any }>(`/api/supplier-ledger-entries/credit-note?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.row;
  },

  async recordDebitNote(
    dealerId: string,
    input: { supplier_id: string; amount: number; reason: string; entry_date?: string },
  ) {
    const body = await vpsRequest<{ row: any }>(`/api/supplier-ledger-entries/debit-note?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.row;
  },
};
