import { describe, expect, it } from 'vitest';
import {
  resolveSalePaymentStatus,
  salePaymentStatusLabel,
} from '@/lib/salePaymentStatus';

describe('resolveSalePaymentStatus', () => {
  it('shows Reversed instead of Paid when due is zero on a reversed sale', () => {
    const sale = {
      document_status: 'reversed',
      sale_status: 'cancelled',
      due_amount: 0,
      paid_amount: 5000,
    };
    expect(resolveSalePaymentStatus(sale)).toBe('reversed');
    expect(salePaymentStatusLabel('reversed')).toBe('Reversed');
  });

  it('shows Paid for a normal settled invoice', () => {
    expect(
      resolveSalePaymentStatus({
        document_status: 'posted',
        sale_status: 'invoiced',
        due_amount: 0,
        paid_amount: 1000,
      }),
    ).toBe('paid');
  });

  it('shows Partial when some amount is paid and balance remains', () => {
    expect(
      resolveSalePaymentStatus({
        document_status: 'posted',
        due_amount: 500,
        paid_amount: 500,
      }),
    ).toBe('partial');
  });
});
