import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';

export interface PortalContext {
  portalUserId: string;
  dealerId: string;
  customerId: string;
  portalRole: string;
  name: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      portalContext?: PortalContext;
    }
  }
}

/** Require an active portal_users row linked to the authenticated VPS user. */
export async function portalGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const row = await db('portal_users')
      .where({ auth_user_id: req.user.userId, status: 'active' })
      .first('id', 'dealer_id', 'customer_id', 'portal_role', 'name', 'email');

    if (!row) {
      res.status(403).json({ error: 'Not an active portal user' });
      return;
    }

    req.portalContext = {
      portalUserId: row.id,
      dealerId: row.dealer_id,
      customerId: row.customer_id,
      portalRole: row.portal_role,
      name: row.name,
      email: row.email,
    };
    next();
  } catch (err: any) {
    console.error('[portalGuard]', err.message);
    res.status(500).json({ error: 'Failed to resolve portal context' });
  }
}
