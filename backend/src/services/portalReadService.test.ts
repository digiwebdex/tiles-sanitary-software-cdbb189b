import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const chain = () => {
    const c: any = {
      where: vi.fn(() => c),
      join: vi.fn(() => c),
      orderBy: vi.fn(() => c),
      first: vi.fn(),
      select: vi.fn(() => c),
    };
    return c;
  };
  return { dbFn: vi.fn(() => chain()), chain };
});

vi.mock('../db/connection', () => ({
  db: mockDb.dbFn,
}));

import {
  computeCustomerBalance,
} from '../lib/ledgerBalance';
import {
  getPortalQuotationDoc,
  getPortalWhatsAppStatus,
} from './portalReadService';

describe('portal outstanding math', () => {
  it('matches ledger balance convention for portal summary', () => {
    const rows = [
      { type: 'sale', amount: 1000 },
      { type: 'payment', amount: 400 },
      { type: 'adjustment', amount: 50 },
    ];
    expect(computeCustomerBalance(rows)).toBe(650);
  });
});

describe('portal document reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dbFn.mockImplementation(() => mockDb.chain());
  });

  it('rejects quotation doc outside customer scope', async () => {
    const c = mockDb.chain();
    c.first.mockResolvedValueOnce(undefined);
    mockDb.dbFn.mockReturnValue(c);

    await expect(getPortalQuotationDoc('d1', 'c1', 'q1')).rejects.toThrow('forbidden');
  });

  it('returns null whatsapp status when source is out of scope', async () => {
    const c = mockDb.chain();
    c.first.mockResolvedValueOnce({ customer_id: 'other-customer' });
    mockDb.dbFn.mockReturnValue(c);

    const status = await getPortalWhatsAppStatus('d1', 'c1', 'sale', 's1');
    expect(status).toBeNull();
  });
});
