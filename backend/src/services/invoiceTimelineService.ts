import { db } from '../db/connection';

/**
 * V2 Sprint 4C — Invoice Timeline / Audit Trail.
 *
 * Read-only aggregation over existing tables (audit_logs, challans,
 * deliveries, customer_ledger) — every mutation already writes an
 * audit_logs row (sales.ts, challans.ts, deliveries.ts, all pre-existing
 * and unmodified); this just assembles the ones relevant to one invoice
 * into a single chronological view instead of duplicating any of that
 * logging.
 */
export interface TimelineEvent {
  at: string;
  type: string;
  label: string;
  detail?: Record<string, unknown> | null;
}

const ACTION_LABELS: Record<string, string> = {
  sale_create: 'Invoice created',
  sale_update: 'Invoice edited',
  sale_cancel_delete: 'Invoice deleted',
  sale_reverse: 'Invoice reversed',
  challan_create: 'Challan generated',
  challan_delivered: 'Challan marked delivered',
  challan_convert_invoice: 'Invoice approved (stock deducted, ledger posted)',
  challan_update: 'Challan edited',
  challan_cancel: 'Challan cancelled',
  challan_delivery_status_update: 'Delivery status updated',
  delivery_create: 'Delivery recorded',
  delivery_status_update: 'Delivery status updated',
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Pure — merges and time-sorts event groups. Split out for testability. */
export function mergeTimelineEvents(...groups: TimelineEvent[][]): TimelineEvent[] {
  return groups
    .flat()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export async function buildInvoiceTimeline(dealerId: string, saleId: string): Promise<TimelineEvent[]> {
  const saleLogs = await db('audit_logs')
    .where({ dealer_id: dealerId, table_name: 'sales', record_id: saleId })
    .select('action', 'new_data', 'created_at');

  const challans = await db('challans').where({ dealer_id: dealerId, sale_id: saleId }).select('id', 'challan_no');
  const challanIds = challans.map((c: any) => c.id);
  const challanLogs = challanIds.length
    ? await db('audit_logs')
        .where({ dealer_id: dealerId, table_name: 'challans' })
        .whereIn('record_id', challanIds)
        .select('action', 'new_data', 'created_at')
    : [];

  const deliveries = await db('deliveries').where({ dealer_id: dealerId, sale_id: saleId }).select('id', 'delivery_no');
  const deliveryIds = deliveries.map((d: any) => d.id);
  const deliveryLogs = deliveryIds.length
    ? await db('audit_logs')
        .where({ dealer_id: dealerId, table_name: 'deliveries' })
        .whereIn('record_id', deliveryIds)
        .select('action', 'new_data', 'created_at')
    : [];

  const payments = await db('customer_ledger')
    .where({ dealer_id: dealerId, sale_id: saleId, type: 'payment' })
    .select('amount', 'description', 'created_at');

  const toEvents = (logs: any[]): TimelineEvent[] =>
    logs.map((l) => ({ at: l.created_at, type: l.action, label: labelFor(l.action), detail: l.new_data ?? null }));

  const paymentEvents: TimelineEvent[] = payments.map((p: any) => ({
    at: p.created_at,
    type: 'payment_received',
    label: `Payment received — ${p.description ?? ''}`.trim(),
    detail: { amount: Number(p.amount) },
  }));

  return mergeTimelineEvents(toEvents(saleLogs), toEvents(challanLogs), toEvents(deliveryLogs), paymentEvents);
}
