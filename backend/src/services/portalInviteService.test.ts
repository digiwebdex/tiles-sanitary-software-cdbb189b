import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const chain = () => {
    const c: any = {
      where: vi.fn(() => c),
      whereIn: vi.fn(() => c),
      first: vi.fn(),
      insert: vi.fn(() => c),
      update: vi.fn(() => c),
      returning: vi.fn(),
    };
    return c;
  };
  const dbFn: any = vi.fn(() => chain());
  dbFn.fn = { now: vi.fn(() => new Date()) };
  return { dbFn, chain };
});

vi.mock('../db/connection', () => ({
  db: mockDb.dbFn,
}));

const mockCreatePortalIdentity = vi.hoisted(() => vi.fn());

vi.mock('./authService', () => ({
  authService: {
    createPortalIdentity: mockCreatePortalIdentity,
  },
}));

import { invitePortalUser } from './portalInviteService';

describe('portalInviteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.dbFn.mockImplementation(() => mockDb.chain());
  });

  it('rejects when customer is not found', async () => {
    const c = mockDb.chain();
    c.first.mockResolvedValueOnce(undefined);
    mockDb.dbFn.mockReturnValueOnce(c);

    await expect(
      invitePortalUser({
        dealerId: 'd1',
        customerId: 'c1',
        email: 'a@b.com',
        name: 'Alice',
        invitedBy: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects duplicate active portal email', async () => {
    const c = mockDb.chain();
    c.first
      .mockResolvedValueOnce({ id: 'c1' })
      .mockResolvedValueOnce({ id: 'pu1', status: 'active' });
    mockDb.dbFn.mockReturnValue(c);

    await expect(
      invitePortalUser({
        dealerId: 'd1',
        customerId: 'c1',
        email: 'a@b.com',
        name: 'Alice',
        invitedBy: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('creates portal identity and inserts portal_users for new email', async () => {
    const c = mockDb.chain();
    c.first
      .mockResolvedValueOnce({ id: 'c1', dealer_id: 'd1', name: 'Cust' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    c.returning.mockResolvedValueOnce([
      {
        id: 'pu-new',
        dealer_id: 'd1',
        customer_id: 'c1',
        email: 'a@b.com',
        name: 'Alice',
        status: 'invited',
      },
    ]);
    mockDb.dbFn.mockReturnValue(c);
    mockCreatePortalIdentity.mockResolvedValueOnce({ id: 'u1' });

    const result = await invitePortalUser({
      dealerId: 'd1',
      customerId: 'c1',
      email: 'a@b.com',
      name: 'Alice',
      invitedBy: 'admin1',
    });

    expect(mockCreatePortalIdentity).toHaveBeenCalled();
    expect(result.portal_user.id).toBe('pu-new');
    expect(result.temp_password).toBeTruthy();
  });
});
