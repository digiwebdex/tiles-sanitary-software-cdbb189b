import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { JWT_SECRET, JWT_REFRESH_SECRET } = vi.hoisted(() => ({
  JWT_SECRET: 'test-jwt-secret-minimum-32-characters!!',
  JWT_REFRESH_SECRET: 'test-refresh-secret-min-32-chars-long!!',
}));

vi.mock('../config/env', () => ({
  env: {
    JWT_SECRET,
    JWT_REFRESH_SECRET,
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  },
}));

import { authService } from './authService';

describe('authService', () => {
  describe('password hashing', () => {
    it('hashes and verifies a password', async () => {
      const hash = await authService.hashPassword('MySecureP@ss1');
      expect(hash).not.toBe('MySecureP@ss1');
      expect(await authService.verifyPassword('MySecureP@ss1', hash)).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await authService.hashPassword('correct');
      expect(await authService.verifyPassword('wrong', hash)).toBe(false);
    });
  });

  describe('verifyAccessToken', () => {
    it('decodes a valid JWT payload', () => {
      const payload = {
        userId: 'u1',
        email: 'user@example.com',
        dealerId: 'd1',
        roles: ['dealer_admin'],
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
      expect(authService.verifyAccessToken(token)).toMatchObject(payload);
    });

    it('throws on invalid token', () => {
      expect(() => authService.verifyAccessToken('not-a-jwt')).toThrow();
    });

    it('throws on token signed with wrong secret', () => {
      const token = jwt.sign({ userId: 'u1' }, 'wrong-secret-at-least-32-characters', {
        expiresIn: '15m',
      });
      expect(() => authService.verifyAccessToken(token)).toThrow();
    });
  });
});
