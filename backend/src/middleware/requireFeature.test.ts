import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mutable env so we can flip enforcement mode per test.
const { envHolder } = vi.hoisted(() => ({ envHolder: { FEATURE_ENFORCEMENT: 'log' as string } }));
vi.mock('../config/env', () => ({ env: envHolder }));

// Mock only getEntitlements (DB); keep the real hasFeature / featureForPath / map.
vi.mock('../services/entitlementsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/entitlementsService')>();
  return { ...actual, getEntitlements: vi.fn() };
});

import { enforcePlanFeatures, requireFeature } from './requireFeature';
import { getEntitlements, type Entitlements } from '../services/entitlementsService';

const FULL_OFF: Entitlements = {
  maxWarehouses: 1, maxBranches: 1, maxStaffUsers: 3,
  whatsappEnabled: false, hrmEnabled: false, campaignsEnabled: false,
  portalEnabled: false, advancedFinanceEnabled: false, advancedReportsEnabled: false,
  posEnabled: true, barcodeEnabled: false, leadsEnabled: false,
  projectsEnabled: false, quotationsEnabled: true, backordersEnabled: false,
};

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function mkReq(over: Partial<Request> = {}): Request {
  return { method: 'POST', originalUrl: '/api/projects', user: { roles: ['dealer_admin'], dealerId: 'd1' }, ...over } as unknown as Request;
}

beforeEach(() => {
  envHolder.FEATURE_ENFORCEMENT = 'log';
  vi.mocked(getEntitlements).mockReset();
});

describe('enforcePlanFeatures (central gate)', () => {
  it('is a no-op when mode = off', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'off';
    const req = mkReq(); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it('bypasses super_admin', async () => {
    const req = mkReq({ user: { roles: ['super_admin'], dealerId: null } as any });
    const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it('skips ungated (core) paths', async () => {
    const req = mkReq({ originalUrl: '/api/sales' });
    const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it('log mode: gated + feature OFF → allows (dry-run) but does not 403', async () => {
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const req = mkReq(); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('enforce mode: gated + feature OFF + POST → 403 FEATURE_NOT_IN_PLAN', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const req = mkReq(); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FEATURE_NOT_IN_PLAN', feature: 'projectsEnabled' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('enforce mode: gated + feature OFF + GET → allowed (reads never blocked)', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const req = mkReq({ method: 'GET' }); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('enforce mode: gated + feature ON → allowed', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockResolvedValue({ ...FULL_OFF, projectsEnabled: true });
    const req = mkReq(); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails open when entitlements lookup throws', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockRejectedValue(new Error('db down'));
    const req = mkReq(); const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('longest-prefix match: /api/reports/projects resolves to projectsEnabled', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const req = mkReq({ method: 'GET', originalUrl: '/api/reports/projects/site-summary' });
    const res = mockRes(); const next = vi.fn() as NextFunction;
    await enforcePlanFeatures(req, res, next);
    // GET → allowed, but confirm it recognised the gated path (entitlements consulted)
    expect(getEntitlements).toHaveBeenCalledWith('d1');
    expect(next).toHaveBeenCalled();
  });
});

describe('requireFeature (per-route guard)', () => {
  it('enforce + missing feature + POST → 403', async () => {
    envHolder.FEATURE_ENFORCEMENT = 'enforce';
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const mw = requireFeature('hrmEnabled', 'HR');
    const req = mkReq({ originalUrl: '/api/employees' }); const res = mockRes(); const next = vi.fn() as NextFunction;
    await mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('log mode: missing feature → allowed (dry-run)', async () => {
    vi.mocked(getEntitlements).mockResolvedValue(FULL_OFF);
    const mw = requireFeature('hrmEnabled', 'HR');
    const req = mkReq({ originalUrl: '/api/employees' }); const res = mockRes(); const next = vi.fn() as NextFunction;
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
