/**
 * P6-04 — Portal payment request workflow.
 */
import { db } from '../db/connection';

export type PortalPaymentRequestStatus =
  | 'pending'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'applied';

const MODES_REQUIRING_REF = new Set(['bkash', 'nagad', 'bank', 'cheque', 'card', 'sslcommerz']);

export async function submitPortalPaymentRequest(
  ctx: { dealerId: string; customerId: string; portalUserId: string },
  input: {
    amount: number;
    payment_mode: string;
    reference_no?: string | null;
    sale_id?: string | null;
    message?: string | null;
  },
) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const mode = input.payment_mode.trim().toLowerCase();
  if (!mode) throw new Error('Payment mode is required');

  const ref = input.reference_no?.trim() || null;
  if (MODES_REQUIRING_REF.has(mode) && !ref) {
    throw new Error('Transaction / reference number is required for this payment mode');
  }

  if (input.sale_id) {
    const sale = await db('sales')
      .where({
        id: input.sale_id,
        dealer_id: ctx.dealerId,
        customer_id: ctx.customerId,
      })
      .first('id');
    if (!sale) throw new Error('Invoice not found for your account');
  }

  const [row] = await db('portal_payment_requests')
    .insert({
      dealer_id: ctx.dealerId,
      customer_id: ctx.customerId,
      portal_user_id: ctx.portalUserId,
      amount,
      payment_mode: mode,
      reference_no: ref,
      sale_id: input.sale_id ?? null,
      message: input.message?.trim() || null,
      status: 'pending',
    })
    .returning('id');

  return row.id as string;
}

export async function listMyPortalPaymentRequests(dealerId: string, customerId: string) {
  return db('portal_payment_requests as p')
    .leftJoin('sales as s', 's.id', 'p.sale_id')
    .where({ 'p.dealer_id': dealerId, 'p.customer_id': customerId })
    .orderBy('p.created_at', 'desc')
    .select('p.*', 's.invoice_number');
}

export async function listDealerPortalPaymentRequests(dealerId: string) {
  return db('portal_payment_requests as p')
    .leftJoin('customers as c', 'c.id', 'p.customer_id')
    .leftJoin('sales as s', 's.id', 'p.sale_id')
    .where('p.dealer_id', dealerId)
    .orderBy('p.created_at', 'desc')
    .select(
      'p.*',
      'c.name as customer_name',
      's.invoice_number',
    );
}

export async function updatePortalPaymentRequest(
  dealerId: string,
  requestId: string,
  patch: {
    status?: PortalPaymentRequestStatus;
    review_note?: string | null;
    reviewed_by?: string | null;
    applied_ledger_id?: string | null;
  },
) {
  const existing = await db('portal_payment_requests')
    .where({ id: requestId, dealer_id: dealerId })
    .first();
  if (!existing) throw new Error('Payment request not found');

  const updates: Record<string, unknown> = { updated_at: db.fn.now() };
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status !== 'pending') {
      updates.reviewed_at = db.fn.now();
    }
  }
  if (patch.review_note !== undefined) updates.review_note = patch.review_note;
  if (patch.reviewed_by !== undefined) updates.reviewed_by = patch.reviewed_by;
  if (patch.applied_ledger_id !== undefined) {
    updates.applied_ledger_id = patch.applied_ledger_id;
  }

  const [row] = await db('portal_payment_requests')
    .where({ id: requestId, dealer_id: dealerId })
    .update(updates)
    .returning('*');
  return row;
}
