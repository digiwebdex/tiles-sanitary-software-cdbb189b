/**
 * /api/dealers — Super Admin only.
 *
 * Powers the Super Admin → Dealers panel. All routes require the caller
 * to hold the 'super_admin' role. Returns enriched dealer rows that
 * include the linked admin user, current subscription, and contact info
 * so the UI can render the full table without 1+N follow-up requests.
 *
 * Approval / rejection / suspension all flip BOTH the dealer row and the
 * underlying admin user, then dispatch a notification to the dealer so
 * they know they can log in (or that their account was rejected).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { dispatchApprovalNotification, dispatchSignupNotifications, sendEmail, sendSms } from '../services/notificationService';
import { recordSaAudit } from '../services/saAuditService';
import { notifySuspended } from '../services/subscriptionNotifyService';

const router = Router();

// All endpoints below require an authenticated super_admin
router.use(authenticate, requireRole('super_admin'));

interface DealerRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  owner_name: string | null;
  business_type: string | null;
  city: string | null;
  district: string | null;
  country: string | null;
  postal_code: string | null;
  tax_id: string | null;
  trade_license_no: string | null;
  website: string | null;
  logo_url: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  admin_email: string | null;
  admin_name: string | null;
  admin_user_id: string | null;
  admin_status: string | null;
  subscription_status: string | null;
  subscription_end: string | null;
  plan_name: string | null;
}

/** GET /api/dealers — list all dealers with their primary admin + subscription. */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db('dealers as d')
      .leftJoin('profiles as p', function () {
        this.on('p.dealer_id', '=', 'd.id');
      })
      .leftJoin('users as u', 'u.id', 'p.id')
      .leftJoin('user_roles as ur', function () {
        this.on('ur.user_id', '=', 'u.id').andOn(db.raw("ur.role = 'dealer_admin'"));
      })
      .leftJoin('subscriptions as s', function () {
        this.on('s.dealer_id', '=', 'd.id');
      })
      .leftJoin('plans as pl', 'pl.id', 's.plan_id')
      .select<DealerRow[]>(
        'd.id',
        'd.name',
        'd.phone',
        'd.address',
        'd.email',
        'd.owner_name',
        'd.business_type',
        'd.city',
        'd.district',
        'd.country',
        'd.postal_code',
        'd.tax_id',
        'd.trade_license_no',
        'd.website',
        'd.logo_url',
        'd.notes',
        'd.status',
        'd.created_at',
        'd.updated_at',
        'u.email as admin_email',
        'u.name as admin_name',
        'u.id as admin_user_id',
        'u.status as admin_status',
        's.status as subscription_status',
        's.end_date as subscription_end',
        'pl.name as plan_name',
      )
      .whereNotNull('ur.user_id') // pick the row that has dealer_admin role
      .orderBy('d.created_at', 'desc');

    res.json({ dealers: rows });
  } catch (err: any) {
    console.error('[dealers:list] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load dealers' });
  }
});

/** GET /api/dealers/:id — full detail for a single dealer (used by detail sheet). */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dealer = await db('dealers').where({ id: req.params.id }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }
    const profiles = await db('profiles as p')
      .leftJoin('users as u', 'u.id', 'p.id')
      .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
      .where('p.dealer_id', dealer.id)
      .select(
        'p.id',
        'p.name',
        'p.email',
        'u.status',
        'ur.role',
      );
    const subscription = await db('subscriptions as s')
      .leftJoin('plans as pl', 'pl.id', 's.plan_id')
      .where('s.dealer_id', dealer.id)
      .orderBy('s.created_at', 'desc')
      .select('s.*', 'pl.name as plan_name')
      .first();

    res.json({ dealer, users: profiles, subscription });
  } catch (err: any) {
    console.error('[dealers:get] failed:', err);
    res.status(500).json({ error: err.message || 'Failed to load dealer' });
  }
});

const decisionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/dealers/:id/approve — flip dealer + admin user to active and
 * notify the dealer that they can now log in.
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const admin = await db('profiles as p')
      .leftJoin('users as u', 'u.id', 'p.id')
      .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
      .where('p.dealer_id', dealerId)
      .where('ur.role', 'dealer_admin')
      .select('u.id', 'u.email', 'u.name')
      .first();

    await db.transaction(async (trx) => {
      await trx('dealers').where({ id: dealerId }).update({ status: 'active' });
      if (admin?.id) {
        await trx('users').where({ id: admin.id }).update({ status: 'active' });
      }
    });

    // Best-effort notification — never block the response on email/SMS.
    if (admin) {
      dispatchApprovalNotification({
        dealerName: admin.name || dealer.name,
        businessName: dealer.name,
        dealerPhone: dealer.phone || '',
        dealerEmail: admin.email || '',
      }).catch((err) => console.error('[dealers:approve] notify failed:', err));
    }

    res.json({ success: true, dealer_id: dealerId, status: 'active' });
  } catch (err: any) {
    console.error('[dealers:approve] failed:', err);
    res.status(500).json({ error: err.message || 'Approval failed' });
  }
});

/**
 * POST /api/dealers/:id/reject — mark dealer + admin as inactive and notify
 * the applicant. We keep the row (for audit) instead of deleting.
 */
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const { reason } = decisionSchema.parse(req.body || {});

    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const admin = await db('profiles as p')
      .leftJoin('users as u', 'u.id', 'p.id')
      .where('p.dealer_id', dealerId)
      .select('u.id', 'u.email', 'u.name')
      .first();

    await db.transaction(async (trx) => {
      await trx('dealers').where({ id: dealerId }).update({ status: 'rejected' });
      if (admin?.id) {
        await trx('users').where({ id: admin.id }).update({ status: 'inactive' });
        await trx('refresh_tokens')
          .where({ user_id: admin.id })
          .whereNull('revoked_at')
          .update({ revoked_at: new Date() });
      }
    });

    if (admin?.email) {
      const subject = 'Tiles & Sanitary ERP — Registration Update';
      const text =
        `Dear ${admin.name || 'Applicant'},\n\n` +
        `Thank you for your interest in Tiles & Sanitary ERP.\n` +
        `We're sorry to let you know that your registration for "${dealer.name}" was not approved at this time.\n\n` +
        (reason ? `Reason: ${reason}\n\n` : '') +
        `If you believe this is a mistake, please call us at +880 1674 533303.\n\n` +
        `Best regards,\nTiles & Sanitary ERP Team`;
      sendEmail({ to: admin.email, subject, text }).catch(() => {});
    }
    if (dealer.phone) {
      sendSms({
        to: dealer.phone,
        message:
          `দুঃখিত! আপনার "${dealer.name}" রেজিস্ট্রেশন এই মুহূর্তে অনুমোদিত হয়নি। ` +
          `প্রশ্ন থাকলে কল করুন: +880 1674 533303`,
      }).catch(() => {});
    }

    res.json({ success: true, dealer_id: dealerId, status: 'rejected' });
  } catch (err: any) {
    console.error('[dealers:reject] failed:', err);
    res.status(500).json({ error: err.message || 'Rejection failed' });
  }
});

/**
 * POST /api/dealers/:id/reset-password — Super Admin force-resets the dealer
 * admin's password. Two modes:
 *   1) `mode: "temp"` (default) — generate a strong temporary password,
 *      set it on the user, revoke all sessions, and send the temp password
 *      to the dealer via Email + SMS. They can sign in immediately and
 *      change it from settings.
 *   2) `mode: "link"` — issue a single-use password-reset token (30-min
 *      TTL) and email a reset link. SMS the same link short-coded.
 *
 * Always revokes existing refresh tokens so old sessions can't continue.
 */
const resetPasswordSchema = z.object({
  mode: z.enum(['temp', 'link']).optional(),
});

