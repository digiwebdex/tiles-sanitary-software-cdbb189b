/**
 * Plan / feature enforcement middleware — Sprint 1 (V2 Foundation).
 *
 * Two entry points, both ADDITIVE and backward-compatible:
 *
 *   1. enforcePlanFeatures  — a single app-level middleware (mounted once in
 *      index.ts) that maps request paths → required plan feature via
 *      FEATURE_ROUTE_MAP and enforces the dealer's entitlements centrally.
 *      No per-route churn across 89 files.
 *
 *   2. requireFeature(key)  — an explicit per-route guard for cases that want
 *      to opt in individually.
 *
 * Behaviour is governed by env.FEATURE_ENFORCEMENT:
 *   off     → no-op.
 *   log     → resolve entitlements and console.warn a would-be block, but ALWAYS
 *             call next() (DRY-RUN; the shipping default → zero prod impact).
 *   enforce → block state-changing requests (non-GET) with HTTP 403 when the
 *             dealer's plan lacks the feature. GET/HEAD/OPTIONS always pass so
 *             users can still view and reach the upgrade flow.
 *
 * Bypasses: super_admin, sa_employee, unauthenticated / no-dealer requests
 * (their own auth/tenant guards handle them). Fails OPEN on any error so a
 * transient DB hiccup never locks out a paying dealer.
 */
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import {
  getEntitlements,
  hasFeature,
  featureForPath,
  type FeatureKey,
} from '../services/entitlementsService';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isBypassRole(req: Request): boolean {
  const roles = req.user?.roles ?? [];
  return roles.includes('super_admin') || roles.includes('sa_employee');
}

function deny(res: Response, feature: FeatureKey, label: string): void {
  res.status(403).json({
    error: `${label} is not included in your current plan. Please upgrade to use this feature.`,
    code: 'FEATURE_NOT_IN_PLAN',
    feature,
  });
}

/** Central path→feature enforcement. Mount once, after auth is decoded. */
export async function enforcePlanFeatures(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const mode = env.FEATURE_ENFORCEMENT;
    if (mode === 'off') return next();

    if (isBypassRole(req)) return next();

    const dealerId = req.user?.dealerId;
    if (!dealerId) return next(); // unauthenticated / SA / portal → not our concern

    const path = req.originalUrl.split('?')[0];
    const match = featureForPath(path);
    if (!match) return next(); // core module, not gated

    const ent = await getEntitlements(dealerId);
    if (hasFeature(ent, match.feature)) return next(); // entitled

    // Not entitled.
    if (mode === 'log' || SAFE_METHODS.has(req.method)) {
      // DRY-RUN, or a read in enforce mode → allow but record.
      console.warn(
        `[feature-enforcement:${mode}] dealer=${dealerId} ${req.method} ${path} ` +
          `→ would block (missing ${match.feature})`,
      );
      return next();
    }
    // enforce + state-changing → block.
    console.warn(
      `[feature-enforcement:enforce] dealer=${dealerId} ${req.method} ${path} ` +
        `→ BLOCKED (missing ${match.feature})`,
    );
    return deny(res, match.feature, match.label);
  } catch (err) {
    console.error('[enforcePlanFeatures] fail-open:', (err as Error)?.message);
    return next(); // fail open
  }
}

/** Explicit per-route guard, e.g. router.post('/x', requireFeature('projectsEnabled'), ...) */
export function requireFeature(feature: FeatureKey, label = 'This feature') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const mode = env.FEATURE_ENFORCEMENT;
      if (mode === 'off') return next();
      if (isBypassRole(req)) return next();

      const dealerId = req.user?.dealerId;
      if (!dealerId) return next();

      const ent = await getEntitlements(dealerId);
      if (hasFeature(ent, feature)) return next();

      if (mode === 'log' || SAFE_METHODS.has(req.method)) {
        console.warn(
          `[feature-enforcement:${mode}] dealer=${dealerId} ${req.method} ${req.originalUrl} ` +
            `→ would block (missing ${feature})`,
        );
        return next();
      }
      return deny(res, feature, label);
    } catch (err) {
      console.error('[requireFeature] fail-open:', (err as Error)?.message);
      return next();
    }
  };
}
