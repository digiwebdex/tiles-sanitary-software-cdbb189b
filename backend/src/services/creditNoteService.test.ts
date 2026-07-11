import { describe, expect, it } from 'vitest';
import { computeUnappliedCreditNoteBalance } from './creditNoteService';

describe('computeUnappliedCreditNoteBalance (V2 Sprint 4D — Credit Note)', () => {
  it('subtracts applied from received', () => {
    expect(computeUnappliedCreditNoteBalance(1000, 400)).toBe(600);
  });

  it('never returns negative even if applied exceeds received (data anomaly)', () => {
    expect(computeUnappliedCreditNoteBalance(100, 300)).toBe(0);
  });

  it('returns 0 when nothing has been received', () => {
    expect(computeUnappliedCreditNoteBalance(0, 0)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeUnappliedCreditNoteBalance(100.005, 0.001)).toBeCloseTo(100.0, 2);
  });
});
