/**
 * purchaseInvoiceService — V2 Sprint 5D (Purchase Invoice).
 * VPS-backed via /api/purchase-invoices.
 *
 * A Purchase Invoice IS a `purchases` row — List/Details/Payment are
 * intentionally NOT duplicated here. Use `purchaseService.list()` /
 * `purchaseService.getById()` / `purchaseService.recordPayment()` (or
 * `payablesService.recordPayment()` for FIFO across bills) directly; this
 * file only covers the write paths those don't already handle: creating a
 * draft invoice from Goods Receipt line(s), and finalizing/cancelling it.
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

export interface UninvoicedGoodsReceipt {
  id: string;
  grn_number: string | null;
  receive_date: string;
  supplier_id: string;
  supplier_name: string | null;
}

export interface InvoiceableLine {
  goods_receipt_item_id: string;
  product_id: string;
  product_name_snapshot: string;
  received_qty: number;
  rate: number;
  invoiced_qty: number;
  invoiceable_qty: number;
}

export interface GoodsReceiptLinesResponse {
  goods_receipt: { id: string; grn_number: string | null; receive_date: string; purchase_order_id: string };
  lines: InvoiceableLine[];
}

export interface PurchaseInvoiceItemInput {
  goods_receipt_item_id: string;
  product_id: string;
  invoice_qty: number;
  rate: number;
}

export interface PurchaseInvoiceFormData {
  supplier_id: string;
  purchase_date: string;
  notes?: string | null;
  voucher_discount?: number;
  items: PurchaseInvoiceItemInput[];
}

export const purchaseInvoiceService = {
  async listUninvoicedGoodsReceipts(dealerId: string, supplierId = "") {
    const params = new URLSearchParams({ dealerId });
    if (supplierId) params.set("supplierId", supplierId);
    const body = await vpsRequest<{ rows: UninvoicedGoodsReceipt[] }>(
      `/api/purchase-invoices/goods-receipts/uninvoiced?${params.toString()}`,
    );
    return body.rows ?? [];
  },

  async getGoodsReceiptLines(grnId: string, dealerId: string) {
    return vpsRequest<GoodsReceiptLinesResponse>(
      `/api/purchase-invoices/goods-receipt/${grnId}/lines?dealerId=${encodeURIComponent(dealerId)}`,
    );
  },

  async create(dealerId: string, form: PurchaseInvoiceFormData) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-invoices?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify({ ...form, notes: form.notes?.trim() || null, voucher_discount: form.voucher_discount ?? 0 }),
    });
    return body.row;
  },

  async update(id: string, dealerId: string, form: PurchaseInvoiceFormData) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-invoices/${id}?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...form, notes: form.notes?.trim() || null, voucher_discount: form.voucher_discount ?? 0 }),
    });
    return body.row;
  },

  async remove(id: string, dealerId: string) {
    await vpsRequest(`/api/purchase-invoices/${id}?dealerId=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
  },

  async finalize(id: string, dealerId: string, opts: { paid_on_create?: number; paid_account_id?: string | null } = {}) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-invoices/${id}/finalize?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
    return body.row;
  },

  async cancel(id: string, dealerId: string) {
    const body = await vpsRequest<{ row: any }>(`/api/purchase-invoices/${id}/cancel?dealerId=${encodeURIComponent(dealerId)}`, {
      method: "POST",
    });
    return body.row;
  },
};
