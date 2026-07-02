import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { tenantGuard, assertDealerMatch } from '../middleware/tenant';

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    query: {},
    body: {},
    params: {},
    ...overrides,
  } as Request;
}

describe('tenantGuard', () => {
  it('returns 401 when user is missing', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    tenantGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets dealerId from JWT for dealer users', () => {
    const req = mockReq({
      user: {
        userId: 'u1',
        email: 'a@b.com',
        dealerId: 'dealer-1',
        roles: ['dealer_admin'],
      },
    });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    tenantGuard(req, res, next);

    expect(req.dealerId).toBe('dealer-1');
    expect(next).toHaveBeenCalled();
  });

  it('allows super_admin with query dealer_id', () => {
    const req = mockReq({
      user: {
        userId: 'sa1',
        email: 'sa@b.com',
        dealerId: null,
        roles: ['super_admin'],
      },
      query: { dealer_id: 'dealer-99' },
    });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    tenantGuard(req, res, next);

    expect(req.dealerId).toBe('dealer-99');
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when dealer user has no dealerId', () => {
    const req = mockReq({
      user: {
        userId: 'u1',
        email: 'a@b.com',
        dealerId: null,
        roles: ['salesman'],
      },
    });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    tenantGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('assertDealerMatch', () => {
  it('passes when claimed dealer_id matches JWT', () => {
    const req = mockReq({
      user: {
        userId: 'u1',
        email: 'a@b.com',
        dealerId: 'dealer-1',
        roles: ['dealer_admin'],
      },
      body: { dealer_id: 'dealer-1' },
    });
    req.dealerId = 'dealer-1';
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    assertDealerMatch(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks horizontal privilege escalation', () => {
    const req = mockReq({
      user: {
        userId: 'u1',
        email: 'a@b.com',
        dealerId: 'dealer-1',
        roles: ['dealer_admin'],
      },
      body: { dealer_id: 'dealer-other' },
    });
    req.dealerId = 'dealer-1';
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    assertDealerMatch(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows super_admin to operate on any dealer', () => {
    const req = mockReq({
      user: {
        userId: 'sa1',
        email: 'sa@b.com',
        dealerId: null,
        roles: ['super_admin'],
      },
      body: { dealer_id: 'dealer-other' },
    });
    const res = mockRes();
    const next = vi.fn() as NextFunction;

    assertDealerMatch(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
