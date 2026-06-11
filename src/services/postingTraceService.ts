/**
 * P4-05 — Posting trace API client for drill-down from balance reports.
 */
import { vpsAuthedFetch } from "@/lib/vpsAuthClient";

export type TraceLineDomain = "customer" | "supplier";

export interface PostingTraceLine {
  id: string;
  lineDomain: string;
  lineType: string;
  amount: number;
  entryDate: string;
  qtyDelta: number | null;
  qtyUnit: string | null;
  saleId: string | null;
  purchaseId: string | null;
  productId: string | null;
  metadata: Record<string, unknown>;
}

export interface PostingTraceBatch {
  batchId: string;
  documentType: string;
  documentId: string;
  eventType: string;
  postedAt: string;
  notes: string | null;
  reversesBatchId: string | null;
  invoiceRef: string | null;
  lines: PostingTraceLine[];
  lineTotal: number;
}

export interface PartyPostingTraceResult {
  source: "posting_engine" | "legacy_ledger";
  partyId: string;
  lineDomain: TraceLineDomain;
  partyName: string | null;
  batches: PostingTraceBatch[];
  runningBalance: number;
}

async function vpsRequest<T>(path: string): Promise<T> {
  const res = await vpsAuthedFetch(path);
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export const postingTraceService = {
  async traceParty(
    dealerId: string,
    lineDomain: TraceLineDomain,
    partyId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<PartyPostingTraceResult> {
    const params = new URLSearchParams({ dealerId, lineDomain, partyId });
    if (opts.from) params.set("from", opts.from);
    if (opts.to) params.set("to", opts.to);
    if (opts.limit) params.set("limit", String(opts.limit));
    return vpsRequest(`/api/postings/trace?${params}`);
  },

  async getBatch(dealerId: string, batchId: string): Promise<PostingTraceBatch> {
    return vpsRequest(`/api/postings/batch/${batchId}?dealerId=${dealerId}`);
  },
};
