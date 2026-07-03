/**
 * Team / Role Management — dealer-scoped team member CRUD.
 *
 *   GET    /api/team             list members + role + status + role counts
 *   POST   /api/team             invite new member
 *   PUT    /api/team/:userId     change role / status / name
 *   DELETE /api/team/:userId     soft-deactivate (status = 'inactive')
 *
 * Dealer admin only. Tenant-scoped: never returns or touches profiles
 * outside `req.dealerId`. Owner accounts (`dealer_admin`) cannot be
 * demoted or deactivated through this surface.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import { authService } from '../services/authService';

const router = Router();
router.use(authenticate, tenantGuard, requireRole('dealer_admin'));

type AppRole = 'dealer_admin' | 'manager' | 'accountant' | 'salesman';

const ASSIGNABLE_ROLES: AppRole[] = ['dealer_admin', 'manager', 'accountant', 'salesman'];

function ensureDealer(req: Request, res: Response): string | null {
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  return req.dealerId;
}

// ── GET /api/team ──
router.get('/', async (req: Request, res: Response) => {
  const dealerId = ensureDealer(req, res);
  if (!dealerId) return;

  const members = await db('profiles as p')
    .leftJoin('user_roles as ur', 'ur.user_id', 'p.id')
    .where('p.dealer_id', dealerId)
    .whereIn('ur.role', ASSIGNABLE_ROLES)
    .select(
      'p.id',
      'p.name',
      'p.email',
      'p.status',
      'p.created_at as joined_at',
      'p.invited_at',
      'p.last_login_at',
      db.raw(`array_agg(DISTINCT ur.role) FILTER (WHERE ur.role IS NOT NULL) as roles`),
    )
    .groupBy('p.id')
    .orderBy('p.created_at', 'asc');

  // Compute counts per role
  const counts: Record<AppRole, number> = {
    dealer_admin: 0,
    manager: 0,
    accountant: 0,
    salesman: 0,
  };
  for (const m of members as any[]) {
    const primary = pickPrimary(m.roles as AppRole[] | null);
    if (primary) counts[primary] += 1;
  }

  res.json({
    members: (members as any[]).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      status: m.status,
      joined_at: m.joined_at,
      invited_at: m.invited_at,
      last_login_at: m.last_login_at,
      role: pickPrimary((m.roles as AppRole[]) ?? []),
    })),
    counts,
  });
});

function pickPrimary(roles: AppRole[] | null | undefined): AppRole | null {
  if (!roles || roles.length === 0) return null;
  const order: AppRole[] = ['dealer_admin', 'manager', 'accountant', 'salesman'];
  for (const r of order) if (roles.includes(r)) return r;
  return roles[0] ?? null;
}

// ── POST /api/team — invite ──
const inviteSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(150),
  password: z.string().min(8).max(72),
  role: z.enum(['dealer_admin', 'manager', 'accountant', 'salesman']),
});

router.post('/', async (req: Request, res: Response) => {
  const dealerId = ensureDealer(req, res);
  if (!dealerId) return;

  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  // Enforce per-plan staff user limit
  const sub = await db('subscriptions as s')
    .leftJoin('plans as p', 'p.id', 's.plan_id')
    .where({ 's.dealer_id': dealerId })
    .orderBy('s.start_date', 'desc')
    .select('p.max_staff_users')
    .first();
  const maxStaff: number = sub?.max_staff_users ?? 3;
  const currentStaff: number = await db('profiles')
    .where({ dealer_id: dealerId })
    .count('id as cnt')
    .then((r: any[]) => Number(r[0]?.cnt ?? 0));
  // 9999 = unlimited (Business plan)
  if (maxStaff < 9999 && currentStaff >= maxStaff) {
    res.status(403).json({
      error: `Your plan allows a maximum of ${maxStaff} staff user(s). Please upgrade to add more.`,
      code: 'PLAN_LIMIT_USERS',
      limit: maxStaff,
    });
    return;
  }

  const { name, email, password, role } = parsed.data;

  // Email must be unique
  const existing = await db('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first();
  if (existing) {
    res.status(409).json({ error: 'A user with this email already exists' });
    return;
  }

  try {
    const user = await authService.createUser({
      email,
      password,
      name,
      dealerId,
      role: role === 'dealer_admin' ? 'dealer_admin' : role === 'salesman' ? 'salesman' : (role as any),
    });

    await db('profiles').where({ id: user.id }).update({ invited_at: new Date() });

    res.status(201).json({ id: user.id, email: user.email, name, role });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── PUT /api/team/:userId — update ──
const updateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  role: z.enum(['dealer_admin', 'manager', 'accountant', 'salesman']).optional(),
});

router.put('/:userId', async (req: Request, res: Response) => {
  const dealerId = ensureDealer(req, res);
  if (!dealerId) return;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const { userId } = req.params;
  if (userId === req.user?.userId && parsed.data.role && parsed.data.role !== 'dealer_admin') {
    res.status(400).json({ error: 'You cannot demote yourself' });
    return;
  }

  // Verify member belongs to this dealer
  const profile = await db('profiles').where({ id: userId, dealer_id: dealerId }).first();
  if (!profile) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  await db.transaction(async (trx) => {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (Object.keys(updates).length > 1) {
      await trx('profiles').where({ id: userId }).update(updates);
    }

    if (parsed.data.role) {
      // Clear old assignable roles, set the new one
      await trx('user_roles').where({ user_id: userId }).whereIn('role', ASSIGNABLE_ROLES).delete();
      await trx('user_roles')
        .insert({ user_id: userId, role: parsed.data.role })
        .onConflict(['user_id', 'role'])
        .ignore();
    }
  });

  res.json({ ok: true });
});

// ── DELETE /api/team/:userId — soft-deactivate ──
router.delete('/:userId', async (req: Request, res: Response) => {
  const dealerId = ensureDealer(req, res);
  if (!dealerId) return;

  const { userId } = req.params;
  if (userId === req.user?.userId) {
    res.status(400).json({ error: 'You cannot deactivate yourself' });
    return;
  }

  const profile = await db('profiles').where({ id: userId, dealer_id: dealerId }).first();
  if (!profile) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }

  // Don't allow deactivating the last active dealer_admin
  const adminRoles = await db('user_roles')
    .join('profiles', 'profiles.id', 'user_roles.user_id')
    .where('profiles.dealer_id', dealerId)
    .where('user_roles.role', 'dealer_admin')
    .where('profiles.status', 'active')
    .count<{ count: string }>('* as count')
    .first();

  const isTargetAdmin = await db('user_roles')
    .where({ user_id: userId, role: 'dealer_admin' })
    .first();

  if (isTargetAdmin && Number(adminRoles?.count || 0) <= 1) {
    res.status(400).json({ error: 'Cannot deactivate the last owner' });
    return;
  }

  await db('profiles').where({ id: userId }).update({ status: 'inactive', updated_at: new Date() });
  res.json({ ok: true });
});

// ── GET /login-history — security view for the dealer's team ──
// Successful logins come from refresh_tokens (one row per login); failed
// attempts / lockouts from login_attempts. Both scoped to this dealer's users.
router.get('/login-history', async (req: Request, res: Response) => {
  const dealerId = ensureDealer(req, res);
  if (!dealerId) return;

  const logins = await db('refresh_tokens as rt')
    .join('profiles as p', 'p.id', 'rt.user_id')
    .where('p.dealer_id', dealerId)
    .orderBy('rt.created_at', 'desc')
    .limit(50)
    .select(
      'p.name',
      'p.email',
      'rt.created_at as login_at',
      'rt.revoked_at',
      'rt.expires_at',
      db.raw('(rt.revoked_at IS NULL AND rt.expires_at > now()) as active'),
    );

  const emails: string[] = await db('profiles').where({ dealer_id: dealerId }).pluck('email');
  const failed = emails.length
    ? await db('login_attempts')
        .whereIn('email', emails.map((e) => (e || '').toLowerCase()))
        .orderBy('attempted_at', 'desc')
        .limit(50)
        .select('email', 'ip_address', 'attempted_at', 'is_locked', 'locked_until')
    : [];

  res.json({ logins, failed });
});

export default router;
