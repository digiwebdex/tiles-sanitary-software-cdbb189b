import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret-minimum-32-characters!!';

vi.mock('../config/env', () => ({
  env: { JWT_SECRET },
}));

vi.mock('../services/authService', () => ({
  authService: {
    verifyAccessToken: vi.fn(),
  },
}));

import { authenticate } from './auth';
import { authService } from '../services/authService';

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('authenticate middleware', () => {
  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header is not Bearer', () => {
    const req = { headers: { authorization: 'Basic abc' } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('attaches user and calls next on valid token', () => {
    const payload = {
      userId: 'u1',
      email: 'a@b.com',
      dealerId: 'd1',
      roles: ['dealer_admin'],
    };
    vi.mocked(authService.verifyAccessToken).mockReturnValue(payload);

    const token = jwt.sign(payload, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    authenticate(req, res, next);

    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when token verification throws', () => {
    vi.mocked(authService.verifyAccessToken).mockImplementation(() => {
      throw new Error('expired');
    });

    const req = { headers: { authorization: 'Bearer bad.token.here' } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
