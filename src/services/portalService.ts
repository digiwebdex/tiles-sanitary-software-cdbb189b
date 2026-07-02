import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import { portalVpsJson } from "@/lib/portalVpsClient";

const usePortalVps = () => true;
const useDealerVps = () => true;

async function dealerVpsJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export type PortalRole = "contractor" | "architect" | "project_customer";
export type PortalStatus = "invited" | "active" | "inactive" | "revoked";

export interface PortalUser {
  id: string;
  dealer_id: string;
  customer_id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  phone: string | null;
  portal_role: PortalRole;
  status: PortalStatus;
  invited_at: string;
  activated_at: string | null;
  last_login_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalContext {
  dealer_id: string;
  customer_id: string;
  portal_user_id: string;
  name?: string;
  email?: string;
  portal_role?: PortalRole;
  phone?: string | null;
  status?: PortalStatus;
  last_login_at?: string | null;
}

export interface OutstandingSummary {
  outstanding: number;
  total_billed: number;
  total_paid: number;
  last_payment_date: string | null;
  last_payment_amount: number | null;
}

export interface RecentPayment {
  entry_date: string;
  amount: number;
  description: string | null;
  sale_id: string | null;
}

export interface LedgerHistoryRow {
  entry_date: string;
  entry_type: string;
  amount: number;
  description: string | null;
  reference_no: string | null;
  sale_id: string | null;
}

// ---------- Admin (dealer_admin) operations ----------

export async function listPortalUsers(dealerId: string): Promise<PortalUser[]> {
  if (useDealerVps()) {
    const body = await dealerVpsJson<{ rows: PortalUser[] }>(
      `/api/portal/users?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return body.rows ?? [];
  }
  const { data, error } = await supabase
    .from("portal_users")
    .select("*")
    .eq("dealer_id", dealerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalUser[];
}

export async function invitePortalUser(payload: {
  customer_id: string;
  email: string;
  name: string;
  phone?: string;
  portal_role?: PortalRole;
  send_magic_link?: boolean;
}) {
  if (useDealerVps()) {
    const body = await dealerVpsJson<{
      success: boolean;
      portal_user: PortalUser;
      magic_link: string | null;
      temp_password?: string | null;
    }>("/api/portal/users/invite", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      success: body.success,
      portal_user: body.portal_user,
      magic_link: body.magic_link ?? body.temp_password ?? null,
    };
  }
  if (error) throw error;
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as {
    success: boolean;
    portal_user: PortalUser;
    magic_link: string | null;
  };
}

export async function setPortalUserStatus(id: string, status: PortalStatus) {
  if (useDealerVps()) {
    await dealerVpsJson(`/api/portal/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return;
  }
  const { error } = await supabase
    .from("portal_users")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

// ---------- Portal-side (logged-in portal user) ----------

export async function getPortalContext(): Promise<PortalContext | null> {
  if (usePortalVps()) {
    try {
      const body = await portalVpsJson<PortalContext & { portal_user_id?: string }>(
        "/api/portal/context",
      );
      return {
        dealer_id: body.dealer_id,
        customer_id: body.customer_id,
        portal_user_id: body.portal_user_id ?? "",
        name: body.name,
        email: body.email,
        portal_role: body.portal_role,
      };
    } catch {
      return null;
    }
  }
  if (error) {
    console.warn("get_portal_context error:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.customer_id) return null;
  return row as PortalContext;
}

export async function bindAuthUser() {
  if (usePortalVps()) {
    try {
      await portalVpsJson("/api/portal/bind", { method: "POST" });
    } catch (e) {
      console.warn("portal bind error:", (e as Error).message);
    }
    return;
  }
  if (error) console.warn("portal_bind_auth_user error:", error.message);
}

export async function touchLastLogin() {
  if (usePortalVps()) {
    try {
      await portalVpsJson("/api/portal/touch-login", { method: "POST" });
    } catch (e) {
      console.warn("portal touch-login error:", (e as Error).message);
    }
    return;
  }
  if (error) console.warn("portal_touch_last_login error:", error.message);
}

export async function getOutstandingSummary(): Promise<OutstandingSummary | null> {
  if (usePortalVps()) {
    try {
      return await portalVpsJson<OutstandingSummary>("/api/portal/outstanding");
    } catch {
      return null;
    }
  }
  if (error) {
    console.warn("outstanding summary error:", error.message);
    return null;
  }
  const obj = data as unknown as { error?: string } & OutstandingSummary;
  if (obj?.error) return null;
  return obj;
}

export async function getRecentPayments(limit = 10): Promise<RecentPayment[]> {
  if (usePortalVps()) {
    try {
      const body = await portalVpsJson<{ rows: RecentPayment[] }>(
        `/api/portal/payments/recent?limit=${limit}`,
      );
      return body.rows ?? [];
    } catch {
      return [];
    }
  }
  if (error) {
    console.warn("recent payments error:", error.message);
    return [];
  }
  return (data ?? []) as RecentPayment[];
}

export async function getLedgerHistory(limit = 30): Promise<LedgerHistoryRow[]> {
  if (usePortalVps()) {
    try {
      const body = await portalVpsJson<{ rows: LedgerHistoryRow[] }>(
        `/api/portal/ledger?limit=${limit}`,
      );
      return body.rows ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---------- Project detail (Batch 2) ----------

export interface PortalProjectSummary {
  project: {
    id: string;
    project_code: string;
    project_name: string;
    status: string;
    start_date: string | null;
    expected_end_date: string | null;
    notes: string | null;
  };
  sites: Array<{
    id: string;
    site_name: string;
    address: string | null;
    status: string;
  }>;
  quotations: Array<{
    id: string;
    quotation_no: string;
    revision_no: number;
    quote_date: string;
    status: string;
    total_amount: number;
  }>;
  sales: Array<{
    id: string;
    invoice_number: string | null;
    sale_date: string;
    sale_status: string;
    total_amount: number;
    paid_amount: number;
    due_amount: number;
  }>;
  deliveries: Array<{
    id: string;
    delivery_no: string | null;
    delivery_date: string;
    status: string | null;
    sale_id: string | null;
    invoice_number: string | null;
  }>;
  items: Array<{
    product_id: string;
    product_name: string;
    product_sku: string;
    unit_type: string;
    ordered_qty: number;
    delivered_qty: number;
    pending_qty: number;
  }>;
}

export async function getPortalProjectSummary(
  projectId: string,
): Promise<PortalProjectSummary | { error: string } | null> {
  if (usePortalVps()) {
    try {
      return await portalVpsJson<PortalProjectSummary>(
        `/api/portal/projects/${projectId}/summary`,
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("not_found") || msg.includes("404")) return { error: "not_found" };
      return null;
    }
  }
  return null;
}

// ---------- Portal data fetchers (RLS-scoped) ----------

export interface PortalQuotationListItem {
  id: string;
  quotation_no: string;
  revision_no: number;
  quote_date: string;
  valid_until: string | null;
  status: string;
  total_amount: number;
}

export async function listPortalQuotations(
  customerId: string,
): Promise<PortalQuotationListItem[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalQuotationListItem[] }>(
      "/api/portal/quotations",
    );
    return body.rows ?? [];
  }
  const { data, error } = await supabase
    .from("quotations")
    .select(
      "id, quotation_no, revision_no, quote_date, valid_until, status, total_amount"
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalQuotationListItem[];
}

export interface PortalSale {
  id: string;
  invoice_number: string | null;
  sale_date: string;
  sale_status: string;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
}

export async function listPortalSales(customerId: string): Promise<PortalSale[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalSale[] }>("/api/portal/sales");
    return body.rows ?? [];
  }
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, invoice_number, sale_date, sale_status, total_amount, paid_amount, due_amount"
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalSale[];
}

export interface PortalDelivery {
  id: string;
  delivery_no: string | null;
  delivery_date: string;
  status: string | null;
  sale_id: string | null;
  challan_id: string | null;
  receiver_name: string | null;
  delivery_address: string | null;
  notes: string | null;
  invoice_number: string | null;
}

export async function listPortalDeliveries(customerId: string): Promise<PortalDelivery[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalDelivery[] }>("/api/portal/deliveries");
    return body.rows ?? [];
  }
  const { data: sales } = await supabase
    .from("sales")
    .select("id, invoice_number")
    .eq("customer_id", customerId);
  const saleRows = (sales ?? []) as { id: string; invoice_number: string | null }[];
  const saleIds = saleRows.map((s) => s.id);
  if (saleIds.length === 0) return [];

  const { data, error } = await supabase
    .from("deliveries")
    .select(
      "id, delivery_no, delivery_date, status, sale_id, challan_id, receiver_name, delivery_address, notes"
    )
    .in("sale_id", saleIds)
    .order("delivery_date", { ascending: false });
  if (error) throw error;
  const byId = new Map(saleRows.map((s) => [s.id, s.invoice_number]));
  return (data ?? []).map((d) => ({
    ...d,
    invoice_number: byId.get(d.sale_id ?? "") ?? null,
  })) as PortalDelivery[];
}

export interface PortalProjectListItem {
  id: string;
  project_code: string;
  project_name: string;
  status: string;
  start_date: string | null;
  expected_end_date: string | null;
}

export async function listPortalProjects(
  customerId: string,
): Promise<PortalProjectListItem[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalProjectListItem[] }>(
      "/api/portal/projects",
    );
    return body.rows ?? [];
  }
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, status, start_date, expected_end_date")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalProjectListItem[];
}

export interface PortalSiteListItem {
  id: string;
  site_name: string;
  address: string | null;
  status: string;
  project_id: string;
}

export async function listPortalSites(
  customerId: string,
): Promise<PortalSiteListItem[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalSiteListItem[] }>(
      "/api/portal/sites",
    );
    return body.rows ?? [];
  }
  const { data, error } = await supabase
    .from("project_sites")
    .select("id, site_name, address, status, project_id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PortalSiteListItem[];
}

