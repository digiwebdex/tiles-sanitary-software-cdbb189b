import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { AUTH_BACKEND: 'vps' },
}));

vi.mock('@/lib/saImpersonation', () => ({
  saImpersonation: { get: () => null },
}));

describe('userFromAccessToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('decodes dealerId from JWT payload', async () => {
    const payload = btoa(
      JSON.stringify({
        userId: 'u1',
        email: 'test@example.com',
        dealerId: 'd1',
        roles: ['dealer_admin'],
      }),
    );
    const token = `hdr.${payload}.sig`;
    localStorage.setItem('vps.accessToken', token);

    const { userFromAccessToken } = await import('@/lib/vpsAuthClient');
    const user = userFromAccessToken();
    expect(user?.dealerId).toBe('d1');
    expect(user?.roles).toContain('dealer_admin');
  });
});
