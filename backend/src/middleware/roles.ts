import { Request, Response, NextFunction } from 'express';

/**
 * `senior_accountant` and `finance_manager` are new as of V2 Sprint 6A, per
 * the approved docs/ACCOUNTING_V2_ARCHITECTURE.md §4 permission matrix —
 * additive, existing roles/behavior unchanged.
 */
export type AppRole =
  | 'super_admin'
  | 'dealer_admin'
  | 'manager'
  | 'accountant'
  | 'senior_accountant'
  | 'finance_manager'
  | 'salesman'
  | 'sa_employee';

/**
 * Role guard: restricts access to users with at least one of the specified roles.
 */
export function requireRole(...allowedRoles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRoles = req.user.roles as AppRole[];

    // Super admin always passes
    if (userRoles.includes('super_admin')) {
      next();
      return;
    }

    const hasRole = allowedRoles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Helper: check if user has a specific role without blocking.
 */
export function hasRole(req: Request, role: AppRole): boolean {
  return req.user?.roles.includes(role) ?? false;
}

export function isSuperAdmin(req: Request): boolean {
  return hasRole(req, 'super_admin');
}

export function isDealerAdmin(req: Request): boolean {
  return hasRole(req, 'dealer_admin') || isSuperAdmin(req);
}

/**
 * V2 Sprint 6A — restricts `super_admin` from single-dealer financial
 * detail, per docs/ACCOUNTING_V2_ARCHITECTURE.md §4.
 *
 * This does NOT change `requireRole`'s existing unconditional super_admin
 * bypass, and does NOT apply to any pre-existing (non-financial) route —
 * every existing super_admin support/troubleshooting workflow across Sales,
 * Purchase, and Inventory continues to work exactly as before. It is a
 * new, additional guard, applied only to this sprint's own new financial
 * routes (Chart of Accounts, Fiscal Year/Period, Journal, GL Trial
 * Balance), run AFTER `requireRole` in the middleware chain.
 *
 * A super_admin targeting a specific `dealerId` on a route protected by
 * this guard is rejected outright — the corrected, honest alternative to
 * Revision 1's unenforced "no drill-down" claim (see
 * docs/ACCOUNTING_REVIEW_RESPONSE.md, findings #7/#29/#30). A genuine
 * cross-tenant aggregate view for super_admin is a separate, new endpoint
 * modeled on the existing `adminStats.ts` pattern, not this guard.
 */
export function restrictSuperAdminOnFinancials() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isSuper = req.user?.roles.includes('super_admin');
    if (!isSuper) {
      next();
      return;
    }
    const claimedDealerId = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
    if (claimedDealerId) {
      res.status(403).json({
        error: 'Super admin cannot access a single dealer\'s financial data. This boundary is enforced for Accounting Engine routes specifically.',
      });
      return;
    }
    next();
  };
}
