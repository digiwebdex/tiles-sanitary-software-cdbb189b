/**
 * Portal user invite — VPS replacement for invite-portal-user edge function (P6-03).
 */
import crypto from 'crypto';
import { db } from '../db/connection';
import { authService } from './authService';

export type PortalRole = 'contractor' | 'architect' | 'project_customer';

export interface InvitePortalUserInput {
  dealerId: string;
  customerId: string;
  email: string;
  name: string;
  phone?: string | null;
  portalRole?: PortalRole;
  invitedBy: string | null;
  issueTempPassword?: boolean;
}

export async function invitePortalUser(input: InvitePortalUserInput) {
  const email = input.email.trim().toLowerCase();
  const portalRole = input.portalRole ?? 'contractor';

  const customer = await db('customers')
    .where({ id: input.customerId, dealer_id: input.dealerId })
    .first('id', 'dealer_id', 'name');
  if (!customer) {
    const err: any = new Error('Customer not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const existingPortal = await db('portal_users')
    .where({ dealer_id: input.dealerId, email })
    .first();

  if (existingPortal && existingPortal.status !== 'revoked') {
    const err: any = new Error('A portal user with this email already exists for this dealer');
    err.code = 'CONFLICT';
    throw err;
  }

  let authUserId: string | null = null;
  let tempPassword: string | null = null;

  const existingUser = await db('users').where({ email }).first('id');
  if (existingUser) {
    const dealerStaff = await db('user_roles')
      .where({ user_id: existingUser.id })
      .whereIn('role', ['dealer_admin', 'manager', 'accountant', 'salesman', 'super_admin'])
      .first();
    if (dealerStaff) {
      const err: any = new Error('This email belongs to a dealer staff account');
      err.code = 'CONFLICT';
      throw err;
    }
    authUserId = existingUser.id;
  } else if (input.issueTempPassword !== false) {
    tempPassword = crypto.randomBytes(9).toString('base64url');
    const created = await authService.createPortalIdentity({
      email,
      password: tempPassword,
      name: input.name,
    });
    authUserId = created.id;
  } else {
    const err: any = new Error('User does not exist; enable temp password for new invites');
    err.code = 'USER_REQUIRED';
    throw err;
  }

  let portalRow;
  if (existingPortal) {
    const [row] = await db('portal_users')
      .where({ id: existingPortal.id })
      .update({
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        portal_role: portalRole,
        customer_id: input.customerId,
        auth_user_id: authUserId,
        status: 'invited',
        invited_at: db.fn.now(),
        invited_by: input.invitedBy,
        updated_at: db.fn.now(),
      })
      .returning('*');
    portalRow = row;
  } else {
    const [row] = await db('portal_users')
      .insert({
        dealer_id: input.dealerId,
        customer_id: input.customerId,
        email,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        portal_role: portalRole,
        auth_user_id: authUserId,
        status: 'invited',
        invited_by: input.invitedBy,
      })
      .returning('*');
    portalRow = row;
  }

  return {
    portal_user: portalRow,
    temp_password: tempPassword,
    magic_link: null as string | null,
  };
}
