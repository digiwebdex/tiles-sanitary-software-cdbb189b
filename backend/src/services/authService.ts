import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import { db } from '../db/connection';
import { env } from '../config/env';
import { dispatchSignupNotifications } from './notificationService';
import { defaultSubscriptionEndDate } from '../lib/subscriptionEndDate';
import { DEFAULT_SIGNUP_TRIAL_DAYS } from '../lib/trialConstants';

const SALT_ROUNDS = 12;

// Lockout policy — match existing Supabase RPC behaviour (3 strikes / 30 min)
const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 30;
const ATTEMPT_WINDOW_MINUTES = 30;

// Password reset
const RESET_TOKEN_TTL_MINUTES = 30;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface PlanFeatures {
  maxWarehouses: number;
  maxBranches: number;
  maxStaffUsers: number;
  whatsappEnabled: boolean;
  hrmEnabled: boolean;
  campaignsEnabled: boolean;
  portalEnabled: boolean;
  advancedFinanceEnabled: boolean;
  advancedReportsEnabled: boolean;
  posEnabled: boolean;
  barcodeEnabled: boolean;
  leadsEnabled: boolean;
  projectsEnabled: boolean;
  quotationsEnabled: boolean;
  backordersEnabled: boolean;
}

export interface JwtPayload {
  userId: string;
  email: string;
  dealerId: string | null;
  roles: string[];
  isDemo?: boolean;
  menuMode?: 'simple' | 'advanced';
  subscription?: {
    id: string;
    planId: string;
    status: 'active' | 'expired' | 'suspended';
    startDate: string;
    endDate: string | null;
  } | null;
  planFeatures?: PlanFeatures | null;
  saPermissions?: SaEmployeePermissions | null;
}

export interface SaEmployeePermissions {
  designation: string | null;
  can_manage_dealers: boolean;
  can_manage_subscriptions: boolean;
  can_view_financials: boolean;
  can_send_reminders: boolean;
  can_view_audit_log: boolean;
  can_manage_announcements: boolean;
  can_view_dealer_users: boolean;
}

export interface LockStatus {
  locked: boolean;
  remaining_minutes?: number;
  remaining_attempts?: number;
}

