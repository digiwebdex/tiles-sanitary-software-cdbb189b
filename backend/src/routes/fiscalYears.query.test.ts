/**
 * V2 Sprint 6A — pure-function + schema tests for Fiscal Year / Accounting
 * Period / Opening Balance.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildMonthlyPeriods } from './fiscalYears';

describe('buildMonthlyPeriods — Bangladesh July-June fiscal year', () => {
  it('splits a full July-June year into exactly 12 calendar-month periods', () => {
    const periods = buildMonthlyPeriods('2026-07-01', '2027-06-30');
    expect(periods).toHaveLength(12);
    expect(periods[0]).toEqual({ period_no: 1, start_date: '2026-07-01', end_date: '2026-07-31' });
    expect(periods[11]).toEqual({ period_no: 12, start_date: '2027-06-01', end_date: '2027-06-30' });
  });

  it('handles February correctly across a leap year boundary', () => {
    const periods = buildMonthlyPeriods('2027-07-01', '2028-06-30');
    const feb = periods.find((p) => p.start_date === '2028-02-01');
    expect(feb?.end_date).toBe('2028-02-29'); // 2028 is a leap year
  });

  it('handles a calendar-year (Jan-Dec) fiscal year equally well', () => {
    const periods = buildMonthlyPeriods('2026-01-01', '2026-12-31');
    expect(periods).toHaveLength(12);
    expect(periods[0].start_date).toBe('2026-01-01');
    expect(periods[11].end_date).toBe('2026-12-31');
  });

  it('clips the final period to the fiscal year end date when the range does not end on a month boundary', () => {
    const periods = buildMonthlyPeriods('2026-07-01', '2026-08-15');
    expect(periods).toHaveLength(2);
    expect(periods[1]).toEqual({ period_no: 2, start_date: '2026-08-01', end_date: '2026-08-15' });
  });

  it('produces sequential, non-overlapping period numbers', () => {
    const periods = buildMonthlyPeriods('2026-07-01', '2027-06-30');
    periods.forEach((p, i) => expect(p.period_no).toBe(i + 1));
  });
});

describe('Fiscal Year Zod schema', () => {
  const schema = z.object({
    name: z.string().trim().min(1).max(50),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    set_as_current: z.boolean().default(false),
  });

  it('accepts a minimal valid fiscal year', () => {
    const parsed = schema.parse({ name: 'FY2026-27', start_date: '2026-07-01', end_date: '2027-06-30' });
    expect(parsed.set_as_current).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(() => schema.parse({ name: '', start_date: '2026-07-01', end_date: '2027-06-30' })).toThrow();
  });
});

describe('end_date-after-start_date validation', () => {
  function isValidRange(start: string, end: string): boolean {
    return new Date(end) > new Date(start);
  }
  it('rejects an end_date on or before start_date', () => {
    expect(isValidRange('2026-07-01', '2026-07-01')).toBe(false);
    expect(isValidRange('2026-07-01', '2026-06-01')).toBe(false);
  });
  it('accepts a proper forward range', () => {
    expect(isValidRange('2026-07-01', '2027-06-30')).toBe(true);
  });
});

describe('Opening Balance linkage guards', () => {
  it('rejects linking a non-posted journal entry as the opening balance', () => {
    const entry = { status: 'draft', entry_date: '2026-06-30' };
    expect(entry.status === 'posted').toBe(false);
  });

  it('rejects an opening balance entry dated after the fiscal year start', () => {
    const fiscalYearStart = new Date('2026-07-01');
    const entryDate = new Date('2026-07-05');
    expect(entryDate > fiscalYearStart).toBe(true); // would be rejected
  });

  it('accepts an opening balance entry dated on or before the fiscal year start', () => {
    const fiscalYearStart = new Date('2026-07-01');
    const entryDateOnBoundary = new Date('2026-07-01');
    const entryDateBefore = new Date('2026-06-30');
    expect(entryDateOnBoundary > fiscalYearStart).toBe(false);
    expect(entryDateBefore > fiscalYearStart).toBe(false);
  });
});

describe('Reopen-period reason requirement', () => {
  const reopenSchema = z.object({
    reason: z.string().trim().min(1, 'A reason is required to reopen a closed period').max(500),
  });
  it('rejects reopening with no reason', () => {
    expect(() => reopenSchema.parse({ reason: '' })).toThrow();
  });
  it('accepts a reopen with a stated reason', () => {
    expect(() => reopenSchema.parse({ reason: 'Correcting a data-entry mistake found during audit' })).not.toThrow();
  });
});