// ---------- Batch 3: Requests ----------

export type PortalRequestType = "reorder" | "quote";
export type PortalRequestStatus = "pending" | "reviewed" | "converted" | "closed";

export interface PortalRequestItem {
  product_id?: string | null;
  product_name: string;
  product_sku?: string | null;
  unit_type?: string | null;
  quantity: number;
  rate?: number | null;
  notes?: string | null;
}

export interface PortalRequest {
  id: string;
  dealer_id: string;
  customer_id: string;
  portal_user_id: string | null;
  request_type: PortalRequestType;
  status: PortalRequestStatus;
  source_sale_id: string | null;
  source_quotation_id: string | null;
  project_id: string | null;
  site_id: string | null;
  message: string | null;
  items: PortalRequestItem[];
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  converted_quotation_id: string | null;
  created_at: string;
  updated_at: string;
}


export async function submitPortalRequest(payload: {
  request_type: PortalRequestType;
  source_sale_id?: string | null;
  source_quotation_id?: string | null;
  project_id?: string | null;
  site_id?: string | null;
  message?: string | null;
  items: PortalRequestItem[];
}): Promise<string> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ id: string }>("/api/portal/requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return body.id;
  }
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listMyPortalRequests(): Promise<PortalRequest[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalRequest[] }>("/api/portal/requests/my");
    return (body.rows ?? []).map((r) => ({
      ...r,
      items: Array.isArray(r.items) ? r.items : [],
    }));
  }
  const { data, error } = await supabase
    .from("portal_requests" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as PortalRequest[]).map((r) => ({
    ...r,
    items: Array.isArray(r.items) ? r.items : [],
  }));
}

