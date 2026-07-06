/**
 * supplierService — VPS-only (Phase 3U-17).
 *
 * All reads + writes flow through /api/suppliers on the self-hosted backend.
 * The legacy Supabase fallback was removed because production hosts
 * (sanitileserp.com + lovable previews) always resolve AUTH_BACKEND="vps".
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export interface Supplier {
  id: string;
  dealer_id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  opening_balance: number;
  status: string;
  created_at: string;
  // V2 Sprint 5A
  category: string | null;
  supplier_group: string | null;
  credit_limit: number;
}

export interface SupplierFormData {
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  gstin: string;
  opening_balance: number;
  status: "active" | "inactive";
  // V2 Sprint 5A
  category: string;
  supplier_group: string;
  credit_limit: number;
}

export interface SupplierLedgerEntry {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  entry_date: string;
  purchase_id: string | null;
  created_at: string;
}

export interface SupplierLedgerSummary {
  supplier: { id: string; name: string; opening_balance: number };
  outstanding: number;
  balance: number;
  total_purchased: number;
  total_paid: number;
  entries: SupplierLedgerEntry[];
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

function buildWritePayload(form: Partial<SupplierFormData>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (form.name !== undefined) payload.name = form.name.trim();
  if (form.contact_person !== undefined) payload.contact_person = form.contact_person.trim() || null;
  if (form.phone !== undefined) payload.phone = form.phone.trim() || null;
  if (form.email !== undefined) payload.email = form.email.trim() || null;
  if (form.address !== undefined) payload.address = form.address.trim() || null;
  if (form.gstin !== undefined) payload.gstin = form.gstin.trim() || null;
  if (form.opening_balance !== undefined) payload.opening_balance = form.opening_balance;
  if (form.status !== undefined) payload.status = form.status;
  if (form.category !== undefined) payload.category = form.category.trim() || null;
  if (form.supplier_group !== undefined) payload.supplier_group = form.supplier_group.trim() || null;
  if (form.credit_limit !== undefined) payload.credit_limit = form.credit_limit;
  return payload;
}

export const supplierService = {
  /**
   * `categoryFilter`/`groupFilter` are new in V2 Sprint 5A — both optional,
   * so every existing call site that only passes (dealerId, search, page)
   * behaves exactly as before.
   */
  async list(dealerId: string, search = "", page = 1, categoryFilter = "", groupFilter = "") {
    const trimmed = search.trim();
    const params = new URLSearchParams({
      dealerId,
      page: String(Math.max(0, page - 1)),
      pageSize: String(PAGE_SIZE),
      orderBy: "name",
      orderDir: "asc",
    });
    if (trimmed) params.set("search", trimmed);
    if (categoryFilter) params.set("f.category", categoryFilter);
    if (groupFilter) params.set("f.supplier_group", groupFilter);
    const body = await vpsRequest<{ rows: Supplier[]; total: number }>(
      `/api/suppliers?${params.toString()}`,
    );
    return { data: body.rows ?? [], total: body.total ?? 0 };
  },

  /** V2 Sprint 5A — Supplier Ledger Summary. */
  async getLedgerSummary(id: string): Promise<SupplierLedgerSummary> {
    return vpsRequest<SupplierLedgerSummary>(`/api/suppliers/${id}/ledger-summary`);
  },

  async getById(id: string) {
    const body = await vpsRequest<{ row: Supplier }>(`/api/suppliers/${id}`);
    if (!body.row) throw new Error("Supplier not found");
    return body.row;
  },

  async create(dealerId: string, form: SupplierFormData) {
    const body = await vpsRequest<{ row: Supplier }>(`/api/suppliers`, {
      method: "POST",
      body: JSON.stringify({ dealerId, data: buildWritePayload(form) }),
    });
    return body.row;
  },

  async update(id: string, form: Partial<SupplierFormData>) {
    const payload = buildWritePayload(form);
    // opening_balance is not editable post-creation (backend also enforces)
    delete payload.opening_balance;
    await vpsRequest(`/api/suppliers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: payload }),
    });
  },

  async toggleStatus(id: string, status: "active" | "inactive") {
    await vpsRequest(`/api/suppliers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { status } }),
    });
  },
};
