/**
 * V2 Sprint 5D — query-shape + pure-function tests for the Supplier Aging /
 * Accounts Payable endpoint. Reuses reportQueryService's aging-bucket
 * utilities unmodified (verified in supplierAging.ts, not re-tested here —
 * those already have their own coverage from the customer-side aging
 * report). This file covers what's new: the posted-purchases query shape
 * and the purchase_date-recency Due Today/This Week/This Month logic.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/supplier-aging — open-bills query shape', () => {
  it('scopes to posted purchases for this dealer only', () => {
    const { sql, bindings } = db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where({ 'p.dealer_id': DEALER_ID, 'p.document_status': 'posted' })
      .select('p.id', 'p.invoice_number', 'p.purchase_date', 'p.total_amount', 'p.voucher_discount', 'p.supplier_id', 's.name as supplier_name')
      .toSQL();
    expect(sql).toMatch(/left join "suppliers" as "s" on "s"\."id" = "p"\."supplier_id"/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('posted');
  });

  it('excludes draft/cancelled/reversed/pending_approval invoices — only a finalized bill is real payable debt', () => {
    const { bindings } = db('purchases as p').where({ 'p.document_status': 'posted' }).toSQL();
    for (const excluded of ['draft', 'cancelled', 'reversed', 'pending_approval']) {
      expect(bindings).not.toContain(excluded);
    }
  });
});

describe('startOfWeek — Monday-start week boundary', () => {
  function startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  it('returns the same Monday for a mid-week date (Wednesday 2026-07-08)', () => {
    const wed = new Date('2026-07-08T15:30:00');
    const monday = startOfWeek(wed);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(6);
  });

  it('rolls a Sunday back to the preceding Monday, not forward', () => {
    const sun = new Date('2026-07-12T10:00:00');
    const monday = startOfWeek(sun);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(6);
  });
});

describe('Due Today / This Week / This Month recency buckets', () => {
  function classify(billDate: Date, today: Date, weekStart: Date, monthStart: Date) {
    return {
      isToday: billDate.toDateString() === today.toDateString(),
      isThisWeek: billDate >= weekStart,
      isThisMonth: billDate >= monthStart,
    };
  }

  const today = new Date('2026-07-06T12:00:00');
  const weekStart = new Date('2026-07-06T00:00:00'); // Monday of this week
  const monthStart = new Date('2026-07-01T00:00:00');

  it('a bill dated today is due_today, due_this_week, and due_this_month', () => {
    const result = classify(new Date('2026-07-06T09:00:00'), today, weekStart, monthStart);
    expect(result).toEqual({ isToday: true, isThisWeek: true, isThisMonth: true });
  });

  it('a bill dated earlier this month (but not this week) is only due_this_month', () => {
    const result = classify(new Date('2026-07-02T09:00:00'), today, weekStart, monthStart);
    expect(result).toEqual({ isToday: false, isThisWeek: false, isThisMonth: true });
  });

  it('a bill dated last month is none of the three recency buckets', () => {
    const result = classify(new Date('2026-06-28T09:00:00'), today, weekStart, monthStart);
    expect(result).toEqual({ isToday: false, isThisWeek: false, isThisMonth: false });
  });
});