export async function getPortalSaleItems(saleId: string): Promise<PortalRequestItem[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalRequestItem[] }>(
      `/api/portal/sales/${encodeURIComponent(saleId)}/items`,
    );
    return (body.rows ?? []).map((r) => ({
      ...r,
      quantity: Number(r.quantity ?? 0),
      rate: r.rate != null ? Number(r.rate) : null,
    }));
  }
  if (error) throw new Error(error.message);
  return ((data as PortalRequestItem[] | null) ?? []).map((r) => ({
    ...r,
    quantity: Number(r.quantity ?? 0),
    rate: r.rate != null ? Number(r.rate) : null,
  }));
}

// ---------- Batch 3: Documents ----------

export interface PortalQuotationDoc {
  quotation: Record<string, unknown>;
  items: Record<string, unknown>[];
  dealer: Record<string, unknown>;
  customer: Record<string, unknown>;
}

export async function getPortalQuotationDoc(quotationId: string): Promise<PortalQuotationDoc | null> {
  if (usePortalVps()) {
    try {
      return await portalVpsJson<PortalQuotationDoc>(
        `/api/portal/quotations/${encodeURIComponent(quotationId)}/doc`,
      );
    } catch (e) {
      console.warn("portal quotation doc:", (e as Error).message);
      return null;
    }
  }
  if (error) {
    console.warn("portal quotation doc:", error.message);
    return null;
  }
  return data as PortalQuotationDoc;
}