function generateTempPassword(): string {
  // 10 chars: upper + lower + digit + symbol — readable for SMS.
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const sym = '@#$%&';
  const all = upper + lower + digit + sym;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(lower) + pick(digit) + pick(sym);
  for (let i = 0; i < 6; i++) pwd += pick(all);
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

router.post('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const { mode = 'temp' } = resetPasswordSchema.parse(req.body || {});

    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const admin = await db('profiles as p')
      .leftJoin('users as u', 'u.id', 'p.id')
      .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
      .where('p.dealer_id', dealerId)
      .where('ur.role', 'dealer_admin')
      .select('u.id', 'u.email', 'u.name')
      .first();

    if (!admin?.id || !admin?.email) {
      res.status(400).json({ error: 'No dealer admin user found for this dealer' });
      return;
    }

    // Lazy-load to avoid circular imports between dealers route and authService
    const { authService } = await import('../services/authService');
    const appBase =
      process.env.APP_BASE_URL ||
      process.env.PORTAL_BASE_URL ||
      'https://app.sanitileserp.com';

    if (mode === 'link') {
      const result = await authService.requestPasswordReset(admin.email);
      const token = result?.token;
      if (!token) {
        res.status(500).json({ error: 'Failed to issue reset token' });
        return;
      }
      const link = `${appBase}/reset-password?token=${encodeURIComponent(token)}`;

      sendEmail({
        to: admin.email,
        subject: 'Tiles & Sanitary ERP — Password reset link',
        text:
          `Dear ${admin.name || 'User'},\n\n` +
          `A password reset has been initiated for your account by the system administrator.\n\n` +
          `Reset link (valid for 30 minutes):\n${link}\n\n` +
          `If you did not request this, please contact support at +880 1674 533303.\n\n` +
          `— Tiles & Sanitary ERP`,
      }).catch(() => {});

      if (dealer.phone) {
        sendSms({
          to: dealer.phone,
          message:
            `আপনার পাসওয়ার্ড রিসেট লিংক (৩০ মিনিট): ${link}\n` +
            `সাহায্য: +880 1674 533303`,
        }).catch(() => {});
      }

      res.json({ success: true, mode: 'link' });
      return;
    }

    // mode === 'temp'
    const tempPassword = generateTempPassword();
    const passwordHash = await authService.hashPassword(tempPassword);

    await db.transaction(async (trx) => {
      await trx('users').where({ id: admin.id }).update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });
      // Revoke all sessions so old logins are kicked out.
      await trx('refresh_tokens')
        .where({ user_id: admin.id })
        .whereNull('revoked_at')
        .update({ revoked_at: new Date() });
      // Clear lockout history so they can sign in immediately.
      await trx('login_attempts')
        .where({ email: admin.email.toLowerCase().trim() })
        .del();
    });

    sendEmail({
      to: admin.email,
      subject: 'Tiles & Sanitary ERP — Your password has been reset',
      text:
        `Dear ${admin.name || 'User'},\n\n` +
        `Your password was reset by the system administrator.\n\n` +
        `Email: ${admin.email}\n` +
        `Temporary password: ${tempPassword}\n\n` +
        `Please sign in at ${appBase}/login and change your password from Settings immediately.\n\n` +
        `If you did not expect this, contact support at +880 1674 533303.\n\n` +
        `— Tiles & Sanitary ERP`,
    }).catch(() => {});

    if (dealer.phone) {
      sendSms({
        to: dealer.phone,
        message:
          `আপনার পাসওয়ার্ড রিসেট হয়েছে।\n` +
          `Email: ${admin.email}\n` +
          `New password: ${tempPassword}\n` +
          `লগইন: ${appBase}/login`,
      }).catch(() => {});
    }

    res.json({ success: true, mode: 'temp' });
  } catch (err: any) {
    console.error('[dealers:reset-password] failed:', err);
    res.status(500).json({ error: err.message || 'Password reset failed' });
  }
});

/** POST /api/dealers/:id/suspend — temporary disable for an active dealer. */
router.post('/:id/suspend', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const adminIds = await db('profiles')
      .where({ dealer_id: dealerId })
      .pluck('id');

    await db.transaction(async (trx) => {
      await trx('dealers').where({ id: dealerId }).update({ status: 'suspended' });
      if (adminIds.length) {
        await trx('users').whereIn('id', adminIds).update({ status: 'suspended' });
        await trx('refresh_tokens')
          .whereIn('user_id', adminIds)
          .whereNull('revoked_at')
          .update({ revoked_at: new Date() });
      }
    });

    await recordSaAudit(req, {
      action: 'dealer.suspend',
      targetType: 'dealer',
      targetId: dealerId,
      targetLabel: dealer.name,
    });

    await notifySuspended({ dealerId, reason: req.body?.reason ?? undefined });

    res.json({ success: true, dealer_id: dealerId, status: 'suspended' });
  } catch (err: any) {
    console.error('[dealers:suspend] failed:', err);
    res.status(500).json({ error: err.message || 'Suspend failed' });
  }
});

