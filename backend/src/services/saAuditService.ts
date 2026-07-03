/**
 * Super Admin audit trail recorder.
 *
 * Call recordSaAudit() from any super-admin route after a state-changing
 * action. It is best-effort: failures are logged, never thrown, so audit
 * recording can never break the action it is logging.
 */
import type { Request } from 'express';
import { db } from '../db/connection';

export interface SaAuditInput {
  action: string;               // 'dealer.suspend', 'plan.update', 'subscription.extend', ...
  targetType?: string;          // 'dealer' | 'plan' | 'subscription' | 'announcement' | ...
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
}

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

export async function recordSaAudit(req: Request, input: SaAuditInput): Promise<void> {
  try {
    await db('sa_audit_log').insert({
      actor_user_id: (req.user as any)?.userId ?? null,
      actor_email: req.user?.email ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
      ip_address: clientIp(req),
      user_agent: (req.headers['user-agent'] as string | undefined)?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.error('[saAudit] failed to record', input.action, (err as Error).message);
  }
}
