/**
 * supplierAgingService — V2 Sprint 5D (Accounts Payable Aging).
 * VPS-backed via /api/supplier-aging.
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

export interface AgingBuckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
  total: number;
}

export interface SupplierAgingBill {
  id: string;
  invoice_number: string | null;
  purchase_date: string;
  due_amount: number;
  days: number;
}

export interface SupplierAgingRow {
  supplier_id: string;
  supplier_name: string;
  buckets: AgingBuckets;
  due_today: number;
  due_this_week: number;
  due_this_month: number;
  bills: SupplierAgingBill[];
}

export interface SupplierAgingResponse {
  summary: {
    total_outstanding: number;
    due_today: number;
    due_this_week: number;
    due_this_month: number;
    buckets: AgingBuckets;
  };
  suppliers: SupplierAgingRow[];
}

export const supplierAgingService = {
  async get(dealerId: string) {
    return vpsRequest<SupplierAgingResponse>(`/api/supplier-aging?dealerId=${encodeURIComponent(dealerId)}`);
  },
};
