import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockMe = vi.fn();
const mockUser = vi.fn();
const mockAccess = vi.fn();

vi.mock('@/lib/vpsAuthClient', () => ({
  vpsAuthApi: { me: (...args: unknown[]) => mockMe(...args) },
  vpsTokenStore: {
    get user() {
      return mockUser();
    },
    get access() {
      return mockAccess();
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: { AUTH_BACKEND: 'vps' },
}));

vi.mock('@/lib/saImpersonation', () => ({
  saImpersonation: { get: () => null },
}));

describe('getAuthenticatedDealerId (VPS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dealerId from vpsTokenStore.user when present', async () => {
    mockUser.mockReturnValue({
      userId: 'u1',
      email: 'a@b.com',
      dealerId: 'd1',
      roles: ['dealer_admin'],
    });
    mockAccess.mockReturnValue('token');

    const { getAuthenticatedDealerId } = await import('@/lib/tenancy');
    await expect(getAuthenticatedDealerId()).resolves.toBe('d1');
    expect(mockMe).not.toHaveBeenCalled();
  });

  it('falls back to vpsAuthApi.me when user missing but access token exists', async () => {
    mockUser.mockReturnValue(null);
    mockAccess.mockReturnValue('token');
    mockMe.mockResolvedValue({
      userId: 'u1',
      email: 'a@b.com',
      dealerId: 'd2',
      roles: ['dealer_admin'],
    });

    const { getAuthenticatedDealerId } = await import('@/lib/tenancy');
    await expect(getAuthenticatedDealerId()).resolves.toBe('d2');
    expect(mockMe).toHaveBeenCalledOnce();
  });

  it('throws Not authenticated when no user and no token', async () => {
    mockUser.mockReturnValue(null);
    mockAccess.mockReturnValue(null);

    const { getAuthenticatedDealerId } = await import('@/lib/tenancy');
    await expect(getAuthenticatedDealerId()).rejects.toThrow('Not authenticated');
  });
});
