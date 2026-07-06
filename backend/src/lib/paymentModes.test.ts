import { describe, expect, it } from 'vitest';
import {
  normalizePaymentMode,
  paymentModeLabel,
  paymentModeRequiresBankAccount,
  receiptPostingLineType,
  PAYMENT_MODE_IDS,
} from './paymentModes';

describe('paymentModes — Rocket (V2 Sprint 4C)', () => {
  it('includes rocket in the supported mode list', () => {
    expect(PAYMENT_MODE_IDS).toContain('rocket');
  });

  it('normalizes "rocket" (any case/whitespace) to the canonical id', () => {
    expect(normalizePaymentMode('Rocket')).toBe('rocket');
    expect(normalizePaymentMode(' rocket ')).toBe('rocket');
  });

  it('does not require a bank account for rocket (it is a mobile wallet, not bank/cheque/card)', () => {
    expect(paymentModeRequiresBankAccount('rocket')).toBe(false);
  });

  it('has a human-readable label', () => {
    expect(paymentModeLabel('rocket')).toBe('Rocket');
  });

  it('gets its own posting line-type suffix, distinct from bkash/nagad', () => {
    expect(receiptPostingLineType('receipt', 'rocket')).toBe('receipt_rocket');
    expect(receiptPostingLineType('receipt', 'bkash')).toBe('receipt_bkash');
  });
});
