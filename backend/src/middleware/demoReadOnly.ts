import { Request, Response, NextFunction } from 'express';

/**
 * Phase A — Demo account read-only enforcement.
 *
 * Blocks every state-changing HTTP method (POST/PUT/PATCH/DELETE) for users
 * whose JWT carries `isDemo: true` (i.e. they belong to a dealer flagged
 * `is_demo = true` in the database).
 *
 * Allow-list:
 *   - All GET / HEAD / OPTIONS requests
 *   - Anything under `/api/auth/*` (login, refresh, logout, lock-status, me, password reset)
 *   - The legacy `logout-all` and the impersonation surface — those are
 *     session controls, not data mutations
 *   - Health checks
 *
 * Super admins are never affected (they should never present a demo JWT,
 * but we double-check by role just in case).
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ALLOW_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/signup',
];

export function demoReadOnly(req: Request, res: Response, next: NextFunction): void {
  // No user yet (unauthenticated) → let downstream auth handle it
  if (!req.user) {
    next();
    return;
  }

  // Super admin — never blocked
  if (req.user.roles?.includes('super_admin')) {
    next();
    return;
  }

  // Not a demo tenant → carry on
  if (!req.user.isDemo) {
    next();
    return;
  }

  // Safe methods always allowed
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  // Allow-listed prefixes (auth/session/health)
  const path = req.originalUrl.split('?')[0];
  if (ALLOW_PREFIXES.some((p) => path.startsWith(p))) {
    next();
    return;
  }

  res.status(403).json({
    error: 'This is a read-only demo account. Sign up for your own account to make changes.',
    code: 'DEMO_READ_ONLY',
  });
}
