import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockMe = vi.fn();
const mockResolveVpsUser = vi.fn();
const mockSetUser = vi.fn();
const mockAccess = vi.fn();

vi.mock('@/lib/vpsAuthClient', () => ({
  vpsAuthApi: { me: (...args: unknown[]) => mockMe(...args) },
  vpsTokenStore: {
    get access() {
      return mockAccess();
    },
    setUser: (...args: unknown[]) => mockSetUser(...args),
    get user() {
      return mockResolveVpsUser();
    },
  },
  resolveVpsUser: (...args: unknown[]) => mockResolveVpsUser(...args),
  userFromAccessToken: vi.fn(() => null),
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

  it('returns dealerId from resolveVpsUser when present', async () => {
    mockResolveVpsUser.mockReturnValue({
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

  it('falls back to vpsAuthApi.me when resolveVpsUser returns null', async () => {
    mockResolveVpsUser.mockReturnValue(null);
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
    expect(mockSetUser).toHaveBeenCalled();
  });

  it('throws session expired when no user and no token', async () => {
    mockResolveVpsUser.mockReturnValue(null);
    mockAccess.mockReturnValue(null);

    const { getAuthenticatedDealerId } = await import('@/lib/tenancy');
    await expect(getAuthenticatedDealerId()).rejects.toThrow('Session expired');
  });
});
