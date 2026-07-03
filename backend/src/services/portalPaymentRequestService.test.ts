import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const chain = () => {
    const c: any = {
      where: vi.fn(() => c),
      first: vi.fn(),
      insert: vi.fn(() => c),
      returning: vi.fn(),
    };
    return c;
  };
  return { dbFn: vi.fn(() => chain()), chain };
});

vi.mock('../db/connection', () => ({
  db: mockDb.dbFn,
}));

import { submitPortalPaymentRequest } from './portalPaymentRequestService';

describe('portalPaymentRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dbFn.mockImplementation(() => mockDb.chain());
  });

  it('rejects zero amount', async () => {
    await expect(
      submitPortalPaymentRequest(
        { dealerId: 'd1', customerId: 'c1', portalUserId: 'pu1' },
        { amount: 0, payment_mode: 'cash' },
      ),
    ).rejects.toThrow('greater than zero');
  });

  it('requires reference for bkash', async () => {
    await expect(
      submitPortalPaymentRequest(
        { dealerId: 'd1', customerId: 'c1', portalUserId: 'pu1' },
        { amount: 500, payment_mode: 'bkash' },
      ),
    ).rejects.toThrow('reference');
  });

  it('inserts a valid payment request', async () => {
    const c = mockDb.chain();
    c.returning.mockResolvedValueOnce([{ id: 'pr1' }]);
    mockDb.dbFn.mockReturnValue(c);

    const id = await submitPortalPaymentRequest(
      { dealerId: 'd1', customerId: 'c1', portalUserId: 'pu1' },
      { amount: 1500, payment_mode: 'bkash', reference_no: 'TRX123' },
    );

    expect(id).toBe('pr1');
    expect(c.insert).toHaveBeenCalled();
  });
});
