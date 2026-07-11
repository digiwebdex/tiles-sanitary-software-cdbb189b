import { describe, expect, it } from 'vitest';
import { calcLineTotal, calcTotals, computeReservableQty, hasCaliberMismatch, computeDeliveryReadiness } from './salesOrderService';

describe('calcLineTotal (V2 Sprint 4B — mirrors quotations.ts exactly)', () => {
  it('multiplies quantity by rate and subtracts the discount', () => {
    expect(calcLineTotal({ quantity: 10, rate: 100, discount_value: 50 })).toBe(950);
  });

  it('clamps at zero when the discount exceeds the gross amount', () => {
    expect(calcLineTotal({ quantity: 2, rate: 10, discount_value: 100 })).toBe(0);
  });

  it('defaults a missing discount_value to 0', () => {
    expect(calcLineTotal({ quantity: 5, rate: 20 })).toBe(100);
  });
});

describe('calcTotals (V2 Sprint 4B — mirrors quotations.ts exactly)', () => {
  const items = [
    { quantity: 10, rate: 100, discount_value: 0 },
    { quantity: 5, rate: 50, discount_value: 0 },
  ];

  it('applies a flat discount to the subtotal', () => {
    const r = calcTotals(items, 'flat', 100);
    expect(r.subtotal).toBe(1250);
    expect(r.total_amount).toBe(1150);
  });

  it('applies a percent discount to the subtotal', () => {
    const r = calcTotals(items, 'percent', 10);
    expect(r.subtotal).toBe(1250);
    expect(r.total_amount).toBe(1125);
  });

  it('rounds to 2 decimal places', () => {
    const r = calcTotals([{ quantity: 3, rate: 10.005, discount_value: 0 }], 'flat', 0);
    expect(r.subtotal).toBe(30.02);
  });
});

describe('computeReservableQty (V2 Sprint 4B — caps the reservation request at real availability)', () => {
  it('reserves the full request when stock is plentiful (piece unit)', () => {
    expect(computeReservableQty(50, 200, 'piece', 1)).toBe(50);
  });

  it('caps at available pieces when stock is short (piece unit)', () => {
    expect(computeReservableQty(50, 20, 'piece', 1)).toBe(20);
  });

  it('converts available pieces to native box units before capping (box_sft unit)', () => {
    // 100 available pieces / 10 pieces-per-box = 10 boxes available
    expect(computeReservableQty(15, 100, 'box_sft', 10)).toBe(10);
  });

  it('reserves the full request when it is under the box-converted availability', () => {
    expect(computeReservableQty(5, 100, 'box_sft', 10)).toBe(5);
  });

  it('never returns a negative number when availability is zero', () => {
    expect(computeReservableQty(10, 0, 'piece', 1)).toBe(0);
  });

  it('guards against a zero/invalid pieces-per-box by treating it as 1', () => {
    expect(computeReservableQty(5, 5, 'box_sft', 0)).toBe(5);
  });
});

describe('hasCaliberMismatch (V2 Sprint 4B — informational only, no auto-matching)', () => {
  it('reports no mismatch when calibers match exactly', () => {
    expect(hasCaliberMismatch('600x600', '600x600')).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(hasCaliberMismatch(' 600X600 ', '600x600')).toBe(false);
  });

  it('reports a mismatch when calibers differ', () => {
    expect(hasCaliberMismatch('600x600', '800x800')).toBe(true);
  });

  it('reports no mismatch when either side is missing (nothing to compare)', () => {
    expect(hasCaliberMismatch(null, '600x600')).toBe(false);
    expect(hasCaliberMismatch('600x600', null)).toBe(false);
    expect(hasCaliberMismatch(null, null)).toBe(false);
  });
});

describe('computeDeliveryReadiness (V2 Sprint 4B — Delivery Planning)', () => {
  it('is "ready" when every product line is fully reserved', () => {
    const r = computeDeliveryReadiness([
      { product_id: 'p1', quantity: 10, reserved_qty: 10 },
      { product_id: 'p2', quantity: 5, reserved_qty: 5 },
    ]);
    expect(r).toBe('ready');
  });

  it('is "partially_ready" when some but not all lines are reserved', () => {
    const r = computeDeliveryReadiness([
      { product_id: 'p1', quantity: 10, reserved_qty: 10 },
      { product_id: 'p2', quantity: 5, reserved_qty: 0 },
    ]);
    expect(r).toBe('partially_ready');
  });

  it('is "partially_ready" when a line is only partly reserved', () => {
    const r = computeDeliveryReadiness([{ product_id: 'p1', quantity: 10, reserved_qty: 4 }]);
    expect(r).toBe('partially_ready');
  });

  it('is "pending" when nothing is reserved', () => {
    const r = computeDeliveryReadiness([{ product_id: 'p1', quantity: 10, reserved_qty: 0 }]);
    expect(r).toBe('pending');
  });

  it('is "pending" when there are no product-linked lines at all', () => {
    const r = computeDeliveryReadiness([{ product_id: null, quantity: 10, reserved_qty: 0 }]);
    expect(r).toBe('pending');
  });

  it('ignores custom (no-product) lines when judging readiness', () => {
    const r = computeDeliveryReadiness([
      { product_id: 'p1', quantity: 10, reserved_qty: 10 },
      { product_id: null, quantity: 3, reserved_qty: 0 },
    ]);
    expect(r).toBe('ready');
  });
});
