import { Request, Response, NextFunction } from 'express';

export type AppRole = 'super_admin' | 'dealer_admin' | 'manager' | 'accountant' | 'salesman' | 'sa_employee';

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