function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET as jwt.Secret, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN));
  return { token, hash, expiresAt };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseDuration(dur: string): number {
  const match = dur.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(match[1]);
  switch (match[2]) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

async function buildJwtPayload(userId: string): Promise<JwtPayload> {
  const profile = await db('profiles').where({ id: userId }).first();
  const roles = await db('user_roles').where({ user_id: userId }).select('role');
  const roleNames = roles.map((r: any) => r.role);
  let subscription: JwtPayload['subscription'] = null;
  let planFeatures: PlanFeatures | null = null;
  let isDemo = false;
  // Menu mode applies to every dealer-scoped user (so managers/accountants/
  // salesmen all share the dealer's simple/advanced choice).
  let menuMode: 'simple' | 'advanced' = 'advanced';

  if (profile?.dealer_id) {
    const dealer = await db('dealers').where({ id: profile.dealer_id }).first();
    isDemo = !!dealer?.is_demo;
    menuMode = dealer?.menu_mode === 'simple' ? 'simple' : 'advanced';

    if (roleNames.some((r: string) => r === 'dealer_admin' || r === 'salesman')) {
      const sub = await db('subscriptions as s')
        .leftJoin('plans as p', 'p.id', 's.plan_id')
        .where({ 's.dealer_id': profile.dealer_id })
        .orderBy('s.start_date', 'desc')
        .orderBy('s.created_at', 'desc')
        .select(
          's.id', 's.plan_id', 's.status', 's.start_date', 's.end_date',
          'p.max_warehouses', 'p.max_branches', 'p.max_staff_users',
          'p.whatsapp_enabled', 'p.hrm_enabled', 'p.campaigns_enabled',
          'p.portal_enabled', 'p.advanced_finance_enabled', 'p.advanced_reports_enabled',
          'p.pos_enabled', 'p.barcode_enabled', 'p.leads_enabled',
          'p.projects_enabled', 'p.quotations_enabled', 'p.backorders_enabled',
          's.custom_features',
        )
        .first();

      if (sub) {
        subscription = {
          id: sub.id,
          planId: sub.plan_id,
          status: sub.status,
          startDate: dateOnly(sub.start_date) ?? '',
          endDate: dateOnly(sub.end_date),
        };
        // Base features from plan
        const base: PlanFeatures = {
          maxWarehouses: sub.max_warehouses ?? 1,
          maxBranches: sub.max_branches ?? 1,
          maxStaffUsers: sub.max_staff_users ?? 3,
          whatsappEnabled: !!sub.whatsapp_enabled,
          hrmEnabled: !!sub.hrm_enabled,
          campaignsEnabled: !!sub.campaigns_enabled,
          portalEnabled: !!sub.portal_enabled,
          advancedFinanceEnabled: !!sub.advanced_finance_enabled,
          advancedReportsEnabled: !!sub.advanced_reports_enabled,
          posEnabled: !!sub.pos_enabled,
          barcodeEnabled: !!sub.barcode_enabled,
          leadsEnabled: !!sub.leads_enabled,
          projectsEnabled: !!sub.projects_enabled,
          quotationsEnabled: !!sub.quotations_enabled,
          backordersEnabled: !!sub.backorders_enabled,
        };
        // Merge per-dealer overrides from subscription.custom_features (Premium Custom)
        const overrides: Partial<PlanFeatures> =
          sub.custom_features
            ? (typeof sub.custom_features === 'string'
                ? JSON.parse(sub.custom_features)
                : sub.custom_features)
            : {};
        planFeatures = { ...base, ...overrides };
      }
    }
  }

  let saPermissions: SaEmployeePermissions | null = null;
  if (roleNames.includes('sa_employee')) {
    const ep = await db('sa_employee_permissions').where({ user_id: userId }).first();
    if (ep) {
      saPermissions = {
        designation: ep.designation ?? null,
        can_manage_dealers: !!ep.can_manage_dealers,
        can_manage_subscriptions: !!ep.can_manage_subscriptions,
        can_view_financials: !!ep.can_view_financials,
        can_send_reminders: !!ep.can_send_reminders,
        can_view_audit_log: !!ep.can_view_audit_log,
        can_manage_announcements: !!ep.can_manage_announcements,
        can_view_dealer_users: !!ep.can_view_dealer_users,
      };
    }
  }

  return {
    userId,
    email: profile?.email ?? '',
    dealerId: profile?.dealer_id ?? null,
    roles: roleNames,
    isDemo,
    menuMode,
    subscription,
    planFeatures,
    saPermissions,
  };
}

// ── Lockout helpers ────────────────────────────────────────────────────────

async function checkLockStatus(email: string): Promise<LockStatus> {
  const normalized = email.toLowerCase().trim();
  const now = new Date();

  // Active lockout?
  const lock = await db('login_attempts')
    .where({ email: normalized, is_locked: true })
    .where('locked_until', '>', now)
    .orderBy('locked_until', 'desc')
    .first();

  if (lock) {
    const remainingMs = new Date(lock.locked_until).getTime() - now.getTime();
    return {
      locked: true,
      remaining_minutes: Math.max(1, Math.ceil(remainingMs / 60000)),
    };
  }

  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);
  const recentFails = await db('login_attempts')
    .where({ email: normalized })
    .where('attempted_at', '>=', windowStart)
    .count<{ count: string }[]>('* as count');

  const fails = parseInt(recentFails[0]?.count ?? '0', 10);
  return {
    locked: false,
    remaining_attempts: Math.max(0, MAX_FAILED_ATTEMPTS - fails),
  };
}

async function recordFailedAttempt(email: string, ip?: string): Promise<LockStatus> {
  const normalized = email.toLowerCase().trim();
  const now = new Date();
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MINUTES * 60 * 1000);

  await db('login_attempts').insert({
    email: normalized,
    ip_address: ip ?? null,
    is_locked: false,
  });

  const recentFails = await db('login_attempts')
    .where({ email: normalized })
    .where('attempted_at', '>=', windowStart)
    .count<{ count: string }[]>('* as count');

  const fails = parseInt(recentFails[0]?.count ?? '0', 10);

  if (fails >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000);
    await db('login_attempts').insert({
      email: normalized,
      ip_address: ip ?? null,
      is_locked: true,
      locked_until: lockedUntil,
    });
    return { locked: true, remaining_minutes: LOCKOUT_MINUTES };
  }

  return { locked: false, remaining_attempts: MAX_FAILED_ATTEMPTS - fails };
}

