/**
 * Portal API — Phase 6 (P6-03).
 *
 * Dealer admin (tenantGuard):
 *   GET   /api/portal/users?dealerId=
 *   PATCH /api/portal/users/:id
 *   GET   /api/portal/requests?dealerId=        — dealer-side request inbox
 *
 * Portal user (portalGuard — VPS JWT + active portal_users row):
 *   GET   /api/portal/context
 *   POST  /api/portal/bind
 *   POST  /api/portal/touch-login
 *   GET   /api/portal/outstanding
 *   GET   /api/portal/payments/recent?limit=
 *   GET   /api/portal/ledger?limit=
 *   GET   /api/portal/quotations
 *   GET   /api/portal/sales
 *   GET   /api/portal/deliveries
 *   GET   /api/portal/projects
 *   GET   /api/portal/sites
 *   GET   /api/portal/projects/:id/summary
 *   GET   /api/portal/requests/my
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { portalGuard } from '../middleware/portalGuard';
import { requireRole } from '../middleware/roles';
import {
  bindPortalAuthUser,
  touchPortalLastLogin,
  getPortalOutstandingSummary,
  getPortalRecentPayments,
  getPortalLedgerHistory,
  listPortalQuotations,
  listPortalSales,
  listPortalDeliveries,
  listPortalProjects,
  listPortalSites,
  getPortalProjectSummary,
  listMyPortalRequests,
  listDealerPortalRequests,
  submitPortalRequest,
  getPortalSaleItems,
  updatePortalRequest,
  getPortalQuotationDoc,
  getPortalInvoiceDoc,
  getPortalChallanDoc,
  getPortalWhatsAppStatus,
} from '../services/portalReadService';
import { invitePortalUser } from '../services/portalInviteService';
import {
  submitPortalPaymentRequest,
  listMyPortalPaymentRequests,
  listDealerPortalPaymentRequests,
  updatePortalPaymentRequest,
} from '../services/portalPaymentRequestService';

const router = Router();

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
    undefined;
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned to your account' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

function portalScope(req: Request): { dealerId: string; customerId: string } | null {
  const ctx = req.portalContext;
  if (!ctx) return null;
  return { dealerId: ctx.dealerId, customerId: ctx.customerId };
}

// ── Portal session helpers ─────────────────────────────────────────────

router.get('/context', authenticate, portalGuard, async (req: Request, res: Response) => {
  const ctx = req.portalContext!;
  res.json({
    dealer_id: ctx.dealerId,
    customer_id: ctx.customerId,
    portal_user_id: ctx.portalUserId,
    portal_role: ctx.portalRole,
    name: ctx.name,
    email: ctx.email,
  });
});

router.post('/bind', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user?.userId || !req.user.email) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const row = await bindPortalAuthUser(req.user.userId, req.user.email);
    res.json({ ok: true, bound: !!row, portal_user: row });
  } catch (err: any) {
    if (err.code === 'FORBIDDEN') {
      res.status(403).json({ error: err.message });
      return;
    }
    console.error('[portal/bind]', err.message);
    res.status(500).json({ error: 'Failed to bind portal user' });
  }
});

router.post('/touch-login', authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    await touchPortalLastLogin(req.user.userId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[portal/touch-login]', err.message);
    res.status(500).json({ error: 'Failed to update login timestamp' });
  }
});

// ── Portal dashboard reads ─────────────────────────────────────────────

router.get('/outstanding', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const summary = await getPortalOutstandingSummary(scope.dealerId, scope.customerId);
    res.json(summary);
  } catch (err: any) {
    console.error('[portal/outstanding]', err.message);
    res.status(500).json({ error: 'Failed to load outstanding summary' });
  }
});

router.get('/payments/recent', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const limit = Number(req.query.limit) || 10;
    const rows = await getPortalRecentPayments(scope.dealerId, scope.customerId, limit);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/payments/recent]', err.message);
    res.status(500).json({ error: 'Failed to load recent payments' });
  }
});

router.get('/ledger', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const limit = Number(req.query.limit) || 30;
    const rows = await getPortalLedgerHistory(scope.dealerId, scope.customerId, limit);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/ledger]', err.message);
    res.status(500).json({ error: 'Failed to load ledger history' });
  }
});

router.get('/quotations', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listPortalQuotations(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/quotations]', err.message);
    res.status(500).json({ error: 'Failed to load quotations' });
  }
});

router.get('/sales', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listPortalSales(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/sales]', err.message);
    res.status(500).json({ error: 'Failed to load sales' });
  }
});

router.get('/deliveries', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listPortalDeliveries(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/deliveries]', err.message);
    res.status(500).json({ error: 'Failed to load deliveries' });
  }
});

router.get('/projects', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listPortalProjects(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/projects]', err.message);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

router.get('/sites', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listPortalSites(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/sites]', err.message);
    res.status(500).json({ error: 'Failed to load sites' });
  }
});

router.get('/projects/:id/summary', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const summary = await getPortalProjectSummary(
      scope.dealerId,
      scope.customerId,
      req.params.id,
    );
    if ('error' in summary) {
      res.status(summary.error === 'not_found' ? 404 : 403).json({ error: summary.error });
      return;
    }
    res.json(summary);
  } catch (err: any) {
    console.error('[portal/projects/summary]', err.message);
    res.status(500).json({ error: 'Failed to load project summary' });
  }
});

router.get('/requests/my', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listMyPortalRequests(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/requests/my]', err.message);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

const submitRequestSchema = z.object({
  request_type: z.enum(['reorder', 'quote']),
  source_sale_id: z.string().uuid().optional().nullable(),
  source_quotation_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  site_id: z.string().uuid().optional().nullable(),
  message: z.string().trim().max(5000).optional().nullable(),
  items: z.array(z.record(z.unknown())).optional(),
});

router.post('/requests', authenticate, portalGuard, async (req, res) => {
  try {
    const ctx = req.portalContext!;
    const parsed = submitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const id = await submitPortalRequest(
      {
        dealerId: ctx.dealerId,
        customerId: ctx.customerId,
        portalUserId: ctx.portalUserId,
      },
      parsed.data,
    );
    res.status(201).json({ id });
  } catch (err: any) {
    console.error('[portal/requests POST]', err.message);
    res.status(400).json({ error: err.message || 'Failed to submit request' });
  }
});

router.get('/sales/:saleId/items', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await getPortalSaleItems(scope.dealerId, scope.customerId, req.params.saleId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/sales/items]', err.message);
    res.status(err.message === 'forbidden' ? 403 : 500).json({ error: err.message });
  }
});

router.get('/sales/:saleId/doc', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const doc = await getPortalInvoiceDoc(scope.dealerId, scope.customerId, req.params.saleId);
    res.json(doc);
  } catch (err: any) {
    console.error('[portal/sales/doc]', err.message);
    res.status(err.message === 'forbidden' ? 403 : 500).json({ error: err.message });
  }
});

router.get('/quotations/:quotationId/doc', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const doc = await getPortalQuotationDoc(
      scope.dealerId,
      scope.customerId,
      req.params.quotationId,
    );
    res.json(doc);
  } catch (err: any) {
    console.error('[portal/quotations/doc]', err.message);
    res.status(err.message === 'forbidden' ? 403 : 500).json({ error: err.message });
  }
});

router.get('/challans/:challanId/doc', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const doc = await getPortalChallanDoc(
      scope.dealerId,
      scope.customerId,
      req.params.challanId,
    );
    res.json(doc);
  } catch (err: any) {
    console.error('[portal/challans/doc]', err.message);
    res.status(err.message === 'forbidden' ? 403 : 500).json({ error: err.message });
  }
});

router.get('/whatsapp/status', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const sourceType = String(req.query.source_type ?? req.query.sourceType ?? '');
    const sourceId = String(req.query.source_id ?? req.query.sourceId ?? '');
    if (!['quotation', 'sale', 'delivery'].includes(sourceType) || !sourceId) {
      res.status(400).json({ error: 'source_type and source_id required' });
      return;
    }
    const status = await getPortalWhatsAppStatus(
      scope.dealerId,
      scope.customerId,
      sourceType as 'quotation' | 'sale' | 'delivery',
      sourceId,
    );
    res.json({ status });
  } catch (err: any) {
    console.error('[portal/whatsapp/status]', err.message);
    res.status(500).json({ error: 'Failed to load WhatsApp status' });
  }
});

const paymentRequestSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_mode: z.string().trim().min(1).max(30),
  reference_no: z.string().trim().max(120).optional().nullable(),
  sale_id: z.string().uuid().optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
});

router.get('/payment-requests/my', authenticate, portalGuard, async (req, res) => {
  try {
    const scope = portalScope(req);
    if (!scope) return res.status(403).json({ error: 'Portal context required' });
    const rows = await listMyPortalPaymentRequests(scope.dealerId, scope.customerId);
    res.json({ rows });
  } catch (err: any) {
    console.error('[portal/payment-requests/my]', err.message);
    res.status(500).json({ error: 'Failed to load payment requests' });
  }
});

router.post('/payment-requests', authenticate, portalGuard, async (req, res) => {
  try {
    const ctx = req.portalContext!;
    const parsed = paymentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const id = await submitPortalPaymentRequest(
      {
        dealerId: ctx.dealerId,
        customerId: ctx.customerId,
        portalUserId: ctx.portalUserId,
      },
      parsed.data,
    );
    res.status(201).json({ id });
  } catch (err: any) {
    console.error('[portal/payment-requests POST]', err.message);
    res.status(400).json({ error: err.message || 'Failed to submit payment request' });
  }
});

// ── Dealer admin ───────────────────────────────────────────────────────

router.get(
  '/users',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await db('portal_users')
        .where({ dealer_id: dealerId })
        .orderBy('created_at', 'desc');
      res.json({ rows });
    } catch (err: any) {
      console.error('[portal/users GET]', err.message);
      res.status(500).json({ error: 'Failed to load portal users' });
    }
  },
);

const statusSchema = z.object({
  dealerId: z.string().uuid().optional(),
  status: z.enum(['invited', 'active', 'inactive', 'revoked']),
});

router.patch(
  '/users/:id',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
        return;
      }
      const { status } = parsed.data;
      const patch: Record<string, unknown> = {
        status,
        updated_at: db.fn.now(),
      };
      if (status === 'active') {
        patch.activated_at = db.fn.now();
      }
      const updated = await db('portal_users')
        .where({ id: req.params.id, dealer_id: dealerId })
        .update(patch)
        .returning('*');
      if (!updated.length) {
        res.status(404).json({ error: 'Portal user not found' });
        return;
      }
      res.json({ row: updated[0] });
    } catch (err: any) {
      console.error('[portal/users PATCH]', err.message);
      res.status(500).json({ error: 'Failed to update portal user' });
    }
  },
);

const inviteSchema = z.object({
  dealerId: z.string().uuid().optional(),
  customer_id: z.string().uuid(),
  email: z.string().email().max(255),
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional(),
  portal_role: z.enum(['contractor', 'architect', 'project_customer']).optional(),
  send_magic_link: z.boolean().optional(),
});

router.post(
  '/users/invite',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
        return;
      }
      const result = await invitePortalUser({
        dealerId,
        customerId: parsed.data.customer_id,
        email: parsed.data.email,
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        portalRole: parsed.data.portal_role,
        invitedBy: req.user?.userId ?? null,
        issueTempPassword: parsed.data.send_magic_link !== false,
      });
      res.status(201).json({
        success: true,
        portal_user: result.portal_user,
        magic_link: result.temp_password
          ? `Use email ${parsed.data.email} with temporary password: ${result.temp_password}`
          : null,
        temp_password: result.temp_password,
      });
    } catch (err: any) {
      const code = err.code as string | undefined;
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      if (code === 'CONFLICT') {
        res.status(409).json({ error: err.message });
        return;
      }
      console.error('[portal/users/invite]', err.message);
      res.status(500).json({ error: err.message || 'Failed to invite portal user' });
    }
  },
);

router.get(
  '/requests',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin', 'salesman', 'manager'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await listDealerPortalRequests(dealerId);
      res.json({ rows });
    } catch (err: any) {
      console.error('[portal/requests GET]', err.message);
      res.status(500).json({ error: 'Failed to load portal requests' });
    }
  },
);

const updateRequestSchema = z.object({
  dealerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'reviewed', 'converted', 'closed']).optional(),
  review_note: z.string().trim().max(5000).optional().nullable(),
  converted_quotation_id: z.string().uuid().optional().nullable(),
});

router.patch(
  '/requests/:id',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin', 'salesman', 'manager'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = updateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
        return;
      }
      const row = await updatePortalRequest(dealerId, req.params.id, {
        status: parsed.data.status,
        review_note: parsed.data.review_note,
        reviewed_by: req.user?.userId ?? null,
        converted_quotation_id: parsed.data.converted_quotation_id,
      });
      res.json({ row });
    } catch (err: any) {
      console.error('[portal/requests PATCH]', err.message);
      res.status(err.message === 'Request not found' ? 404 : 500).json({
        error: err.message || 'Failed to update request',
      });
    }
  },
);

router.get(
  '/payment-requests',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin', 'salesman', 'manager', 'accountant'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await listDealerPortalPaymentRequests(dealerId);
      res.json({ rows });
    } catch (err: any) {
      console.error('[portal/payment-requests GET]', err.message);
      res.status(500).json({ error: 'Failed to load payment requests' });
    }
  },
);

const updatePaymentRequestSchema = z.object({
  dealerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'reviewed', 'approved', 'rejected', 'applied']).optional(),
  review_note: z.string().trim().max(5000).optional().nullable(),
  applied_ledger_id: z.string().uuid().optional().nullable(),
});

router.patch(
  '/payment-requests/:id',
  authenticate,
  tenantGuard,
  requireRole('dealer_admin', 'super_admin', 'salesman', 'manager', 'accountant'),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = updatePaymentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
        return;
      }
      const row = await updatePortalPaymentRequest(dealerId, req.params.id, {
        status: parsed.data.status,
        review_note: parsed.data.review_note,
        reviewed_by: req.user?.userId ?? null,
        applied_ledger_id: parsed.data.applied_ledger_id,
      });
      res.json({ row });
    } catch (err: any) {
      console.error('[portal/payment-requests PATCH]', err.message);
      res.status(err.message === 'Payment request not found' ? 404 : 500).json({
        error: err.message || 'Failed to update payment request',
      });
    }
  },
);

export default router;
