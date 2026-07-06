/**
 * collectionsService — VPS-backed aggregation client for the Collection Tracker.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface CustomerOutstandingDTO {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  outstanding: number;
  last_payment_date: string | null;
  total_sales: number;
  total_paid: number;
  invoices: { invoice_number: string; sale_id: string; sale_date: string }[];
  oldestSaleDate: string | null;
  daysOverdue: number;
  agingBucket: string;
  lastFollowupDate: string | null;
  lastFollowupStatus: string | null;
  maxOverdueDays: number;
}

export interface RecentCollectionDTO {
  id: string;
  customer_name: string;
  amount: number;
  description: string | null;
  entry_date: string;
  created_at: string;
}

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body as T;
}

export const collectionsService = {
  async listOutstanding(dealerId: string): Promise<CustomerOutstandingDTO[]> {
    const body = await vpsRequest<{ customers: CustomerOutstandingDTO[] }>(
      `/api/collections/outstanding?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return body.customers ?? [];
  },

  /** V2 Sprint 4A — Customer Profile "ledger summary": one customer's outstanding/aging, regardless of balance. */
  async getCustomerOutstanding(dealerId: string, customerId: string): Promise<CustomerOutstandingDTO | null> {
    const body = await vpsRequest<{ customers: CustomerOutstandingDTO[] }>(
      `/api/collections/outstanding?dealerId=${encodeURIComponent(dealerId)}&customerId=${encodeURIComponent(customerId)}`,
    );
    return body.customers?.[0] ?? null;
  },

  async listRecent(dealerId: string, limit = 20): Promise<RecentCollectionDTO[]> {
    const body = await vpsRequest<{ rows: RecentCollectionDTO[] }>(
      `/api/collections/recent?dealerId=${encodeURIComponent(dealerId)}&limit=${limit}`,
    );
    return body.rows ?? [];
  },

  /** Record payment against oldest due invoices (FIFO) for a customer. */
  async recordPayment(
    dealerId: string,
    input: {
      customer_id: string;
      amount: number;
      note?: string;
      payment_mode?: string;
      paid_account_id?: string | null;
    },
  ) {
    return await vpsRequest<{
      ok: boolean;
      allocations: Array<{ saleId: string; invoiceNumber: string | null; amount: number }>;
      totalApplied: number;
    }>(`/api/collections/payment?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  /** V2 Sprint 4A — "Collection Adjustment": manual signed ledger entry outside the normal payment flow. */
  async recordAdjustment(
    dealerId: string,
    input: { customer_id: string; amount: number; reason: string },
  ) {
    return await vpsRequest<{ row: unknown }>(
      `/api/collections/adjustment?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
  },

  /** V2 Sprint 4C — "Advance Payment": record a payment with no invoice attached yet. */
  async recordAdvance(
    dealerId: string,
    input: { customer_id: string; amount: number; note?: string; payment_mode?: string; paid_account_id?: string | null },
  ) {
    return await vpsRequest<{ ok: boolean; id: string; amount: number }>(
      `/api/collections/advance?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
  },

  async getAdvanceBalance(dealerId: string, customerId: string): Promise<number> {
    const body = await vpsRequest<{ balance: number }>(
      `/api/collections/advance-balance?dealerId=${encodeURIComponent(dealerId)}&customerId=${encodeURIComponent(customerId)}`,
    );
    return body.balance ?? 0;
  },

  /** V2 Sprint 4C — apply previously-received advance credit to a specific invoice. */
  async applyAdvance(
    dealerId: string,
    input: { customer_id: string; sale_id: string; amount: number },
  ) {
    return await vpsRequest<{ ok: boolean; newDue: number }>(
      `/api/collections/advance/apply?dealerId=${encodeURIComponent(dealerId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    );
  },
};
