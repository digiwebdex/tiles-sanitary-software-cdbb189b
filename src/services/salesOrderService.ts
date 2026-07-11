/**
 * Sales Order service — V2 Sprint 4B.
 *
 * All reads and writes go through /api/sales-orders/*. Mirrors the shape of
 * quotationService.ts for consistency across the two adjacent modules.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";
import type { SalesOrderFormInput } from "@/modules/salesOrders/salesOrderSchema";

export type SalesOrderStatus = "draft" | "confirmed" | "partially_delivered" | "completed" | "cancelled";
export type DeliveryReadiness = "pending" | "ready" | "partially_ready";

export interface SalesOrder {
  id: string;
  dealer_id: string;
  so_number: string;
  status: SalesOrderStatus;
  customer_id: string | null;
  customer_name_text: string | null;
  customer_phone_text: string | null;
  customer_address_text: string | null;
  quotation_id: string | null;
  project_id: string | null;
  site_id: string | null;
  salesperson_id: string | null;
  order_date: string;
  subtotal: number;
  discount_type: "flat" | "percent";
  discount_value: number;
  total_amount: number;
  planned_delivery_date: string | null;
  delivery_readiness: DeliveryReadiness;
  notes: string | null;
  terms_text: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  converted_sale_id: string | null;
  converted_to_sale_by: string | null;
  converted_to_sale_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesOrderItem {
  id: string;
  dealer_id: string;
  sales_order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_sku_snapshot: string | null;
  unit_type: "box_sft" | "piece";
  per_box_sft: number | null;
  quantity: number;
  rate: number;
  discount_value: number;
  line_total: number;
  rate_source: "default" | "tier" | "manual";
  tier_id: string | null;
  preferred_shade_code: string | null;
  preferred_caliber: string | null;
  preferred_batch_no: string | null;
  reservation_id: string | null;
  reservation_status: string | null;
  reserved_qty: number;
  delivered_qty: number;
  sort_order: number;
  created_at: string;
  caliber_mismatch: boolean;
  actual_batch_caliber: string | null;
  pieces_per_box: number | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await vpsAuthedFetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* ignore */ }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const salesOrderService = {
  async list(
    dealerId: string,
    opts: { search?: string; status?: SalesOrderStatus | ""; page?: number; projectId?: string | null; customerId?: string | null } = {},
  ) {
    const r = await call<{
      data: (SalesOrder & { customers: { name: string; phone: string | null } | null; projects: { project_name: string; project_code: string } | null })[];
      total: number;
    }>(`/api/sales-orders${qs({
      dealerId,
      search: opts.search ?? "",
      status: opts.status ?? "",
      page: opts.page ?? 1,
      projectId: opts.projectId ?? "",
      customerId: opts.customerId ?? "",
    })}`);
    return { data: r.data ?? [], total: r.total ?? 0 };
  },

  async getById(id: string, dealerId?: string) {
    const r = await call<{ data: SalesOrder & { customers: { id: string; name: string; phone: string | null; address: string | null } | null } }>(
      `/api/sales-orders/${id}${qs({ dealerId })}`,
    );
    return r.data;
  },

  async listItems(salesOrderId: string, dealerId?: string) {
    const r = await call<{ data: SalesOrderItem[] }>(`/api/sales-orders/${salesOrderId}/items${qs({ dealerId })}`);
    return r.data ?? [];
  },

  async createDraft(dealerId: string, form: SalesOrderFormInput): Promise<SalesOrder> {
    const r = await call<{ data: SalesOrder }>("/api/sales-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, dealerId }),
    });
    return r.data;
  },

  async updateDraft(id: string, dealerId: string, form: SalesOrderFormInput): Promise<void> {
    await call(`/api/sales-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, dealerId }),
    });
  },

  async deleteDraft(id: string, dealerId?: string): Promise<void> {
    await call(`/api/sales-orders/${id}${qs({ dealerId })}`, { method: "DELETE" });
  },

  async confirm(id: string, dealerId: string): Promise<{ data: SalesOrder; warnings: { item_id: string; message: string }[] }> {
    return call(`/api/sales-orders/${id}/confirm${qs({ dealerId })}`, { method: "POST" });
  },

  async cancel(id: string, dealerId: string, cancelReason: string): Promise<void> {
    await call(`/api/sales-orders/${id}/cancel${qs({ dealerId })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel_reason: cancelReason }),
    });
  },

  async updateItemQuantity(
    salesOrderId: string,
    itemId: string,
    dealerId: string,
    quantity: number,
  ): Promise<{ ok: boolean; reservation_id: string | null; reserved_qty: number; warning: string | null }> {
    return call(`/api/sales-orders/${salesOrderId}/items/${itemId}${qs({ dealerId })}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
  },

  async updateDeliveryPlanning(
    id: string,
    dealerId: string,
    patch: { planned_delivery_date?: string | null; delivery_readiness?: DeliveryReadiness },
  ): Promise<SalesOrder> {
    const r = await call<{ data: SalesOrder }>(`/api/sales-orders/${id}/delivery-planning${qs({ dealerId })}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return r.data;
  },

  async createFromQuotation(quotationId: string, dealerId: string): Promise<SalesOrder> {
    const r = await call<{ data: SalesOrder }>(`/api/sales-orders/from-quotation/${quotationId}${qs({ dealerId })}`, {
      method: "POST",
    });
    return r.data;
  },

  /** V2 Sprint 4C — prefill payload for the existing /sales/new form. */
  async getInvoicePrefill(salesOrderId: string, dealerId: string): Promise<{
    sales_order_id: string;
    so_number: string;
    customer_name: string;
    items: Array<{ product_id: string; quantity: number; sale_rate: number }>;
    reservation_selections: Record<string, Array<{ reservation_id: string; consume_qty: number }>>;
    discount: number;
    notes: string;
    project_id: string | null;
    site_id: string | null;
    blockers: string[];
  }> {
    const r = await call<{ data: any }>(`/api/sales-orders/${salesOrderId}/invoice-prefill${qs({ dealerId })}`, {
      method: "POST",
    });
    return r.data;
  },

  async linkToSale(salesOrderId: string, saleId: string, dealerId: string): Promise<void> {
    await call(`/api/sales-orders/${salesOrderId}/link-to-sale${qs({ dealerId })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId }),
    });
  },
};
