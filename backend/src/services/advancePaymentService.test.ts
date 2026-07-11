import { describe, expect, it } from 'vitest';
import { computeUnappliedBalance } from './advancePaymentService';

describe('computeUnappliedBalance (V2 Sprint 4C — Advance Payment)', () => {
  it('subtracts applied from received', () => {
    expect(computeUnappliedBalance(1000, 400)).toBe(600);
  });

  it('never returns negative even if applied exceeds received (data anomaly)', () => {
    expect(computeUnappliedBalance(100, 300)).toBe(0);
  });

  it('returns 0 when nothing has been received', () => {
    expect(computeUnappliedBalance(0, 0)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    expect(computeUnappliedBalance(100.005, 0.001)).toBeCloseTo(100.0, 2);
  });
});
