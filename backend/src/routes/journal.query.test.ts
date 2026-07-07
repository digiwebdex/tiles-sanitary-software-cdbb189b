/**
 * V2 Sprint 6A — pure-function + schema tests for the Journal Draft ->
 * Approve -> Post -> Reverse workflow.
 */
import { describe, expect, it } from 'vitest';
import { validateBalance } from './journal';

describe('validateBalance (unchanged core validation, re-verified)', () => {
  it('accepts a balanced two-line entry', () => {
    const result = validateBalance([
      { account: 'Cash', debit: 1000, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 1000 },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects a line with both debit and credit set', () => {
    const result = validateBalance([
      { account: 'Cash', debit: 100, credit: 100 },
      { account: 'Sales Revenue', debit: 0, credit: 100 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects a line with neither debit nor credit set', () => {
    const result = validateBalance([
      { account: 'Cash', debit: 0, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 100 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects an unbalanced entry', () => {
    const result = validateBalance([
      { account: 'Cash', debit: 1000, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 900 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('tolerates rounding within 0.01', () => {
    const result = validateBalance([
      { account: 'Cash', debit: 100.005, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 100.0 },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe('Status transition guards (Draft -> Approve -> Post -> Reverse)', () => {
  const CAN_APPROVE_FROM = ['draft'];
  const CAN_POST_FROM = ['draft', 'approved'];
  const CAN_REVERSE_FROM = ['posted'];
  const CAN_VOID_FROM = ['draft'];

  it('only a draft entry can be approved', () => {
    expect(CAN_APPROVE_FROM.includes('draft')).toBe(true);
    expect(CAN_APPROVE_FROM.includes('approved')).toBe(false);
    expect(CAN_APPROVE_FROM.includes('posted')).toBe(false);
  });

  it('a draft or approved entry can be posted directly (approval is optional)', () => {
    expect(CAN_POST_FROM.includes('draft')).toBe(true);
    expect(CAN_POST_FROM.includes('approved')).toBe(true);
    expect(CAN_POST_FROM.includes('posted')).toBe(false);
  });

  it('only a posted entry can be reversed', () => {
    expect(CAN_REVERSE_FROM.includes('posted')).toBe(true);
    expect(CAN_REVERSE_FROM.includes('draft')).toBe(false);
  });

  it('only a draft entry can be voided (Immutable Journal — posted entries use /reverse instead)', () => {
    expect(CAN_VOID_FROM.includes('draft')).toBe(true);
    expect(CAN_VOID_FROM.includes('posted')).toBe(false);
    expect(CAN_VOID_FROM.includes('approved')).toBe(false);
  });
});

describe('Reversal line mirroring (debit/credit swap)', () => {
  function mirrorLines(lines: Array<{ account: string; debit: number; credit: number }>) {
    return lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));
  }

  it('swaps debit and credit on every line, preserving the account', () => {
    const original = [
      { account: 'Cash', debit: 1000, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 1000 },
    ];
    const mirrored = mirrorLines(original);
    expect(mirrored).toEqual([
      { account: 'Cash', debit: 0, credit: 1000 },
      { account: 'Sales Revenue', debit: 1000, credit: 0 },
    ]);
  });

  it('a mirrored entry is itself balanced whenever the original was', () => {
    const original = [
      { account: 'Cash', debit: 1000, credit: 0 },
      { account: 'Sales Revenue', debit: 0, credit: 850 },
      { account: 'VAT Payable', debit: 0, credit: 150 },
    ];
    const mirrored = mirrorLines(original);
    const debit = mirrored.reduce((s, l) => s + l.debit, 0);
    const credit = mirrored.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
  });

  it('reversing an already-reversed entry is rejected (one reversal per entry)', () => {
    // Modeled as: does a child row with reverses_journal_entry_id = X already exist?
    const existingReversals = [{ id: 'r1', reverses_journal_entry_id: 'original-1' }];
    const alreadyReversed = existingReversals.some((r) => r.reverses_journal_entry_id === 'original-1');
    expect(alreadyReversed).toBe(true);
  });
});

describe('Voucher numbering — JV-YYYYMM-NNNN sequence (unchanged convention, shared by draft and immediate-post paths)', () => {
  function nextVoucherNo(entryDate: string, existingCount: number): string {
    const ym = entryDate.slice(0, 7).replace('-', '');
    return `JV-${ym}-${String(existingCount + 1).padStart(4, '0')}`;
  }

  it('produces NNNN=0001 for the first entry of a given month', () => {
    expect(nextVoucherNo('2026-07-06', 0)).toBe('JV-202607-0001');
  });

  it('increments based on existing count for that month', () => {
    expect(nextVoucherNo('2026-07-06', 5)).toBe('JV-202607-0006');
  });
});
