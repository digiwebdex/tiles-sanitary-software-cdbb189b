import { describe, expect, it } from 'vitest';
import {
  buildCustomerPaymentLines,
  buildPurchaseLedgerLines,
  buildSaleLedgerLines,
  buildSupplierPaymentLines,
} from '../../backend/src/services/posting/LedgerPostingEngine';

describe('LedgerPostingEngine', () => {
  describe('buildPurchaseLedgerLines', () => {
    it('emits supplier purchase line with negative amount', () => {
      const lines = buildPurchaseLedgerLines({
        purchaseId: 'pur-1',
        supplierId: 'sup-1',
        entryDate: '2026-06-01',
        netPayable: 50000,
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        lineDomain: 'supplier',
        lineType: 'purchase',
        amount: -50000,
        partyId: 'sup-1',
        purchaseId: 'pur-1',
      });
    });

    it('adds payment + cash outflow when paid on create', () => {
      const lines = buildPurchaseLedgerLines({
        purchaseId: 'pur-2',
        supplierId: 'sup-2',
        entryDate: '2026-06-01',
        netPayable: 10000,
        paidOnCreate: 3000,
      });

      expect(lines).toHaveLength(3);
      expect(lines[1]).toMatchObject({
        lineDomain: 'supplier',
        lineType: 'payment',
        amount: 3000,
      });
      expect(lines[2]).toMatchObject({
        lineDomain: 'cash',
        lineType: 'payment',
        amount: -3000,
      });
    });

    it('tags bKash receipts with receipt_bkash line type and metadata', () => {
      const lines = buildSaleLedgerLines({
        saleId: 'sale-bkash',
        customerId: 'cust-1',
        entryDate: '2026-06-02',
        totalAmount: 5000,
        paidAmount: 5000,
        paymentMode: 'bkash',
      });

      expect(lines[2]).toMatchObject({
        lineDomain: 'cash',
        lineType: 'receipt_bkash',
        amount: 5000,
        metadata: { payment_mode: 'bkash', payment_channel: 'bKash' },
      });
    });

    it('uses bank domain when paid_account_id is set', () => {
      const lines = buildPurchaseLedgerLines({
        purchaseId: 'pur-3',
        supplierId: 'sup-3',
        entryDate: '2026-06-01',
        netPayable: 8000,
        paidOnCreate: 8000,
        paidAccountId: 'bank-acct-1',
      });

      expect(lines[2]).toMatchObject({
        lineDomain: 'bank',
        amount: -8000,
      });
      expect(lines[2].metadata?.bank_account_id).toBe('bank-acct-1');
    });
  });

  describe('buildSaleLedgerLines', () => {
    it('emits customer sale line with positive amount', () => {
      const lines = buildSaleLedgerLines({
        saleId: 'sale-1',
        customerId: 'cust-1',
        entryDate: '2026-06-02',
        totalAmount: 15000,
      });

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        lineDomain: 'customer',
        lineType: 'sale',
        amount: 15000,
        partyId: 'cust-1',
        saleId: 'sale-1',
      });
    });

    it('adds payment + cash receipt when paid at sale', () => {
      const lines = buildSaleLedgerLines({
        saleId: 'sale-2',
        customerId: 'cust-2',
        entryDate: '2026-06-02',
        totalAmount: 20000,
        paidAmount: 5000,
      });

      expect(lines).toHaveLength(3);
      expect(lines[1]).toMatchObject({
        lineDomain: 'customer',
        lineType: 'payment',
        amount: 5000,
      });
      expect(lines[2]).toMatchObject({
        lineDomain: 'cash',
        lineType: 'receipt',
        amount: 5000,
      });
    });
  });

  describe('buildCustomerPaymentLines', () => {
    it('emits one customer line per allocation plus receipt', () => {
      const lines = buildCustomerPaymentLines({
        customerId: 'cust-3',
        entryDate: '2026-06-03',
        allocations: [
          { saleId: 'sale-a', amount: 2000 },
          { saleId: 'sale-b', amount: 3000 },
        ],
        totalApplied: 5000,
      });

      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatchObject({
        lineDomain: 'customer',
        lineType: 'payment',
        amount: 2000,
        saleId: 'sale-a',
      });
      expect(lines[1]).toMatchObject({
        saleId: 'sale-b',
        amount: 3000,
      });
      expect(lines[2]).toMatchObject({
        lineDomain: 'cash',
        lineType: 'receipt',
        amount: 5000,
      });
    });
  });

  describe('buildSupplierPaymentLines', () => {
    it('emits one supplier line per allocation plus cash outflow', () => {
      const lines = buildSupplierPaymentLines({
        supplierId: 'sup-4',
        entryDate: '2026-06-04',
        allocations: [{ purchaseId: 'pur-a', amount: 4000 }],
        totalApplied: 4000,
      });

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        lineDomain: 'supplier',
        lineType: 'payment',
        amount: 4000,
        purchaseId: 'pur-a',
      });
      expect(lines[1]).toMatchObject({
        lineDomain: 'cash',
        lineType: 'payment',
        amount: -4000,
      });
    });
  });
});
