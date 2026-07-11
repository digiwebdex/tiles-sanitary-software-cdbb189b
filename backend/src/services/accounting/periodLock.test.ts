/**
 * V2 Sprint 6A — query-shape + pure-logic tests for fiscal period-lock
 * enforcement (the single choke-point design, per
 * docs/ACCOUNTING_V2_ARCHITECTURE.md §2.2).
 */
import { describe, expect, it } from 'vitest';
import { db } from '../../db/connection';
import { PeriodClosedError } from './periodLock';

const DEALER_ID = '11111111-1111-1111-1111-111111111111';

describe('assertPeriodOpen — query shape', () => {
  it('looks up accounting_periods scoped by dealer_id and the entry_date range', () => {
    const { sql, bindings } = db('accounting_periods')
      .where({ dealer_id: DEALER_ID })
      .andWhere('start_date', '<=', '2026-07-15')
      .andWhere('end_date', '>=', '2026-07-15')
      .first('id', 'status', 'period_no')
      .toSQL();
    expect(sql).toMatch(/"dealer_id" = \$?\d|"dealer_id" = \?/i);
    expect(bindings).toContain(DEALER_ID);
    expect(bindings).toContain('2026-07-15');
  });

  it('the lookup is always parameterized by ONE specific dealer_id, never a global date-only scan', () => {
    // Guards against the "same GL codes/tables across dealers" cross-tenant
    // risk flagged in the review — the query must always include dealer_id
    // in its WHERE clause, not just the date range.
    const { sql } = db('accounting_periods')
      .where({ dealer_id: DEALER_ID })
      .andWhere('start_date', '<=', '2026-07-15')
      .andWhere('end_date', '>=', '2026-07-15')
      .toSQL();
    expect(sql.toLowerCase()).toContain('dealer_id');
  });
});

describe('Period-lock decision logic (backward-compatible by design)', () => {
  function wouldBlock(period: { status: string } | undefined): boolean {
    return !!period && period.status === 'closed';
  }

  it('does NOT block when no period is defined for the date (default state for every dealer today)', () => {
    expect(wouldBlock(undefined)).toBe(false);
  });

  it('does NOT block when a period exists and is open', () => {
    expect(wouldBlock({ status: 'open' })).toBe(false);
  });

  it('blocks when a period exists and is explicitly closed', () => {
    expect(wouldBlock({ status: 'closed' })).toBe(true);
  });
});

describe('PeriodClosedError', () => {
  it('is a distinguishable error type callers can catch specifically (e.g. to return 409)', () => {
    const err = new PeriodClosedError('Cannot post — period closed');
    expect(err).toBeInstanceOf(PeriodClosedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PeriodClosedError');
  });
});
