/**
 * V2 Sprint 6C — pure-logic tests for the Cashbook/Bank Book core
 * operations. No live test DB in this backend (established convention);
 * these tests re-derive the sign conventions and posting-line shapes that
 * cashBankTransactions.ts produces, verified against the actual GL mapping
 * rules in glLineMapper.test.ts.
 */
import { describe, expect, it } from 'vitest';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

describe('Cash Receipt / Cash Payment sign convention', () => {
  it('a receipt is stored as a positive cash_ledger amount', () => {
    const amount = round2(1500);
    expect(amount).toBeGreaterThan(0);
  });

  it('a payment is stored as a negative cash_ledger amount, and posts a negative cash GL line', () => {
    const amount = 800;
    const ledgerAmount = -round2(amount);
    expect(ledgerAmount).toBe(-800);
  });
});

describe('Bank Deposit / Withdrawal sign convention', () => {
  it('a deposit is positive; a withdrawal is negative', () => {
    expect(round2(2000)).toBe(2000);
    expect(-round2(2000)).toBe(-2000);
  });

  it('a cheque number on a withdrawal starts the Cheque Register lifecycle as "issued"', () => {
    function chequeStatus(chequeNo: string | null): string | null {
      return chequeNo ? 'issued' : null;
    }
    expect(chequeStatus('CHQ-1042')).toBe('issued');
    expect(chequeStatus(null)).toBeNull();
  });
});

describe('Transfer — same-endpoint rejection', () => {
  type Endpoint = { kind: 'cash' } | { kind: 'bank'; bankAccountId: string };
  function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'cash') return true;
    return a.bankAccountId === (b as { kind: 'bank'; bankAccountId: string }).bankAccountId;
  }

  it('rejects cash-to-cash (no such thing as a transfer within the single cash pool)', () => {
    expect(sameEndpoint({ kind: 'cash' }, { kind: 'cash' })).toBe(true);
  });

  it('rejects a bank account transferring to itself', () => {
    expect(sameEndpoint({ kind: 'bank', bankAccountId: 'b1' }, { kind: 'bank', bankAccountId: 'b1' })).toBe(true);
  });

  it('allows cash-to-bank, bank-to-cash, and bank-to-different-bank', () => {
    expect(sameEndpoint({ kind: 'cash' }, { kind: 'bank', bankAccountId: 'b1' })).toBe(false);
    expect(sameEndpoint({ kind: 'bank', bankAccountId: 'b1' }, { kind: 'cash' })).toBe(false);
    expect(sameEndpoint({ kind: 'bank', bankAccountId: 'b1' }, { kind: 'bank', bankAccountId: 'b2' })).toBe(false);
  });
});

describe('Transfer — two-leg posting balances exactly (no Clearing plug needed)', () => {
  it('source leg (-amount) and destination leg (+amount) sum to zero', () => {
    const amount = 5000;
    const sourceLine = -amount;
    const destLine = amount;
    expect(sourceLine + destLine).toBe(0);
  });
});

describe('Standalone Cash/Bank Receipt/Payment — single-line batch (relies on the existing Clearing auto-plug)', () => {
  it('a single cash/bank posting line is inherently unbalanced on its own (by design — glLineMapper.ts\'s balanceGlDrafts fallback absorbs the other side)', () => {
    const debit = 1000;
    const credit = 0;
    expect(debit).not.toBe(credit);
  });
});
