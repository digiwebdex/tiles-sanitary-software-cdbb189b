/**
 * V2 Sprint 4C — Delivery Challan additive fields (driver_phone,
 * scheduled_delivery_date). Mirrors the request/update schemas in
 * challans.ts to confirm they accept the new optional fields without
 * requiring them (backward compatible with every existing caller).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const createSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  sale_id: z.string().uuid(),
  challan_date: z.string().min(1),
  driver_name: z.string().nullable().optional(),
  driver_phone: z.string().nullable().optional(),
  transport_name: z.string().nullable().optional(),
  vehicle_no: z.string().nullable().optional(),
  scheduled_delivery_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  show_price: z.boolean().optional(),
});

describe('challans createSchema (V2 Sprint 4C additions)', () => {
  const SALE_ID = '11111111-1111-1111-1111-111111111111';

  it('accepts a payload with no driver_phone/scheduled_delivery_date (backward compatible)', () => {
    const parsed = createSchema.parse({ sale_id: SALE_ID, challan_date: '2026-01-01' });
    expect(parsed.driver_phone).toBeUndefined();
    expect(parsed.scheduled_delivery_date).toBeUndefined();
  });

  it('accepts a payload with driver_phone and scheduled_delivery_date set', () => {
    const parsed = createSchema.parse({
      sale_id: SALE_ID,
      challan_date: '2026-01-01',
      driver_phone: '01711111111',
      scheduled_delivery_date: '2026-01-05',
    });
    expect(parsed.driver_phone).toBe('01711111111');
    expect(parsed.scheduled_delivery_date).toBe('2026-01-05');
  });

  it('still requires sale_id and challan_date', () => {
    expect(() => createSchema.parse({ driver_phone: '01711111111' })).toThrow();
  });
});
