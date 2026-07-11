import { describe, expect, it } from 'vitest';
import { mergeTimelineEvents, type TimelineEvent } from './invoiceTimelineService';

describe('mergeTimelineEvents (V2 Sprint 4C — Invoice Timeline)', () => {
  it('merges multiple groups into one time-sorted list', () => {
    const saleEvents: TimelineEvent[] = [{ at: '2026-01-01T10:00:00Z', type: 'sale_create', label: 'Invoice created' }];
    const challanEvents: TimelineEvent[] = [{ at: '2026-01-02T10:00:00Z', type: 'challan_create', label: 'Challan generated' }];
    const paymentEvents: TimelineEvent[] = [{ at: '2026-01-01T15:00:00Z', type: 'payment_received', label: 'Payment received' }];

    const merged = mergeTimelineEvents(saleEvents, challanEvents, paymentEvents);
    expect(merged.map((e) => e.type)).toEqual(['sale_create', 'payment_received', 'challan_create']);
  });

  it('returns an empty array when every group is empty', () => {
    expect(mergeTimelineEvents([], [], [])).toEqual([]);
  });

  it('preserves the detail payload on each event', () => {
    const events: TimelineEvent[] = [{ at: '2026-01-01T10:00:00Z', type: 'payment_received', label: 'Payment received', detail: { amount: 500 } }];
    const merged = mergeTimelineEvents(events);
    expect(merged[0].detail).toEqual({ amount: 500 });
  });
});