/** POST /api/dealers/:id/reactivate — undo a suspension. */
router.post('/:id/reactivate', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    const adminIds = await db('profiles')
      .where({ dealer_id: dealerId })
      .pluck('id');

    await db.transaction(async (trx) => {
      await trx('dealers').where({ id: dealerId }).update({ status: 'active' });
      if (adminIds.length) {
        await trx('users').whereIn('id', adminIds).update({ status: 'active' });
      }
    });

    await recordSaAudit(req, {
      action: 'dealer.reactivate',
      targetType: 'dealer',
      targetId: dealerId,
      targetLabel: dealer.name,
    });

    res.json({ success: true, dealer_id: dealerId, status: 'active' });
  } catch (err: any) {
    console.error('[dealers:reactivate] failed:', err);
    res.status(500).json({ error: err.message || 'Reactivate failed' });
  }
});

/**
 * PATCH /api/dealers/:id — update dealer business profile fields. Also lets
 * the Super Admin rename / re-email / change phone for the linked dealer_admin
 * user (those go on `users` + `profiles`, not on `dealers`).
 *
 * All fields are optional; only provided keys are updated. Strings are
 * trimmed; empty strings clear the field (set to NULL) so the UI can erase
 * a value by submitting "".
 */
const updateDealerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  owner_name: z.string().trim().max(200).optional().or(z.literal('')),
  business_type: z.string().trim().max(100).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  district: z.string().trim().max(100).optional().or(z.literal('')),
  country: z.string().trim().max(100).optional().or(z.literal('')),
  postal_code: z.string().trim().max(20).optional().or(z.literal('')),
  tax_id: z.string().trim().max(50).optional().or(z.literal('')),
  trade_license_no: z.string().trim().max(50).optional().or(z.literal('')),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  logo_url: z.string().trim().max(500).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  // Admin user fields (live on users + profiles, not on dealers)
  admin_name: z.string().trim().min(1).max(200).optional(),
  admin_email: z.string().trim().email().max(200).optional(),
  // Optional: set a new password for the dealer_admin (Super Admin direct set).
  // Min 8 chars; recommended ≥12 with mixed character classes (frontend enforces).
  new_password: z.string().min(8).max(128).optional(),
  // If true and new_password is set, deliver the password via Email + SMS too.
  notify_password: z.boolean().optional(),
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const body = updateDealerSchema.parse(req.body || {});

    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    // Build dealer-table update payload. Empty strings -> null, undefined -> skip.
    const dealerKeys = [
      'name', 'phone', 'email', 'owner_name', 'business_type', 'address',
      'city', 'district', 'country', 'postal_code', 'tax_id',
      'trade_license_no', 'website', 'logo_url', 'notes',
    ] as const;

    const dealerUpdate: Record<string, any> = {};
    for (const k of dealerKeys) {
      const v = (body as any)[k];
      if (v === undefined) continue;
      dealerUpdate[k] = v === '' ? null : v;
    }

    if (Object.keys(dealerUpdate).length > 0) {
      dealerUpdate.updated_at = new Date();
    }

    let adminUpdated = false;
    let passwordUpdated = false;
    const wantsAdminChange = !!(body.admin_name || body.admin_email || body.new_password);

    let adminRow: { id: string; email: string | null; name: string | null } | null = null;
    if (wantsAdminChange) {
      adminRow = await db('profiles as p')
        .leftJoin('users as u', 'u.id', 'p.id')
        .leftJoin('user_roles as ur', 'ur.user_id', 'p.id')
        .where('p.dealer_id', dealerId)
        .where('ur.role', 'dealer_admin')
        .select('p.id', 'u.email', 'u.name')
        .first();

      if (!adminRow?.id) {
        res.status(400).json({ error: 'No dealer_admin user found for this dealer' });
        return;
      }

      if (body.admin_email) {
        const lower = body.admin_email.toLowerCase().trim();
        const clash = await db('users')
          .whereRaw('LOWER(email) = ?', [lower])
          .whereNot({ id: adminRow.id })
          .first();
        if (clash) {
          res.status(409).json({ error: 'That email is already used by another user' });
          return;
        }
      }
    }

    let newPasswordHash: string | null = null;
    if (body.new_password && adminRow) {
      const { authService } = await import('../services/authService');
      newPasswordHash = await authService.hashPassword(body.new_password);
    }

    if (wantsAdminChange && adminRow) {
      await db.transaction(async (trx) => {
        if (Object.keys(dealerUpdate).length > 0) {
          await trx('dealers').where({ id: dealerId }).update(dealerUpdate);
        }
        const userPatch: Record<string, any> = { updated_at: new Date() };
        const profilePatch: Record<string, any> = {};
        if (body.admin_name) {
          userPatch.name = body.admin_name;
          profilePatch.name = body.admin_name;
        }
        if (body.admin_email) {
          userPatch.email = body.admin_email.toLowerCase().trim();
          profilePatch.email = body.admin_email.toLowerCase().trim();
        }
        if (newPasswordHash) {
          userPatch.password_hash = newPasswordHash;
          // Revoke active sessions and clear lockouts so the new password is effective immediately.
          await trx('refresh_tokens')
            .where({ user_id: adminRow!.id })
            .whereNull('revoked_at')
            .update({ revoked_at: new Date() });
          const oldEmail = (adminRow!.email || '').toLowerCase().trim();
          if (oldEmail) {
            await trx('login_attempts').where({ email: oldEmail }).del();
          }
          if (body.admin_email) {
            await trx('login_attempts').where({ email: body.admin_email.toLowerCase().trim() }).del();
          }
          passwordUpdated = true;
        }
        await trx('users').where({ id: adminRow!.id }).update(userPatch);
        if (Object.keys(profilePatch).length > 0) {
          await trx('profiles').where({ id: adminRow!.id }).update(profilePatch);
        }
      });
      adminUpdated = true;

      // Optional: notify the dealer of the new password.
      if (passwordUpdated && body.notify_password && body.new_password) {
        const targetEmail = body.admin_email
          ? body.admin_email.toLowerCase().trim()
          : adminRow.email;
        const appBase =
          process.env.APP_BASE_URL ||
          process.env.PORTAL_BASE_URL ||
          'https://app.sanitileserp.com';
        if (targetEmail) {
          sendEmail({
            to: targetEmail,
            subject: 'Tiles & Sanitary ERP — Your password has been updated',
            text:
              `Dear ${body.admin_name || adminRow.name || 'User'},\n\n` +
              `Your password was set by the system administrator.\n\n` +
              `Email: ${targetEmail}\n` +
              `New password: ${body.new_password}\n\n` +
              `Please sign in at ${appBase}/login and change it from Settings.\n\n` +
              `If you did not expect this, contact support at +880 1674 533303.\n\n` +
              `— Tiles & Sanitary ERP`,
          }).catch(() => {});
        }
        if (dealer.phone) {
          sendSms({
            to: dealer.phone,
            message:
              `আপনার পাসওয়ার্ড আপডেট হয়েছে।\n` +
              `Email: ${targetEmail || ''}\n` +
              `New password: ${body.new_password}\n` +
              `লগইন: ${appBase}/login`,
          }).catch(() => {});
        }
      }
    } else if (Object.keys(dealerUpdate).length > 0) {
      await db('dealers').where({ id: dealerId }).update(dealerUpdate);
    }

    if (Object.keys(dealerUpdate).length === 0 && !adminUpdated) {
      res.status(400).json({ error: 'No changes provided' });
      return;
    }

    const updated = await db('dealers').where({ id: dealerId }).first();
    res.json({ success: true, dealer: updated, password_updated: passwordUpdated });
  } catch (err: any) {
    if (err?.issues) {
      res.status(400).json({ error: err.issues[0]?.message || 'Invalid input' });
      return;
    }
    console.error('[dealers:update] failed:', err);
    res.status(500).json({ error: err.message || 'Update failed' });
  }
});

