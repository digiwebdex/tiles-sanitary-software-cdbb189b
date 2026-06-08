import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

async function vpsJson(path: string, init?: RequestInit) {
  const res = await vpsAuthedFetch(path, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = `Request failed (${res.status})`;
    try {
      const j = JSON.parse(txt);
      msg = typeof j.error === "string" ? j.error : JSON.stringify(j.error ?? j);
    } catch {
      if (txt) msg = txt;
    }
    throw new Error(msg);
  }
  return res.status === 204 ? null : await res.json();
}

// ── Types ──────────────────────────────────────────────────────────────
export type ApprovalType =
  | "backorder_sale"
  | "mixed_shade"
  | "mixed_caliber"
  | "credit_override"
  | "overdue_override"
  | "discount_override"
  | "stock_adjustment"
  | "sale_cancel"
  | "reservation_release";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "auto_approved"
  | "consumed"
  | "stale";

export interface ApprovalRequest {
  id: string;
  dealer_id: string;
  approval_type: ApprovalType;
  status: ApprovalStatus;
  action_hash: string;
  context_data: Record<string, any>;
  reason: string | null;
  source_type: string;
  source_id: string | null;
  requested_by: string;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: string | null;
  consumed_by: string | null;
  consumed_at: string | null;
  consumed_source_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApprovalContextData {
  customer_id?: string;
  customer_name?: string;
  items?: Array<{
    product_id: string;
    product_name?: string;
    quantity: number;
    sale_rate?: number;
  }>;
  shortage_qty?: number;
  discount_pct?: number;
  overdue_amount?: number;
  overdue_days?: number;
  credit_limit?: number;
  outstanding?: number;
  batch_ids?: string[];
  reservation_ids?: string[];
  mixed_shades?: string[];
  mixed_calibers?: string[];
  [key: string]: any;
}

export interface ApprovalSettings {
  dealer_id: string;
  require_backorder_approval: boolean;
  require_mixed_shade_approval: boolean;
  require_mixed_caliber_approval: boolean;
  require_credit_override_approval: boolean;
  require_overdue_override_approval: boolean;
  require_stock_adjustment_approval: boolean;
  require_sale_cancel_approval: boolean;
  discount_approval_threshold: number;
  auto_approve_for_admins: boolean;
  approval_expiry_hours: number;
}

// ── Canonical Hash ─────────────────────────────────────────────────────
function sortAndClean(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === "number") return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    const cleaned = obj.map(sortAndClean).filter((v) => v !== undefined);
    if (cleaned.length > 0 && typeof cleaned[0] === "object" && cleaned[0]?.product_id) {
      cleaned.sort((a: any, b: any) => (a.product_id ?? "").localeCompare(b.product_id ?? ""));
    }
    return cleaned;
  }

  if (typeof obj === "object") {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = sortAndClean(obj[key]);
      if (val !== undefined) {
        sorted[key] = val;
      }
    }
    return sorted;
  }

  return obj;
}

