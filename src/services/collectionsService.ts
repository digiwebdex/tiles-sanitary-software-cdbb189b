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
};