/**
 * DELETE /api/dealers/:id — permanently delete a dealer and ALL associated
 * data (admin/users, profiles, roles, subscriptions, refresh tokens, login
 * attempts, and any tenant-scoped records). This is irreversible.
 *
 * Requires `?confirm=<dealer_name>` query param matching the dealer's name
 * (case-insensitive) as a safety check.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const confirm = String(req.query.confirm || '').trim().toLowerCase();

    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) {
      res.status(404).json({ error: 'Dealer not found' });
      return;
    }

    if (!confirm || confirm !== String(dealer.name || '').trim().toLowerCase()) {
      res.status(400).json({
        error: 'Confirmation required: pass ?confirm=<exact dealer name> to delete.',
      });
      return;
    }

    const profileIds: string[] = await db('profiles')
      .where({ dealer_id: dealerId })
      .pluck('id');

    // Discover every public table that has a dealer_id column. This avoids
    // blowing up on schemas where some optional tables don't exist or don't
    // have a dealer_id column. We delete from these first (children before
    // parents is handled by ordering known FKs at the end).
    const dealerScopedRows = await db.raw<{ rows: { table_name: string }[] }>(
      `SELECT table_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name  = 'dealer_id'`,
    );
    const dealerScopedTables: string[] = (dealerScopedRows.rows || [])
      .map((r) => r.table_name)
      // Defer these — they're parents of other dealer-scoped rows or we
      // handle them explicitly below.
      .filter((t) => !['dealers', 'subscriptions', 'profiles'].includes(t));

    // Order: child-ish tables first (line items / movements), then parents.
    // Anything not in the priority list runs in the middle.
    const priorityFirst = [
      'sale_items', 'purchase_items',
      'sales_return_items', 'purchase_return_items',
      'delivery_items', 'challan_items',
      'quotation_items',
      'stock_movements', 'stock_reservations',
      'product_batches',
      'ledger_entries', 'audit_logs', 'notifications',
      'commissions', 'campaign_gifts',
      'payments', 'subscription_payments',
      'expenses',
    ];
    const priorityLast = [
      'sales', 'purchases', 'sales_returns', 'purchase_returns',
      'deliveries', 'challans', 'quotations',
      'products', 'customers', 'suppliers',
      'projects', 'project_sites',
    ];
    const ordered = [
      ...priorityFirst.filter((t) => dealerScopedTables.includes(t)),
      ...dealerScopedTables.filter(
        (t) => !priorityFirst.includes(t) && !priorityLast.includes(t),
      ),
      ...priorityLast.filter((t) => dealerScopedTables.includes(t)),
    ];

    await db.transaction(async (trx) => {
      // Delete each table inside its own SAVEPOINT so a failure on one
      // (e.g. FK violation, missing column on a partial schema) doesn't
      // abort the whole outer transaction.
      for (const t of ordered) {
        try {
          await trx.transaction(async (sp) => {
            await sp(t).where({ dealer_id: dealerId }).del();
          });
        } catch (e: any) {
          console.warn(
            `[dealers:delete] skipped table "${t}":`,
            e?.message || e,
          );
        }
      }

      // Now drop subscriptions explicitly (deferred above) — also savepointed.
      try {
        await trx.transaction(async (sp) => {
          await sp('subscriptions').where({ dealer_id: dealerId }).del();
        });
      } catch (e: any) {
        console.warn('[dealers:delete] skipped subscriptions:', e?.message || e);
      }

      // User-scoped cleanup, each step savepointed.
      if (profileIds.length) {
        const userSteps: Array<() => Promise<void>> = [
          async () => { await trx('refresh_tokens').whereIn('user_id', profileIds).del(); },
          async () => { await trx('user_roles').whereIn('user_id', profileIds).del(); },
          async () => {
            const emails: string[] = await trx('users').whereIn('id', profileIds).pluck('email');
            if (emails.length) {
              const lowered = emails.map((e) => (e || '').toLowerCase()).filter(Boolean);
              if (lowered.length) {
                await trx('login_attempts')
                  .whereRaw('LOWER(email) = ANY(?)', [lowered])
                  .del();
              }
            }
          },
          async () => { await trx('profiles').whereIn('id', profileIds).del(); },
          async () => { await trx('users').whereIn('id', profileIds).del(); },
        ];
        for (const step of userSteps) {
          try {
            await trx.transaction(async () => { await step(); });
          } catch (e: any) {
            console.warn('[dealers:delete] user-step skipped:', e?.message || e);
          }
        }
      }

      // Finally, the dealer row itself. If this fails we want to rollback.
      await trx('dealers').where({ id: dealerId }).del();
    });

    await recordSaAudit(req, {
      action: 'dealer.delete',
      targetType: 'dealer',
      targetId: dealerId,
      targetLabel: dealer.name,
      details: { profiles_removed: profileIds.length },
    });

    res.json({ success: true, dealer_id: dealerId, deleted: true });
  } catch (err: any) {
    console.error('[dealers:delete] failed:', err);
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

/**
 * POST /api/dealers — create a new dealer (super admin only).
 * Optionally creates a dealer_admin user and assigns a subscription in one atomic call.
 * Body: { name, phone?, address?, admin?: { name, email, password }, subscription?: { plan_id, start_date?, end_date? } }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Dealer name is required' });
      return;
    }

    const admin = body.admin && typeof body.admin === 'object' ? body.admin : null;
    const subscription = body.subscription && typeof body.subscription === 'object' ? body.subscription : null;

    if (admin) {
      if (!admin.name?.trim()) { res.status(400).json({ error: 'Admin name is required' }); return; }
      if (!admin.email?.trim()) { res.status(400).json({ error: 'Admin email is required' }); return; }
      if (!admin.password || admin.password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters' }); return;
      }
      const lower = admin.email.toLowerCase().trim();
      const clash = await db('users').whereRaw('LOWER(email) = ?', [lower]).first();
      if (clash) { res.status(409).json({ error: 'That email is already registered' }); return; }
    }

    const { authService } = await import('../services/authService');
    const passwordHash = admin ? await authService.hashPassword(admin.password) : null;

    const result = await db.transaction(async (trx) => {
      const [dealer] = await trx('dealers')
        .insert({
          name,
          phone: body.phone?.trim() || null,
          address: body.address?.trim() || null,
          status: 'active',
        })
        .returning('*');

      let adminUser: any = null;
      if (admin && passwordHash) {
        const [u] = await trx('users')
          .insert({
            email: admin.email.toLowerCase().trim(),
            password_hash: passwordHash,
            name: admin.name.trim(),
            status: 'active',
          })
          .returning('*');
        await trx('profiles').insert({
          id: u.id,
          name: admin.name.trim(),
          email: admin.email.toLowerCase().trim(),
          dealer_id: dealer.id,
        });
        await trx('user_roles')
          .insert({ user_id: u.id, role: 'dealer_admin' })
          .onConflict(['user_id', 'role'])
          .ignore();
        await trx('invoice_sequences')
          .insert({ dealer_id: dealer.id, next_invoice_no: 1, next_challan_no: 1 })
          .onConflict('dealer_id')
          .ignore();
        adminUser = u;
      }

      let sub: any = null;
      if (subscription && subscription.plan_id) {
        const { defaultSubscriptionEndDate } = await import('../lib/subscriptionEndDate');
        const today = new Date().toISOString().slice(0, 10);
        const endDate =
          subscription.end_date ||
          (await defaultSubscriptionEndDate(subscription.plan_id, trx));
        const [s] = await trx('subscriptions')
          .insert({
            dealer_id: dealer.id,
            plan_id: subscription.plan_id,
            start_date: subscription.start_date || today,
            end_date: endDate,
            status: 'active',
          })
          .returning('*');
        sub = s;
      }

      return { dealer, adminUser, sub };
    });

    res.json({ success: true, dealer: result.dealer, admin_user: result.adminUser, subscription: result.sub });

    // Best-effort: notify super admin (WhatsApp + SMS + Email) and dealer (if phone/email provided)
    if (result.adminUser || body.phone) {
      dispatchSignupNotifications({
        dealerName:   result.adminUser?.name ?? name,
        businessName: name,
        dealerPhone:  body.phone?.trim() ?? '',
        dealerEmail:  result.adminUser?.email ?? '',
        adminPhone:   env.ADMIN_PHONE,
        adminEmail:   env.ADMIN_EMAIL,
      }).catch((err) => console.error('[dealers:create] notify failed:', err));
    }
  } catch (err: any) {
    console.error('[dealers:create] failed:', err);
    res.status(500).json({ error: err.message || 'Create failed' });
  }
});

/**
 * POST /api/dealers/:id/users — add an extra dealer_admin or salesman user
 * to an existing dealer. Body: { name, email, password, role? }
 */
router.post('/:id/users', async (req: Request, res: Response) => {
  try {
    const dealerId = req.params.id;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const role = body.role === 'salesman' ? 'salesman' : 'dealer_admin';

    if (!name) { res.status(400).json({ error: 'Name is required' }); return; }
    if (!email) { res.status(400).json({ error: 'Email is required' }); return; }
    if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }

    const dealer = await db('dealers').where({ id: dealerId }).first();
    if (!dealer) { res.status(404).json({ error: 'Dealer not found' }); return; }

    const clash = await db('users').whereRaw('LOWER(email) = ?', [email]).first();
    if (clash) { res.status(409).json({ error: 'That email is already registered' }); return; }

    const { authService } = await import('../services/authService');
    const user = await authService.createUser({
      email, password, name, dealerId, role: role as any,
    });

    res.json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err: any) {
    console.error('[dealers:add-user] failed:', err);
    res.status(500).json({ error: err.message || 'Add user failed' });
  }
});

export default router;
