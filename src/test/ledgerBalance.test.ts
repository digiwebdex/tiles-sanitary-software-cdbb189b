import { describe, expect, it } from 'vitest';
import {
  computeCustomerBalance,
  computeSupplierBalance,
  computeSupplierOutstanding,
} from '../../backend/src/lib/ledgerBalance';

describe('ledgerBalance', () => {
  describe('computeCustomerBalance', () => {
    it('sale minus payment gives correct due', () => {
      const balance = computeCustomerBalance([
        { type: 'sale', amount: 10000 },
        { type: 'payment', amount: 3000 },
      ]);
      expect(balance).toBe(7000);
    });

    it('sale minus refund reduces balance', () => {
      const balance = computeCustomerBalance([
        { type: 'sale', amount: 10000 },
        { type: 'refund', amount: 1500 },
      ]);
      expect(balance).toBe(8500);
    });

    it('positive payment at sale create (go-forward convention)', () => {
      const balance = computeCustomerBalance([
        { type: 'sale', amount: 10000 },
        { type: 'payment', amount: 2000 },
      ]);
      expect(balance).toBe(8000);
    });
  });

  describe('computeSupplierBalance', () => {
    it('purchase (negative) minus payment gives payable', () => {
      const balance = computeSupplierBalance([
        { type: 'purchase', amount: -50000 },
        { type: 'payment', amount: 20000 },
      ]);
      expect(balance).toBe(30000);
    });

    it('purchase return refund reduces payable', () => {
      const balance = computeSupplierBalance([
        { type: 'purchase', amount: -50000 },
        { type: 'payment', amount: 20000 },
        { type: 'refund', amount: 5000 },
      ]);
      expect(balance).toBe(25000);
    });

    it('outstanding is zero when fully paid', () => {
      const rows = [
        { type: 'purchase', amount: -10000 },
        { type: 'payment', amount: 10000 },
      ];
      expect(computeSupplierBalance(rows)).toBe(0);
      expect(computeSupplierOutstanding(rows)).toBe(0);
    });
  });
});
