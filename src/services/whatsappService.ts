/**
 * WhatsApp service — VPS-backed (Phase 3U-16).
 *
 * Reads and writes go through /api/whatsapp/*.
 * Pure helpers (phone normalize, template builders) are unchanged.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type WhatsAppMessageType =
  | "quotation_share"
  | "invoice_share"
  | "payment_receipt"
  | "overdue_reminder"
  | "delivery_update"
  // V2 Sprint 5B
  | "purchase_order_share";

export type WhatsAppMessageStatus =
  | "pending"
  | "sent"
  | "manual_handoff"
  | "failed";

export interface WhatsAppMessageLog {
  id: string;
  dealer_id: string;
  message_type: WhatsAppMessageType;
  source_type: string;
  source_id: string | null;
  recipient_phone: string;
  recipient_name: string | null;
  template_key: string | null;
  message_text: string;
  payload_snapshot: Record<string, unknown>;
  status: WhatsAppMessageStatus;
  provider: string;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface CreateLogInput {
  dealer_id: string;
  message_type: WhatsAppMessageType;
  source_type: string;
  source_id: string | null;
  recipient_phone: string;
  recipient_name?: string | null;
  template_key?: string | null;
  message_text: string;
  payload_snapshot?: Record<string, unknown>;
  status?: WhatsAppMessageStatus;
}

const PAGE_SIZE = 25;

/* ---------- Phone helpers ---------- */
export function normalizePhoneForWa(raw: string): string {
  let p = (raw ?? "").replace(/[\s\-()+]/g, "");
  if (!p) return "";
  if (p.length === 11 && p.startsWith("0")) p = "88" + p;
  return p.replace(/\D/g, "");
}
export function isValidWaPhone(raw: string): boolean {
  const n = normalizePhoneForWa(raw);
  return n.length >= 8 && n.length <= 15;
}
export function buildWaLink(phone: string, text: string): string {
  const digits = normalizePhoneForWa(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/* ---------- Template builders ---------- */
interface QuotationTemplateData { dealerName: string; customerName?: string | null; quotationNo: string; totalAmount: number; validUntil?: string | null; itemCount: number; }
interface InvoiceTemplateData { dealerName: string; customerName?: string | null; invoiceNo: string; totalAmount: number; paidAmount: number; dueAmount: number; saleDate?: string | null; }
interface PaymentReceiptTemplateData { dealerName: string; customerName?: string | null; receiptNo: string; amount: number; remainingDue: number; date: string; }
interface OverdueReminderTemplateData { dealerName: string; dealerPhone?: string | null; customerName?: string | null; outstanding: number; daysOverdue: number; oldestInvoiceDate?: string | null; }
interface DeliveryUpdateTemplateData { dealerName: string; customerName?: string | null; deliveryNo: string; status: string; itemCount: number; deliveryDate?: string | null; invoiceNo?: string | null; receiverName?: string | null; }
/** V2 Sprint 5B — addressed to the SUPPLIER (not a customer), unlike every other template above. */
interface PurchaseOrderTemplateData { dealerName: string; supplierName?: string | null; poNumber: string; totalAmount: number; itemCount: number; expectedDeliveryDate?: string | null; }

const fmtBdt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildQuotationMessage(d: QuotationTemplateData): string {
  const greeting = d.customerName ? `Dear ${d.customerName},` : "Dear Customer,";
  const validity = d.validUntil ? `\nValid until: ${d.validUntil}` : "";
  return [greeting, "", `Please find your quotation from ${d.dealerName}.`, "",
    `Quotation No: ${d.quotationNo}`, `Items: ${d.itemCount}`, `Total: ${fmtBdt(d.totalAmount)}${validity}`, "",
    "Please confirm to proceed with your order.", "", `Thanks,\n${d.dealerName}`].join("\n");
}
export function buildInvoiceMessage(d: InvoiceTemplateData): string {
  const greeting = d.customerName ? `Dear ${d.customerName},` : "Dear Customer,";
  const dateLine = d.saleDate ? `\nDate: ${d.saleDate}` : "";
  const dueLine = d.dueAmount > 0 ? `\nDue: ${fmtBdt(d.dueAmount)}` : "\nStatus: Fully Paid ✅";
  return [greeting, "", `Your invoice from ${d.dealerName}:`, "",
    `Invoice No: ${d.invoiceNo}${dateLine}`, `Total: ${fmtBdt(d.totalAmount)}`,
    `Paid: ${fmtBdt(d.paidAmount)}${dueLine}`, "", "Thank you for your business.", "", `${d.dealerName}`].join("\n");
}
export function buildPaymentReceiptMessage(d: PaymentReceiptTemplateData): string {
  const greeting = d.customerName ? `Dear ${d.customerName},` : "Dear Customer,";
  const dueLine = d.remainingDue > 0 ? `Remaining Due: ${fmtBdt(d.remainingDue)}` : "All dues cleared ✅";
  return [greeting, "", `We have received your payment. Thank you!`, "",
    `Receipt No: ${d.receiptNo}`, `Date: ${d.date}`, `Amount Received: ${fmtBdt(d.amount)}`, dueLine,
    "", `Thanks,\n${d.dealerName}`].join("\n");
}
export function buildOverdueReminderMessage(d: OverdueReminderTemplateData): string {
  const greeting = d.customerName ? `Dear ${d.customerName},` : "Dear Customer,";
  const oldestLine = d.oldestInvoiceDate ? `\nOldest unpaid invoice: ${d.oldestInvoiceDate}` : "";
  const daysLine = d.daysOverdue > 0 ? `\nOverdue: ${d.daysOverdue} days` : "";
  const contactLine = d.dealerPhone ? `\n\nFor any questions, call ${d.dealerPhone}.` : "";
  return [greeting, "", `This is a friendly reminder from ${d.dealerName}.`, "",
    `Outstanding balance: ${fmtBdt(d.outstanding)}${daysLine}${oldestLine}`,
    "", `Please arrange the payment at your earliest convenience.${contactLine}`,
    "", `Thanks,\n${d.dealerName}`].join("\n");
}
export function buildDeliveryUpdateMessage(d: DeliveryUpdateTemplateData): string {
  const greeting = d.customerName ? `Dear ${d.customerName},` : "Dear Customer,";
  const dateLine = d.deliveryDate ? `\nDate: ${d.deliveryDate}` : "";
  const invLine = d.invoiceNo ? `\nInvoice: ${d.invoiceNo}` : "";
  const recvLine = d.receiverName ? `\nReceiver: ${d.receiverName}` : "";
  return [greeting, "", `Delivery update from ${d.dealerName}:`, "",
    `Delivery No: ${d.deliveryNo}${invLine}${dateLine}`, `Items: ${d.itemCount}`,
    `Status: ${d.status}${recvLine}`, "", "Thank you for your business.", "", `${d.dealerName}`].join("\n");
}
export function buildPurchaseOrderMessage(d: PurchaseOrderTemplateData): string {
  const greeting = d.supplierName ? `Dear ${d.supplierName},` : "Dear Supplier,";
  const deliveryLine = d.expectedDeliveryDate ? `\nExpected Delivery: ${d.expectedDeliveryDate}` : "";
  return [greeting, "", `Please find our purchase order details below.`, "",
    `PO Number: ${d.poNumber}`, `Items: ${d.itemCount}`, `Total: ${fmtBdt(d.totalAmount)}${deliveryLine}`, "",
    "Kindly confirm receipt and expected delivery.", "", `Thanks,\n${d.dealerName}`].join("\n");
}

/* ---------- Settings ---------- */
export interface WhatsAppSettings {
  dealer_id: string;
  enable_quotation_share: boolean;
  enable_invoice_share: boolean;
  enable_payment_receipt: boolean;
  enable_overdue_reminder: boolean;
  enable_delivery_update: boolean;
  // V2 Sprint 5B
  enable_purchase_order_share: boolean;
  template_quotation_share: string | null;
  template_invoice_share: string | null;
  template_payment_receipt: string | null;
  template_overdue_reminder: string | null;
  template_delivery_update: string | null;
  // V2 Sprint 5B
  template_purchase_order_share: string | null;
  prefer_manual_send: boolean;
  default_country_code: string;
}

export const DEFAULT_WHATSAPP_SETTINGS = (dealerId: string): WhatsAppSettings => ({
  dealer_id: dealerId,
  enable_quotation_share: true,
  enable_invoice_share: true,
  enable_payment_receipt: true,
  enable_overdue_reminder: true,
  enable_delivery_update: true,
  enable_purchase_order_share: true,
  template_quotation_share: null,
  template_invoice_share: null,
  template_payment_receipt: null,
  template_overdue_reminder: null,
  template_delivery_update: null,
  template_purchase_order_share: null,
  prefer_manual_send: true,
  default_country_code: "880",
});

const ENABLE_KEY: Record<WhatsAppMessageType, keyof WhatsAppSettings> = {
  quotation_share: "enable_quotation_share",
  invoice_share: "enable_invoice_share",
  payment_receipt: "enable_payment_receipt",
  overdue_reminder: "enable_overdue_reminder",
  delivery_update: "enable_delivery_update",
  purchase_order_share: "enable_purchase_order_share",
};

export function isMessageTypeEnabled(
  settings: WhatsAppSettings | null | undefined,
  type: WhatsAppMessageType,
): boolean {
  if (!settings) return true;
  return Boolean(settings[ENABLE_KEY[type]]);
}

/* ---------- HTTP helpers ---------- */
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

/* ---------- Service ---------- */
export const whatsappService = {
  async createLog(input: CreateLogInput): Promise<WhatsAppMessageLog> {
    const r = await call<{ data: WhatsAppMessageLog }>("/api/whatsapp/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return r.data;
  },

  async list(opts: {
    dealerId: string;
    page?: number;
    messageType?: WhatsAppMessageType | "all";
    status?: WhatsAppMessageStatus | "all";
    search?: string;
  }): Promise<{ rows: WhatsAppMessageLog[]; total: number }> {
    const r = await call<{ rows: WhatsAppMessageLog[]; total: number }>(
      `/api/whatsapp/logs${qs({
        dealerId: opts.dealerId,
        page: opts.page ?? 1,
        messageType: opts.messageType ?? "",
        status: opts.status ?? "",
        search: opts.search ?? "",
      })}`,
    );
    return { rows: r.rows ?? [], total: r.total ?? 0 };
  },

  async markFailed(id: string, errorMessage: string, dealerId?: string): Promise<void> {
    await call(`/api/whatsapp/logs/${id}/failed${qs({ dealerId })}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error_message: errorMessage }),
    });
  },

  async markSent(id: string, dealerId?: string): Promise<void> {
    await call(`/api/whatsapp/logs/${id}/sent${qs({ dealerId })}`, { method: "PATCH" });
  },

  async getTodayStats(dealerId: string): Promise<{
    sent: number; handoff: number; failed: number; total: number;
  }> {
    const r = await call<{ data: { sent: number; handoff: number; failed: number; total: number } }>(
      `/api/whatsapp/today-stats${qs({ dealerId })}`,
    );
    return r.data;
  },

  async getRecentSendForRecipient(opts: {
    dealerId: string;
    messageType: WhatsAppMessageType;
    recipientPhone: string;
    cooldownHours?: number;
  }): Promise<WhatsAppMessageLog | null> {
    const r = await call<{ data: WhatsAppMessageLog | null }>(
      `/api/whatsapp/recent${qs({
        dealerId: opts.dealerId,
        messageType: opts.messageType,
        recipientPhone: opts.recipientPhone,
        cooldownHours: opts.cooldownHours ?? 24,
      })}`,
    );
    return r.data ?? null;
  },

  async retryLog(id: string, dealerId?: string): Promise<{ log: WhatsAppMessageLog; waLink: string }> {
    const r = await call<{ data: { log: WhatsAppMessageLog; waLink: string } }>(
      `/api/whatsapp/logs/${id}/retry${qs({ dealerId })}`,
      { method: "POST" },
    );
    return r.data;
  },

  async bulkUpdateStatus(ids: string[], status: WhatsAppMessageStatus, dealerId?: string): Promise<void> {
    if (ids.length === 0) return;
    await call("/api/whatsapp/logs/bulk-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status, dealerId }),
    });
  },

  async getAnalytics(dealerId: string, days = 7): Promise<{
    totals: { sent: number; handoff: number; failed: number; total: number };
    byType: Record<WhatsAppMessageType, number>;
    daily: { date: string; sent: number; handoff: number; failed: number }[];
    successRate: number;
  }> {
    const r = await call<{ data: {
      totals: { sent: number; handoff: number; failed: number; total: number };
      byType: Record<WhatsAppMessageType, number>;
      daily: { date: string; sent: number; handoff: number; failed: number }[];
      successRate: number;
    } }>(`/api/whatsapp/analytics${qs({ dealerId, days })}`);
    return r.data;
  },

  async getSettings(dealerId: string): Promise<WhatsAppSettings> {
    const r = await call<{ data: WhatsAppSettings }>(
      `/api/whatsapp/settings${qs({ dealerId })}`,
    );
    return r.data ?? DEFAULT_WHATSAPP_SETTINGS(dealerId);
  },

  async upsertSettings(settings: WhatsAppSettings): Promise<void> {
    await call("/api/whatsapp/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  },
};

export const PAGE_SIZE_WA = PAGE_SIZE;
