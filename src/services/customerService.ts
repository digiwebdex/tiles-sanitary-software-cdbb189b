/**
 * customerService — VPS-only (Phase 3U-17).
 *
 * All reads + writes flow through /api/customers on the self-hosted backend.
 * Due balance reads through /api/ledger/customers/due-balance.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type CustomerType = "retailer" | "customer" | "project";

export interface Customer {
  id: string;
  dealer_id: string;
  name: string;
  type: CustomerType;
  phone: string | null;
  email: string | null;
  address: string | null;
  reference_name: string | null;
  opening_balance: number;
  status: string;
  created_at: string;
  credit_limit: number;
  max_overdue_days: number;
  price_tier_id: string | null;
  tax_id: string | null;
}

export interface CustomerWithBalance extends Customer {
  due_balance: number;
}

export interface CustomerFormData {
  name: string;
  type: CustomerType;
  phone: string;
  email: string;
  address: string;
  reference_name: string;
  opening_balance: number;
  status: "active" | "inactive";
  credit_limit: number;
  max_overdue_days: number;
  price_tier_id: string | null;
  tax_id: string;
}

const PAGE_SIZE = 25;

async function vpsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = (body as any)?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

function buildWritePayload(form: Partial<CustomerFormData>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (form.name !== undefined) payload.name = form.name.trim();
  if (form.type !== undefined) payload.type = form.type;
  if (form.phone !== undefined) payload.phone = form.phone.trim() || null;
  if (form.email !== undefined) payload.email = form.email.trim() || null;
  if (form.address !== undefined) payload.address = form.address.trim() || null;
  if (form.reference_name !== undefined)
    payload.reference_name = form.reference_name.trim() || null;
  if (form.opening_balance !== undefined) payload.opening_balance = form.opening_balance;
  if (form.status !== undefined) payload.status = form.status;
  if (form.credit_limit !== undefined) payload.credit_limit = form.credit_limit;
  if (form.max_overdue_days !== undefined) payload.max_overdue_days = form.max_overdue_days;
  if (form.price_tier_id !== undefined) payload.price_tier_id = form.price_tier_id;
  if (form.tax_id !== undefined) payload.tax_id = form.tax_id.trim() || null;
  return payload;
}

export const customerService = {
  async list(dealerId: string, search = "", typeFilter = "", page = 1) {
    const trimmed = search.trim();
    const params = new URLSearchParams({
      dealerId,
      page: String(Math.max(0, page - 1)),
      pageSize: String(PAGE_SIZE),
      orderBy: "name",
      orderDir: "asc",
    });
    if (trimmed) params.set("search", trimmed);
    if (typeFilter) params.set("f.type", typeFilter);
    const body = await vpsRequest<{ rows: Customer[]; total: number }>(
      `/api/customers?${params.toString()}`,
    );
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  async getById(id: string) {
    const body = await vpsRequest<{ row: Customer }>(`/api/customers/${id}`);
    if (!body.row) throw new Error("Customer not found");
    return body.row;
  },

  async getDueBalance(customerId: string, dealerId: string): Promise<number> {
    const body = await vpsRequest<{ balance: number }>(
      `/api/ledger/customers/due-balance/${customerId}?dealerId=${dealerId}`,
    );
    return Number(body.balance ?? 0);
  },

  async create(dealerId: string, form: CustomerFormData) {
    const body = await vpsRequest<{ row: Customer }>(`/api/customers`, {
      method: "POST",
      body: JSON.stringify({ dealerId, data: buildWritePayload(form) }),
    });
    return body.row;
  },

  async update(id: string, form: Partial<CustomerFormData>) {
    const payload = buildWritePayload(form);
    // opening_balance is not editable post-creation (backend also enforces)
    delete payload.opening_balance;
    await vpsRequest(`/api/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: payload }),
    });
  },

  async toggleStatus(id: string, status: "active" | "inactive") {
    await vpsRequest(`/api/customers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { status } }),
    });
  },
};