export interface PortalInvoiceDoc {
  sale: Record<string, unknown>;
  items: Record<string, unknown>[];
  dealer: Record<string, unknown>;
  customer: Record<string, unknown>;
}

export async function getPortalInvoiceDoc(saleId: string): Promise<PortalInvoiceDoc | null> {
  if (usePortalVps()) {
    try {
      return await portalVpsJson<PortalInvoiceDoc>(
        `/api/portal/sales/${encodeURIComponent(saleId)}/doc`,
      );
    } catch (e) {
      console.warn("portal invoice doc:", (e as Error).message);
      return null;
    }
  }
  if (error) {
    console.warn("portal invoice doc:", error.message);
    return null;
  }
  return data as PortalInvoiceDoc;
}

export interface PortalChallanDoc {
  challan: Record<string, unknown>;
  sale: Record<string, unknown>;
  items: Record<string, unknown>[];
  dealer: Record<string, unknown>;
  customer: Record<string, unknown>;
}

export async function getPortalChallanDoc(challanId: string): Promise<PortalChallanDoc | null> {
  if (usePortalVps()) {
    try {
      return await portalVpsJson<PortalChallanDoc>(
        `/api/portal/challans/${encodeURIComponent(challanId)}/doc`,
      );
    } catch (e) {
      console.warn("portal challan doc:", (e as Error).message);
      return null;
    }
  }
  if (error) {
    console.warn("portal challan doc:", error.message);
    return null;
  }
  return data as PortalChallanDoc;
}

// ---------- Batch 3: WhatsApp tie-in ----------