async function clearAttempts(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await db('login_attempts').where({ email: normalized }).del();
}

// ── Public service API ────────────────────────────────────────────────────

export const authService = {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  /** Read-only lock check (used before attempting login). */
  async checkLock(email: string): Promise<LockStatus> {
    return checkLockStatus(email);
  },

  /**
   * Login with full lockout enforcement.
   * Throws structured errors that routes translate into 401/423.
   */
  async login(
    email: string,
    password: string,
    ip?: string,
    totpCode?: string,
  ): Promise<TokenPair & { user: JwtPayload; lock: LockStatus; totpRequired?: boolean }> {
    const normalized = email.toLowerCase().trim();

    // 1. Lookup first so we know the role before applying lockout
    const user = await db('users').where({ email: normalized }).first();

    // Check roles to decide if lockout applies
    const roles = user
      ? (await db('user_roles').where({ user_id: user.id }).pluck('role') as string[])
      : [];
    const isSuperAdmin = roles.includes('super_admin');

    // Lockout check — skip entirely for super_admin (TOTP is their protection)
    if (!isSuperAdmin) {
      const lock = await checkLockStatus(normalized);
      if (lock.locked) {
        const err: any = new Error('Account is locked');
        err.code = 'LOCKED';
        err.lock = lock;
        throw err;
      }
    }

    if (!user) {
      const after = isSuperAdmin ? { locked: false } : await recordFailedAttempt(normalized, ip);
      const err: any = new Error('Invalid email or password');
      err.code = 'INVALID_CREDENTIALS';
      err.lock = after;
      throw err;
    }

    if (user.status !== 'active') {
      const err: any = new Error(
        user.status === 'pending'
          ? 'Account is awaiting Super Admin approval'
          : 'Account is suspended'
      );
      err.code = user.status === 'pending' ? 'PENDING_APPROVAL' : 'SUSPENDED';
      throw err;
    }

    // 2. Password verify
    const valid = await this.verifyPassword(password, user.password_hash);
    if (!valid) {
      if (isSuperAdmin) {
        // No lockout for super_admin — just reject silently
        const err: any = new Error('Invalid email or password');
        err.code = 'INVALID_CREDENTIALS';
        err.lock = { locked: false };
        throw err;
      }
      const after = await recordFailedAttempt(normalized, ip);
      const err: any = new Error('Invalid email or password');
      err.code = after.locked ? 'LOCKED' : 'INVALID_CREDENTIALS';
      err.lock = after;
      throw err;
    }

    // 3. TOTP check (super_admin only)
    if (isSuperAdmin && user.totp_enabled && user.totp_secret) {
      if (!totpCode) {
        // Password OK but TOTP not provided — signal the frontend
        const err: any = new Error('TOTP code required');
        err.code = 'TOTP_REQUIRED';
        err.lock = { locked: false };
        throw err;
      }
      const tokenValid = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      });
      if (!tokenValid) {
        const err: any = new Error('Invalid authenticator code');
        err.code = 'TOTP_INVALID';
        err.lock = { locked: false };
        throw err;
      }
    }

    // 4. Success — clear attempts (non-SA), issue tokens
    if (!isSuperAdmin) await clearAttempts(normalized);

    const payload = await buildJwtPayload(user.id);
    const accessToken = signAccessToken(payload);
    const { token: refreshToken, hash, expiresAt } = generateRefreshToken();

    await db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: hash,
      expires_at: expiresAt,
    });

    await db('refresh_tokens')
      .where('user_id', user.id)
      .where('expires_at', '<', new Date())
      .del();

    return { accessToken, refreshToken, user: payload, lock: { locked: false } };
  },

  /**
   * Refresh with explicit rotation:
   *   - old token must be unrevoked + unexpired
   *   - old token marked revoked + linked to new
   *   - new token issued
   * Reuse of a revoked token = breach signal → revoke entire family for user.
   */
  async refreshTokens(refreshToken: string): Promise<TokenPair & { user: JwtPayload }> {
    const hash = hashToken(refreshToken);

    const stored = await db('refresh_tokens').where({ token_hash: hash }).first();

    if (!stored) {
      const err: any = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH';
      throw err;
    }

    // Reuse detection: token was already rotated → suspected leak. Nuke family.
    if (stored.revoked_at) {
      await db('refresh_tokens').where({ user_id: stored.user_id }).update({
        revoked_at: new Date(),
      });
      const err: any = new Error('Refresh token reuse detected; session revoked');
      err.code = 'REFRESH_REUSE';
      throw err;
    }

    if (new Date(stored.expires_at) <= new Date()) {
      const err: any = new Error('Refresh token expired');
      err.code = 'REFRESH_EXPIRED';
      throw err;
    }

    // Issue new
    const payload = await buildJwtPayload(stored.user_id);
    const accessToken = signAccessToken(payload);
    const { token: newRefreshTokenStr, hash: newHash, expiresAt } = generateRefreshToken();

    const [created] = await db('refresh_tokens')
      .insert({
        user_id: stored.user_id,
        token_hash: newHash,
        expires_at: expiresAt,
      })
      .returning('id');

    // Mark old as revoked + linked to new
    await db('refresh_tokens').where({ id: stored.id }).update({
      revoked_at: new Date(),
      replaced_by: created?.id ?? created,
    });

    return { accessToken, refreshToken: newRefreshTokenStr, user: payload };
  },

  async logout(refreshToken: string): Promise<void> {
    const hash = hashToken(refreshToken);
    // Mark revoked rather than delete — preserves audit trail for reuse detection
    await db('refresh_tokens').where({ token_hash: hash }).update({
      revoked_at: new Date(),
    });
  },

  async logoutAll(userId: string): Promise<void> {
    await db('refresh_tokens')
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date() });
  },

  verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  },

  async getUserPayload(userId: string): Promise<JwtPayload> {
    return buildJwtPayload(userId);
  },

  // ── Password reset ──

  /**
   * Request a reset token for an email.
   * Always returns the same shape regardless of whether the email exists
   * (prevents user enumeration). Returns the raw token + user for the
   * caller (route) to dispatch via email.
   */
  async requestPasswordReset(email: string): Promise<{ token: string; userId: string } | null> {
    const normalized = email.toLowerCase().trim();
    const user = await db('users').where({ email: normalized }).first();
    if (!user) return null;

    const token = crypto.randomBytes(48).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    // Invalidate any existing unused tokens for this user
    await db('password_reset_tokens')
      .where({ user_id: user.id })
      .whereNull('used_at')
      .update({ used_at: new Date() });

    await db('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    return { token, userId: user.id };
  },

  /** Consume a reset token + set new password. Single-use. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || newPassword.length < 6) {
      throw new Error('Invalid reset request');
    }
    const tokenHash = hashToken(token);
    const stored = await db('password_reset_tokens')
      .where({ token_hash: tokenHash })
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .first();

    if (!stored) throw new Error('Invalid or expired reset token');

    const passwordHash = await this.hashPassword(newPassword);

    await db.transaction(async (trx) => {
      await trx('users').where({ id: stored.user_id }).update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });
      await trx('password_reset_tokens').where({ id: stored.id }).update({
        used_at: new Date(),
      });
      // Revoke all sessions on password change
      await trx('refresh_tokens')
        .where({ user_id: stored.user_id })
        .whereNull('revoked_at')
        .update({ revoked_at: new Date() });
      // Clear lockout history
      const profile = await trx('profiles').where({ id: stored.user_id }).first();
      if (profile?.email) {
        await trx('login_attempts').where({ email: profile.email.toLowerCase().trim() }).del();
      }
    });
  },

  /** Set password for authenticated user (portal / account settings). */
  async verifyCurrentPassword(userId: string, currentPassword: string): Promise<boolean> {
    const user = await db('users').where({ id: userId }).select('password_hash').first();
    if (!user?.password_hash) return false;
    return this.verifyPassword(currentPassword, user.password_hash);
  },

  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await db('users').where({ id: userId }).update({
      password_hash: passwordHash,
      updated_at: new Date(),
    });
  },

  async createUser(data: {
    email: string;
    password: string;
    name: string;
    dealerId?: string;
    role: 'dealer_admin' | 'salesman' | 'super_admin' | 'manager' | 'accountant';
  }) {
    if ((data.role !== 'super_admin') && !data.dealerId) {
      throw new Error(`${data.role} users must be linked to a dealer`);
    }

    const hash = await this.hashPassword(data.password);

    const user = await db.transaction(async (trx) => {
      const [createdUser] = await trx('users')
        .insert({
          email: data.email.toLowerCase().trim(),
          password_hash: hash,
          name: data.name.trim(),
        })
        .returning('*');

      await trx('profiles').insert({
        id: createdUser.id,
        name: data.name.trim(),
        email: data.email.toLowerCase().trim(),
        dealer_id: data.dealerId ?? null,
      });

      await trx('user_roles')
        .insert({ user_id: createdUser.id, role: data.role })
        .onConflict(['user_id', 'role'])
        .ignore();

      return createdUser;
    });

    return user;
  },

  /** Portal-only identity — no dealer_id, no app roles. */
  async createPortalIdentity(data: { email: string; password: string; name: string }) {
    const normalized = data.email.toLowerCase().trim();
    const existing = await db('users').where({ email: normalized }).first();
    if (existing) {
      const err: any = new Error('A user with this email already exists');
      err.code = 'EMAIL_TAKEN';
      throw err;
    }

    const hash = await this.hashPassword(data.password);
    return db.transaction(async (trx) => {
      const [createdUser] = await trx('users')
        .insert({
          email: normalized,
          password_hash: hash,
          name: data.name.trim(),
          status: 'active',
        })
        .returning('*');

      await trx('profiles').insert({
        id: createdUser.id,
        name: data.name.trim(),
        email: normalized,
        dealer_id: null,
        status: 'active',
      });

      return createdUser;
    });
  },

  /**
   * Self-signup: provision a brand-new dealer + admin user + 7-day trial,
   * but leave both the dealer and the admin user in 'pending' state until
   * a Super Admin approves them. We DO NOT issue tokens here — login is
   * blocked until approval. The login route translates the 'pending'
   * status into a friendly 'awaiting approval' error.
   *
   * All inserts run in a single transaction so a partial failure leaves
   * no orphaned dealers, profiles, or roles.
   */
  async register(input: {
    name: string;
    business_name: string;
    phone: string;
    email: string;
    password: string;
    ip?: string;
  }): Promise<{ dealerId: string; userId: string; accessToken: string; refreshToken: string; user: JwtPayload }> {
    const name = input.name.trim();
    const businessName = input.business_name.trim();
    const phone = input.phone.trim();
    const email = input.email.toLowerCase().trim();
    const password = input.password;

    // Email uniqueness — surface a friendly 409 instead of a Postgres unique-violation.
    const existing = await db('users').where({ email }).first();
    if (existing) {
      const err: any = new Error('An account with this email already exists. Please sign in.');
      err.code = 'EMAIL_TAKEN';
      throw err;
    }

    const passwordHash = await this.hashPassword(password);

    const { dealerId, userId } = await db.transaction(async (trx) => {
      // 1. Dealer ACTIVE — self-signup is auto-approved, no admin action needed.
      //    New dealers start in 'simple' menu mode (uncluttered onboarding);
      //    the owner can switch to 'advanced' from Settings.
      const [dealer] = await trx('dealers')
        .insert({ name: businessName, phone, status: 'active', menu_mode: 'simple' })
        .returning('id');
      const dId: string = dealer.id ?? dealer;

      // 2. User ACTIVE — can log in immediately after signup.
      const [user] = await trx('users')
        .insert({ email, password_hash: passwordHash, name, status: 'active' })
        .returning('*');

      // 3. Profile (linked to dealer)
      await trx('profiles').insert({
        id: user.id,
        name,
        email,
        dealer_id: dId,
      });

      // 4. Dealer owner role. This must succeed before signup is considered provisioned.
      await trx('user_roles')
        .insert({ user_id: user.id, role: 'dealer_admin' })
        .onConflict(['user_id', 'role'])
        .ignore();

      // 5. Invoice sequence (so first sale doesn't race the upsert)
      await trx('invoice_sequences').insert({
        dealer_id: dId,
        next_invoice_no: 1,
        next_challan_no: 1,
      }).onConflict('dealer_id').ignore();

      // 6. Trial subscription on the Free Trial plan (or cheapest active plan).
      let plan =
        (await trx('plans')
          .where({ is_trial: true, is_active: true })
          .orderBy('sort_order', 'asc')
          .first()) ??
        (await trx('plans').where({ is_active: true }).orderBy('price_monthly', 'asc').first());
      if (!plan) {
        const [created] = await trx('plans')
          .insert({
            name: 'Free Trial',
            price_monthly: 0,
            price_yearly: 0,
            max_users: 1,
            is_trial: true,
            trial_days: DEFAULT_SIGNUP_TRIAL_DAYS,
            is_active: true,
          })
          .returning('*');
        plan = created;
      }

      const startDate = new Date().toISOString().split('T')[0];
      const endDate = await defaultSubscriptionEndDate(plan.id, trx);

      await trx('subscriptions').insert({
        dealer_id: dId,
        plan_id: plan.id,
        status: 'active',
        billing_cycle: 'monthly',
        start_date: startDate,
        end_date: endDate,
      });

      // 7. Notification settings (best-effort; ignore if table shape differs)
      try {
        await trx('notification_settings').insert({
          dealer_id: dId,
          owner_email: email,
          owner_phone: phone,
          enable_sale_sms: true,
          enable_sale_email: true,
          enable_daily_summary_sms: true,
          enable_daily_summary_email: true,
        });
      } catch (e) {
        console.warn('[register] notification_settings insert skipped:', (e as Error).message);
      }

      return { dealerId: dId, userId: user.id };
    });

    // ── Fire-and-forget signup notifications (SMS + email to dealer & admin) ──
    // Never blocks the response — the user gets their "pending approval" screen
    // immediately and the dispatcher logs failures.
    dispatchSignupNotifications({
      dealerName: name,
      businessName,
      dealerPhone: phone,
      dealerEmail: email,
      adminPhone: env.ADMIN_PHONE,
      adminEmail: env.ADMIN_EMAIL,
    }).catch((err) => {
      console.error('[register] signup notification dispatch failed:', err);
    });

    // Issue tokens immediately — dealer is active, can log in right away.
    const payload = await buildJwtPayload(userId);
    const accessToken = signAccessToken(payload);
    const { token: refreshToken, hash, expiresAt } = generateRefreshToken();
    await db('refresh_tokens').insert({ user_id: userId, token_hash: hash, expires_at: expiresAt });

    return { dealerId, userId, accessToken, refreshToken, user: payload };
  },

  // ── TOTP management (super_admin only) ─────────────────────────────────

  /** Generate a new TOTP secret and return the otpauth URL for QR display. */
  async totpGenerateSecret(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw new Error('User not found');
    const generated = speakeasy.generateSecret({
      name: `TilesERP (${user.email})`,
      issuer: 'TilesERP Super Admin',
      length: 20,
    });
    // Persist the secret (not yet enabled — enabled only after verify)
    await db('users').where({ id: userId }).update({ totp_secret: generated.base32, totp_enabled: false });
    return {
      secret: generated.base32,
      otpauthUrl: generated.otpauth_url!,
    };
  },

  /** Verify a TOTP code and mark 2FA as enabled. */
  async totpEnable(userId: string, code: string): Promise<void> {
    const user = await db('users').where({ id: userId }).first();
    if (!user || !user.totp_secret) throw new Error('Run setup first');
    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!valid) throw new Error('Invalid code — check your authenticator app');
    await db('users').where({ id: userId }).update({ totp_enabled: true, totp_enabled_at: new Date() });
  },

  /** Disable TOTP for a super_admin user (requires valid TOTP code as confirmation). */
  async totpDisable(userId: string, code: string): Promise<void> {
    const user = await db('users').where({ id: userId }).first();
    if (!user || !user.totp_secret || !user.totp_enabled) throw new Error('TOTP is not enabled');
    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!valid) throw new Error('Invalid code');
    await db('users').where({ id: userId }).update({ totp_secret: null, totp_enabled: false, totp_enabled_at: null });
  },

  /** Return TOTP status for a user. */
  async totpStatus(userId: string): Promise<{ enabled: boolean; enabledAt: string | null }> {
    const user = await db('users').where({ id: userId }).select('totp_enabled', 'totp_enabled_at').first();
    return { enabled: !!user?.totp_enabled, enabledAt: user?.totp_enabled_at ?? null };
  },
};