export async function generateActionHash(
  approvalType: ApprovalType,
  context: ApprovalContextData
): Promise<string> {
  const canonical = sortAndClean({ approval_type: approvalType, ...context });
  const json = JSON.stringify(canonical);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Settings ───────────────────────────────────────────────────────────
export async function getApprovalSettings(dealerId: string): Promise<ApprovalSettings> {
  const json = await vpsJson(`/api/approvals/settings?dealerId=${encodeURIComponent(dealerId)}`);
  return json.settings as ApprovalSettings;
}

export async function saveApprovalSettings(settings: ApprovalSettings): Promise<void> {
  const { dealer_id, ...body } = settings;
  await vpsJson(`/api/approvals/settings?dealerId=${encodeURIComponent(dealer_id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function cancelApprovalRequest(requestId: string, reason?: string): Promise<void> {
  await vpsJson(`/api/approvals/${encodeURIComponent(requestId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export async function expireStaleApprovals(dealerId: string): Promise<number> {
  const json = await vpsJson(`/api/approvals/expire-stale?dealerId=${encodeURIComponent(dealerId)}`, {
    method: "POST",
  });
  return Number(json?.count ?? 0);
}

export function isApprovalRequired(
  settings: ApprovalSettings,
  type: ApprovalType,
  extra?: { discount_pct?: number }
): boolean {
  switch (type) {
    case "backorder_sale":
      return settings.require_backorder_approval;
    case "mixed_shade":
      return settings.require_mixed_shade_approval;
    case "mixed_caliber":
      return settings.require_mixed_caliber_approval;
    case "credit_override":
      return settings.require_credit_override_approval;
    case "overdue_override":
      return settings.require_overdue_override_approval;
    case "stock_adjustment":
      return settings.require_stock_adjustment_approval;
    case "sale_cancel":
      return settings.require_sale_cancel_approval;
    case "discount_override":
      return (extra?.discount_pct ?? 0) >= settings.discount_approval_threshold;
    case "reservation_release":
      return false;
    default:
      return false;
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────
export async function createApprovalRequest(params: {
  dealerId: string;
  approvalType: ApprovalType;
  sourceType: string;
  sourceId?: string;
  requestedBy: string;
  reason?: string;
  context: ApprovalContextData;
  isAdmin?: boolean;
  autoApproveForAdmins?: boolean;
  expiryHours?: number;
}): Promise<ApprovalRequest> {
  const actionHash = await generateActionHash(params.approvalType, params.context);

  const json = await vpsJson(`/api/approvals?dealerId=${encodeURIComponent(params.dealerId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      approval_type: params.approvalType,
      source_type: params.sourceType,
      source_id: params.sourceId ?? null,
      reason: params.reason ?? null,
      context: params.context,
      action_hash: actionHash,
      expiry_hours: params.expiryHours,
    }),
  });
  return json.request as ApprovalRequest;
}

export async function decideApprovalRequest(
  requestId: string,
  decision: "approved" | "rejected",
  decisionNote?: string
): Promise<void> {
  await vpsJson(`/api/approvals/${encodeURIComponent(requestId)}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, decision_note: decisionNote ?? null }),
  });
}

export async function consumeApprovalRequest(
  requestId: string,
  actionHash: string,
  sourceId?: string
): Promise<void> {
  await vpsJson(`/api/approvals/${encodeURIComponent(requestId)}/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_hash: actionHash, source_id: sourceId ?? null }),
  });
}

export async function findValidApproval(
  dealerId: string,
  approvalType: ApprovalType,
  context: ApprovalContextData
): Promise<ApprovalRequest | null> {
  const actionHash = await generateActionHash(approvalType, context);
  const json = await vpsJson(
    `/api/approvals?dealerId=${encodeURIComponent(dealerId)}&type=${encodeURIComponent(approvalType)}`,
  );
  const rows = (json.rows ?? []) as ApprovalRequest[];
  const match = rows.find(
    (r) =>
      r.action_hash === actionHash &&
      ["approved", "auto_approved"].includes(r.status) &&
      !r.consumed_at &&
      (!r.expires_at || new Date(r.expires_at) >= new Date()),
  );
  return match ?? null;
}

export async function listPendingApprovals(dealerId: string): Promise<ApprovalRequest[]> {
  try {
    const json = await vpsJson(`/api/approvals/pending?dealerId=${encodeURIComponent(dealerId)}`);
    return (json.rows ?? []) as ApprovalRequest[];
  } catch {
    return [];
  }
}

export async function listApprovals(
  dealerId: string,
  filters?: { status?: string; type?: string }
): Promise<ApprovalRequest[]> {
  const params = new URLSearchParams({ dealerId });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.type) params.set("type", filters.type);
  const json = await vpsJson(`/api/approvals?${params.toString()}`);
  return (json.rows ?? []) as ApprovalRequest[];
}

// ── Status Labels ──────────────────────────────────────────────────────
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
  auto_approved: "Auto-Approved",
  consumed: "Used",
  stale: "Stale",
};

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  backorder_sale: "Backorder Sale",
  mixed_shade: "Mixed Shade",
  mixed_caliber: "Mixed Caliber",
  credit_override: "Credit Limit Override",
  overdue_override: "Overdue Override",
  discount_override: "Discount Override",
  stock_adjustment: "Stock Adjustment",
  sale_cancel: "Sale Cancel",
  reservation_release: "Reservation Release",
};