export interface PortalWhatsAppStatus {
  message_type: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export async function getPortalWhatsAppStatus(
  sourceType: "quotation" | "sale" | "delivery",
  sourceId: string,
): Promise<PortalWhatsAppStatus | null> {
  if (usePortalVps()) {
    try {
      const body = await portalVpsJson<{ status: PortalWhatsAppStatus | null }>(
        `/api/portal/whatsapp/status?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`,
      );
      return body.status ?? null;
    } catch (e) {
      console.warn("portal wa status:", (e as Error).message);
      return null;
    }
  }
  if (error) {
    console.warn("portal wa status:", error.message);
    return null;
  }
  return (data as PortalWhatsAppStatus | null) ?? null;
}

// ---------- Batch 3: Admin (dealer-side requests) ----------

export async function listDealerPortalRequests(dealerId: string): Promise<PortalRequest[]> {
  if (useDealerVps()) {
    const body = await dealerVpsJson<{ rows: PortalRequest[] }>(
      `/api/portal/requests?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return (body.rows ?? []).map((r) => ({
      ...r,
      items: Array.isArray(r.items) ? r.items : [],
    }));
  }
  const { data, error } = await supabase
    .from("portal_requests" as never)
    .select("*")
    .eq("dealer_id", dealerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as PortalRequest[]).map((r) => ({
    ...r,
    items: Array.isArray(r.items) ? r.items : [],
  }));
}

export async function updatePortalRequest(
  id: string,
  patch: {
    status?: PortalRequestStatus;
    review_note?: string | null;
    reviewed_by?: string | null;
    converted_quotation_id?: string | null;
  },
): Promise<void> {
  if (useDealerVps()) {
    await dealerVpsJson(`/api/portal/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return;
  }
  const update: Record<string, unknown> = { ...patch };
  if (patch.status && patch.status !== "pending") {
    update.reviewed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("portal_requests" as never)
    .update(update as never)
    .eq("id", id);
  if (error) throw error;
}

// ---------- P6-04: Portal payment requests ----------

export type PortalPaymentRequestStatus =
  | "pending"
  | "reviewed"
  | "approved"
  | "rejected"
  | "applied";

export interface PortalPaymentRequest {
  id: string;
  dealer_id: string;
  customer_id: string;
  portal_user_id: string | null;
  amount: number;
  payment_mode: string;
  reference_no: string | null;
  sale_id: string | null;
  message: string | null;
  status: PortalPaymentRequestStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_ledger_id: string | null;
  created_at: string;
  updated_at: string;
  invoice_number?: string | null;
  customer_name?: string | null;
}

export async function submitPortalPaymentRequest(payload: {
  amount: number;
  payment_mode: string;
  reference_no?: string | null;
  sale_id?: string | null;
  message?: string | null;
}): Promise<string> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ id: string }>("/api/portal/payment-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return body.id;
  }
  const { data, error } = await supabase
    .from("portal_payment_requests" as never)
    .insert({
      amount: payload.amount,
      payment_mode: payload.payment_mode,
      reference_no: payload.reference_no ?? null,
      sale_id: payload.sale_id ?? null,
      message: payload.message ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listMyPortalPaymentRequests(): Promise<PortalPaymentRequest[]> {
  if (usePortalVps()) {
    const body = await portalVpsJson<{ rows: PortalPaymentRequest[] }>(
      "/api/portal/payment-requests/my",
    );
    return (body.rows ?? []).map(normalizePaymentRequest);
  }
  const { data, error } = await supabase
    .from("portal_payment_requests" as never)
    .select("*, sales(invoice_number)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<PortalPaymentRequest & { sales?: { invoice_number: string } }>).map(
    (r) =>
      normalizePaymentRequest({
        ...r,
        invoice_number: r.sales?.invoice_number ?? null,
      }),
  );
}

export async function listDealerPortalPaymentRequests(
  dealerId: string,
): Promise<PortalPaymentRequest[]> {
  if (useDealerVps()) {
    const body = await dealerVpsJson<{ rows: PortalPaymentRequest[] }>(
      `/api/portal/payment-requests?dealerId=${encodeURIComponent(dealerId)}`,
    );
    return (body.rows ?? []).map(normalizePaymentRequest);
  }
  const { data, error } = await supabase
    .from("portal_payment_requests" as never)
    .select("*, customers(name), sales(invoice_number)")
    .eq("dealer_id", dealerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<
      PortalPaymentRequest & {
        customers?: { name: string };
        sales?: { invoice_number: string };
      }
    >
  ).map((r) =>
    normalizePaymentRequest({
      ...r,
      customer_name: r.customers?.name ?? null,
      invoice_number: r.sales?.invoice_number ?? null,
    }),
  );
}

export async function updatePortalPaymentRequest(
  id: string,
  patch: {
    status?: PortalPaymentRequestStatus;
    review_note?: string | null;
    applied_ledger_id?: string | null;
  },
): Promise<void> {
  if (useDealerVps()) {
    await dealerVpsJson(`/api/portal/payment-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return;
  }
  const update: Record<string, unknown> = { ...patch };
  if (patch.status && patch.status !== "pending") {
    update.reviewed_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("portal_payment_requests" as never)
    .update(update as never)
    .eq("id", id);
  if (error) throw error;
}

function normalizePaymentRequest(row: PortalPaymentRequest): PortalPaymentRequest {
  return {
    ...row,
    amount: Number(row.amount ?? 0),
  };
}
