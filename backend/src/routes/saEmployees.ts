/**
 * Super Admin — Employee Account Management
 * All routes require super_admin role.
 * Employees themselves use sa_employee role and can only read their own permissions.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import bcrypt from 'bcryptjs';
import { recordSaAudit } from '../services/saAuditService';
import { sendEmail } from '../services/notificationService';
import { env } from '../config/env';

const router = Router();

// ── Permission shape ────────────────────────────────────────────────────────
const permSchema = z.object({
  can_manage_dealers:       z.boolean().default(false),
  can_manage_subscriptions: z.boolean().default(false),
  can_view_financials:      z.boolean().default(false),
  can_send_reminders:       z.boolean().default(false),
  can_view_audit_log:       z.boolean().default(false),
  can_manage_announcements: z.boolean().default(false),
  can_view_dealer_users:    z.boolean().default(false),
});

const createSchema = z.object({
  name:        z.string().min(2),
  email:       z.string().email(),
  phone:       z.string().optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  notes:       z.string().max(500).optional().nullable(),
  permissions: permSchema,
});

const updateSchema = z.object({
  name:        z.string().min(2).optional(),
  phone:       z.string().optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  notes:       z.string().max(500).optional().nullable(),
  status:      z.enum(['active', 'inactive']).optional(),
  permissions: permSchema.partial().optional(),
});

// ── All routes require super_admin ──────────────────────────────────────────
router.use(authenticate, requireRole('super_admin'));

/** GET /api/sa/employees — list all SA employees */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .leftJoin('profiles as pr', 'pr.id', 'u.id')
      .leftJoin('sa_employee_permissions as ep', 'ep.user_id', 'u.id')
      .where('ur.role', 'sa_employee')
      .select(
        'u.id', 'u.email', 'u.status', 'u.created_at',
        'pr.name',
        'ep.phone', 'ep.designation', 'ep.notes',
        'ep.can_manage_dealers', 'ep.can_manage_subscriptions',
        'ep.can_view_financials', 'ep.can_send_reminders',
        'ep.can_view_audit_log', 'ep.can_manage_announcements',
        'ep.can_view_dealer_users',
      )
      .orderBy('u.created_at', 'desc');

    res.json({ employees: rows });
  } catch (err: any) {
    console.error('[sa-employees:list]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/sa/employees/me — employee reads own permissions (used by frontend) */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    const ep = await db('sa_employee_permissions').where({ user_id: userId }).first();
    res.json({ permissions: ep ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/sa/employees — create new SA employee */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Check email not already in use
    const existing = await db('users').where({ email: body.email.toLowerCase() }).first();
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Generate a temp password
    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';

    const userId = await db.transaction(async (trx) => {
      const hash = await bcrypt.hash(tempPassword, 10);
      const [newUser] = await trx('users')
        .insert({ email: body.email.toLowerCase(), password_hash: hash, status: 'active', name: body.name.trim() })
        .returning('id');
      const newUserId: string = newUser.id;

      await trx('profiles').insert({
        id: newUserId,
        name: body.name.trim(),
        email: body.email.toLowerCase(),
        dealer_id: null,
      });

      await trx('user_roles').insert({ user_id: newUserId, role: 'sa_employee' });

      // Insert permission row
      await trx('sa_employee_permissions').insert({
        user_id: newUserId,
        phone: body.phone ?? null,
        designation: body.designation ?? null,
        notes: body.notes ?? null,
        ...body.permissions,
      });

      return newUserId;
    });

    // Send welcome email with temp password
    await sendEmail({
      to: body.email,
      subject: 'Welcome to Tiles ERP — Your Employee Account',
      text: `Hello ${body.name}, your employee account has been created. Email: ${body.email}, Temp Password: ${tempPassword}. Login at: ${env.APP_PUBLIC_URL ?? 'https://sanitileserp.com'}/login`,
      html: `<p>Hello ${body.name},</p><p>Your employee account has been created for the Tiles &amp; Sanitary ERP Super Admin panel.</p><p><strong>Email:</strong> ${body.email}</p><p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p><p>Please change your password after first login.</p><p>— Tiles ERP Admin Team</p>`,
    }).catch(() => {}); // best-effort

    await recordSaAudit(req, {
      action: 'sa_employee.create',
      targetType: 'sa_employee',
      targetId: userId,
      targetLabel: body.name,
      details: { email: body.email, designation: body.designation, permissions: body.permissions },
    });

    const created = await db('users as u')
      .join('sa_employee_permissions as ep', 'ep.user_id', 'u.id')
      .where('u.id', userId)
      .select('u.id', 'u.email', 'u.status', 'ep.designation')
      .first();

    res.status(201).json({ employee: created, tempPassword });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message });
    console.error('[sa-employees:create]', err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/sa/employees/:id — update employee details or permissions */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const { id } = req.params;

    // Verify this is an sa_employee
    const emp = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .where({ 'u.id': id, 'ur.role': 'sa_employee' })
      .select('u.id', 'u.email')
      .first();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    await db.transaction(async (trx) => {
      if (body.status) {
        await trx('users').where({ id }).update({ status: body.status, updated_at: trx.fn.now() });
      }
      if (body.name) {
        await trx('profiles').where({ id }).update({ name: body.name, updated_at: trx.fn.now() });
      }
      const epUpdate: Record<string, any> = { updated_at: trx.fn.now() };
      if (body.phone !== undefined) epUpdate.phone = body.phone;
      if (body.designation !== undefined) epUpdate.designation = body.designation;
      if (body.notes !== undefined) epUpdate.notes = body.notes;
      if (body.permissions) Object.assign(epUpdate, body.permissions);
      await trx('sa_employee_permissions').where({ user_id: id }).update(epUpdate);
    });

    await recordSaAudit(req, {
      action: 'sa_employee.update',
      targetType: 'sa_employee',
      targetId: id,
      targetLabel: emp.email,
      details: body,
    });

    res.json({ ok: true });
  } catch (err: any) {
    if (err?.issues) return res.status(400).json({ error: err.issues[0]?.message });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/sa/employees/:id — deactivate (not hard delete) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const emp = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .where({ 'u.id': id, 'ur.role': 'sa_employee' })
      .select('u.id', 'u.email', 'u.status')
      .first();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    await db('users').where({ id }).update({ status: 'inactive', updated_at: db.fn.now() });

    await recordSaAudit(req, {
      action: 'sa_employee.deactivate',
      targetType: 'sa_employee',
      targetId: id,
      targetLabel: emp.email,
      details: { previousStatus: emp.status },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/sa/employees/:id/reset-password — generate and send new temp password */
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const emp = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('profiles as pr', 'pr.id', 'u.id')
      .where({ 'u.id': id, 'ur.role': 'sa_employee' })
      .select('u.email', 'pr.name')
      .first();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const tempPassword = Math.random().toString(36).slice(-8) + 'B2@';
    const hash = await bcrypt.hash(tempPassword, 10);
    await db('users').where({ id }).update({ password_hash: hash, updated_at: db.fn.now() });

    await sendEmail({
      to: emp.email,
      subject: 'Tiles ERP — Password Reset',
      text: `Hi ${emp.name}, your temporary password is: ${tempPassword}. Please change it after login.`,
      html: `<p>Hi ${emp.name}, your temporary password is: <strong>${tempPassword}</strong>. Please change it after login.</p>`,
    }).catch(() => {});

    await recordSaAudit(req, {
      action: 'sa_employee.password_reset',
      targetType: 'sa_employee',
      targetId: id,
      targetLabel: emp.email,
      details: {},
    });

    res.json({ ok: true, tempPassword });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
