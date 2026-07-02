/**
 * Portal read queries — mirrors Supabase portal RPCs (P6-03).
 */
import { db } from '../db/connection';
import { computeCustomerBalance } from '../lib/ledgerBalance';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function bindPortalAuthUser(userId: string, email: string) {
  const normalized = email.toLowerCase().trim();

  // Dealer staff must never be allowed to claim a portal identity (mirrors the
  // check applied at invite time in invitePortalUser).
  const dealerRole = await db('user_roles')
    .where({ user_id: userId })
    .whereIn('role', ['dealer_admin', 'manager', 'accountant', 'salesman', 'super_admin'])
    .first('id');
  if (dealerRole) {
    const err: any = new Error('Dealer staff accounts cannot bind to portal identities');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const updated = await db('portal_users')
    .whereRaw('lower(email) = ?', [normalized])
    .whereNull('auth_user_id')
    .whereIn('status', ['invited', 'active'])
    .update({
      auth_user_id: userId,
      activated_at: db.fn.now(),
      status: db.raw(`CASE WHEN status = 'invited' THEN 'active' ELSE status END`),
      last_login_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*');
  return updated[0] ?? null;
}

export async function touchPortalLastLogin(userId: string) {
  await db('portal_users')
    .where({ auth_user_id: userId })
    .update({
      last_login_at: db.fn.now(),
      activated_at: db.raw('COALESCE(activated_at, NOW())'),
      status: db.raw(`CASE WHEN status = 'invited' THEN 'active' ELSE status END`),
      updated_at: db.fn.now(),
    });
}

export async function getPortalOutstandingSummary(dealerId: string, customerId: string) {
  const rows = await db('customer_ledger')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .select('type', 'amount');

  const total_billed = rows
    .filter((r) => r.type === 'sale' || r.type === 'adjustment')
    .reduce((s, r) => s + Number(r.amount), 0);
  const total_paid = rows
    .filter((r) => r.type === 'payment')
    .reduce((s, r) => s + Number(r.amount), 0);
  const outstanding = computeCustomerBalance(rows);

  const lastPayment = await db('customer_ledger')
    .where({ dealer_id: dealerId, customer_id: customerId, type: 'payment' })
    .orderBy('entry_date', 'desc')
    .orderBy('created_at', 'desc')
    .first('entry_date', 'amount');

  return {
    outstanding: round2(outstanding),
    total_billed: round2(total_billed),
    total_paid: round2(total_paid),
    last_payment_date: lastPayment?.entry_date ?? null,
    last_payment_amount: lastPayment ? Number(lastPayment.amount) : null,
  };
}

export async function getPortalRecentPayments(
  dealerId: string,
  customerId: string,
  limit = 10,
) {
  const cap = Math.min(50, Math.max(1, limit));
  return db('customer_ledger')
    .where({ dealer_id: dealerId, customer_id: customerId, type: 'payment' })
    .orderBy('entry_date', 'desc')
    .orderBy('created_at', 'desc')
    .limit(cap)
    .select('entry_date', 'amount', 'description', 'sale_id');
}

export async function getPortalLedgerHistory(
  dealerId: string,
  customerId: string,
  limit = 30,
) {
  const cap = Math.max(1, Math.min(100, limit));
  const rows = await db('customer_ledger as cl')
    .leftJoin('sales as s', 's.id', 'cl.sale_id')
    .where('cl.dealer_id', dealerId)
    .where('cl.customer_id', customerId)
    .whereIn('cl.type', ['sale', 'payment', 'return', 'opening_balance', 'adjustment'])
    .orderBy('cl.entry_date', 'desc')
    .orderBy('cl.created_at', 'desc')
    .limit(cap)
    .select(
      'cl.entry_date',
      'cl.type as entry_type',
      'cl.amount',
      'cl.description',
      's.invoice_number as reference_no',
      'cl.sale_id',
    );
  return rows;
}

export async function listPortalQuotations(dealerId: string, customerId: string) {
  return db('quotations')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select(
      'id',
      'quotation_no',
      'revision_no',
      'quote_date',
      'valid_until',
      'status',
      'total_amount',
    );
}

export async function listPortalSales(dealerId: string, customerId: string) {
  return db('sales')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select(
      'id',
      'invoice_number',
      'sale_date',
      'sale_status',
      'total_amount',
      'paid_amount',
      'due_amount',
    );
}

export async function listPortalDeliveries(dealerId: string, customerId: string) {
  const sales = await db('sales')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .select('id', 'invoice_number');
  const saleIds = sales.map((s) => s.id);
  if (!saleIds.length) return [];

  const byInvoice = new Map(sales.map((s) => [s.id, s.invoice_number]));
  const deliveries = await db('deliveries')
    .whereIn('sale_id', saleIds)
    .orderBy('delivery_date', 'desc')
    .select(
      'id',
      'delivery_no',
      'delivery_date',
      'status',
      'sale_id',
      'challan_id',
      'receiver_name',
      'delivery_address',
      'notes',
    );

  return deliveries.map((d) => ({
    ...d,
    invoice_number: byInvoice.get(d.sale_id) ?? null,
  }));
}

export async function listPortalProjects(dealerId: string, customerId: string) {
  return db('projects')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select('id', 'project_code', 'project_name', 'status', 'start_date', 'expected_end_date');
}

export async function listPortalSites(dealerId: string, customerId: string) {
  return db('project_sites')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select('id', 'site_name', 'address', 'status', 'project_id');
}

export async function getPortalProjectSummary(
  dealerId: string,
  customerId: string,
  projectId: string,
) {
  const project = await db('projects')
    .where({ id: projectId, dealer_id: dealerId, customer_id: customerId })
    .first(
      'id',
      'project_code',
      'project_name',
      'status',
      'start_date',
      'expected_end_date',
      'notes',
    );
  if (!project) return { error: 'not_found' as const };

  const sites = await db('project_sites')
    .where({ project_id: projectId, customer_id: customerId })
    .orderBy('site_name')
    .select('id', 'site_name', 'address', 'status');

  const quotations = await db('quotations')
    .where({ project_id: projectId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select('id', 'quotation_no', 'revision_no', 'quote_date', 'status', 'total_amount');

  const sales = await db('sales')
    .where({ project_id: projectId, customer_id: customerId })
    .orderBy('created_at', 'desc')
    .select(
      'id',
      'invoice_number',
      'sale_date',
      'sale_status',
      'total_amount',
      'paid_amount',
      'due_amount',
    );

  const saleIds = sales.map((s) => s.id);
  let deliveries: any[] = [];
  if (saleIds.length) {
    const byInv = new Map(sales.map((s) => [s.id, s.invoice_number]));
    deliveries = await db('deliveries')
      .whereIn('sale_id', saleIds)
      .orderBy('delivery_date', 'desc')
      .select('id', 'delivery_no', 'delivery_date', 'status', 'sale_id');
    deliveries = deliveries.map((d) => ({
      ...d,
      invoice_number: byInv.get(d.sale_id) ?? null,
    }));
  }

  // Aggregate ordered vs delivered qty per product for this project
  const saleItems = saleIds.length
    ? await db('sale_items as si')
        .join('products as p', 'p.id', 'si.product_id')
        .whereIn('si.sale_id', saleIds)
        .groupBy('si.product_id', 'p.name', 'p.sku', 'p.unit_type')
        .select(
          'si.product_id',
          'p.name as product_name',
          'p.sku as product_sku',
          'p.unit_type',
          db.raw('SUM(si.quantity) as ordered_qty'),
        )
    : [];

  const deliveredItems = saleIds.length
    ? await db('delivery_items as di')
        .join('deliveries as d', 'd.id', 'di.delivery_id')
        .whereIn('d.sale_id', saleIds)
        .groupBy('di.product_id')
        .select('di.product_id', db.raw('SUM(di.quantity) as delivered_qty'))
    : [];

  const deliveredMap = new Map(
    deliveredItems.map((r) => [r.product_id, Number(r.delivered_qty ?? 0)]),
  );

  const items = saleItems.map((row) => {
    const ordered = Number(row.ordered_qty ?? 0);
    const delivered = deliveredMap.get(row.product_id) ?? 0;
    return {
      product_id: row.product_id,
      product_name: row.product_name,
      product_sku: row.product_sku,
      unit_type: row.unit_type,
      ordered_qty: ordered,
      delivered_qty: delivered,
      pending_qty: Math.max(0, ordered - delivered),
    };
  });

  return {
    project,
    sites,
    quotations,
    sales,
    deliveries,
    items,
  };
}

export async function listMyPortalRequests(dealerId: string, customerId: string) {
  return db('portal_requests')
    .where({ dealer_id: dealerId, customer_id: customerId })
    .orderBy('created_at', 'desc');
}

export async function listDealerPortalRequests(dealerId: string) {
  return db('portal_requests').where({ dealer_id: dealerId }).orderBy('created_at', 'desc');
}

export async function submitPortalRequest(
  ctx: { dealerId: string; customerId: string; portalUserId: string },
  input: {
    request_type: 'reorder' | 'quote';
    source_sale_id?: string | null;
    source_quotation_id?: string | null;
    project_id?: string | null;
    site_id?: string | null;
    message?: string | null;
    items?: unknown[];
  },
) {
  const { dealerId, customerId, portalUserId } = ctx;

  if (input.source_sale_id) {
    const ok = await db('sales')
      .where({ id: input.source_sale_id, customer_id: customerId, dealer_id: dealerId })
      .first('id');
    if (!ok) throw new Error('forbidden: sale not in scope');
  }
  if (input.source_quotation_id) {
    const ok = await db('quotations')
      .where({ id: input.source_quotation_id, customer_id: customerId, dealer_id: dealerId })
      .first('id');
    if (!ok) throw new Error('forbidden: quotation not in scope');
  }
  if (input.project_id) {
    const ok = await db('projects')
      .where({ id: input.project_id, customer_id: customerId, dealer_id: dealerId })
      .first('id');
    if (!ok) throw new Error('forbidden: project not in scope');
  }
  if (input.site_id) {
    const ok = await db('project_sites')
      .where({ id: input.site_id, customer_id: customerId, dealer_id: dealerId })
      .first('id');
    if (!ok) throw new Error('forbidden: site not in scope');
  }

  const [row] = await db('portal_requests')
    .insert({
      dealer_id: dealerId,
      customer_id: customerId,
      portal_user_id: portalUserId,
      request_type: input.request_type,
      source_sale_id: input.source_sale_id ?? null,
      source_quotation_id: input.source_quotation_id ?? null,
      project_id: input.project_id ?? null,
      site_id: input.site_id ?? null,
      message: input.message?.trim() || null,
      items: input.items ?? [],
    })
    .returning('id');

  return row.id as string;
}

export async function getPortalSaleItems(
  dealerId: string,
  customerId: string,
  saleId: string,
) {
  const sale = await db('sales')
    .where({ id: saleId, dealer_id: dealerId, customer_id: customerId })
    .first('id');
  if (!sale) throw new Error('forbidden');

  return db('sale_items as si')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .where('si.sale_id', saleId)
    .select(
      'si.product_id',
      db.raw(`COALESCE(p.name, si.product_name_snapshot, 'Item') as product_name`),
      db.raw(`COALESCE(p.sku, si.product_sku_snapshot, '') as product_sku`),
      db.raw(`COALESCE(si.unit_type, p.unit_type, 'piece') as unit_type`),
      'si.quantity',
      'si.sale_rate as rate',
    );
}

export async function updatePortalRequest(
  dealerId: string,
  requestId: string,
  patch: {
    status?: 'pending' | 'reviewed' | 'converted' | 'closed';
    review_note?: string | null;
    reviewed_by?: string | null;
    converted_quotation_id?: string | null;
  },
) {
  const existing = await db('portal_requests')
    .where({ id: requestId, dealer_id: dealerId })
    .first();
  if (!existing) throw new Error('Request not found');

  const updates: Record<string, unknown> = { updated_at: db.fn.now() };
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status !== 'pending') {
      updates.reviewed_at = db.fn.now();
    }
  }
  if (patch.review_note !== undefined) updates.review_note = patch.review_note;
  if (patch.reviewed_by !== undefined) updates.reviewed_by = patch.reviewed_by;
  if (patch.converted_quotation_id !== undefined) {
    updates.converted_quotation_id = patch.converted_quotation_id;
  }

  const [row] = await db('portal_requests')
    .where({ id: requestId, dealer_id: dealerId })
    .update(updates)
    .returning('*');
  return row;
}

export async function getPortalQuotationDoc(
  dealerId: string,
  customerId: string,
  quotationId: string,
) {
  const quotation = await db('quotations')
    .where({ id: quotationId, dealer_id: dealerId, customer_id: customerId })
    .first();
  if (!quotation) throw new Error('forbidden');

  const items = await db('quotation_items')
    .where({ quotation_id: quotationId })
    .orderBy('sort_order', 'asc');

  const dealer = await db('dealers').where({ id: dealerId }).first();
  const customer = await db('customers').where({ id: customerId }).first();

  return { quotation, items, dealer, customer };
}

export async function getPortalInvoiceDoc(
  dealerId: string,
  customerId: string,
  saleId: string,
) {
  const sale = await db('sales')
    .where({ id: saleId, dealer_id: dealerId, customer_id: customerId })
    .first();
  if (!sale) throw new Error('forbidden');

  const items = await db('sale_items as si')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .where('si.sale_id', saleId)
    .orderBy('si.created_at', 'asc')
    .select('si.*', db.raw(`COALESCE(p.name, si.product_name_snapshot) as product_name`));

  const dealer = await db('dealers').where({ id: dealerId }).first();
  const customer = await db('customers').where({ id: customerId }).first();

  return { sale, items, dealer, customer };
}

export async function getPortalChallanDoc(
  dealerId: string,
  customerId: string,
  challanId: string,
) {
  const challan = await db('challans').where({ id: challanId, dealer_id: dealerId }).first();
  if (!challan?.sale_id) throw new Error('forbidden');

  const sale = await db('sales')
    .where({ id: challan.sale_id, dealer_id: dealerId, customer_id: customerId })
    .first();
  if (!sale) throw new Error('forbidden');

  const items = await db('sale_items as si')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .where('si.sale_id', challan.sale_id)
    .orderBy('si.created_at', 'asc')
    .select('si.*', db.raw(`COALESCE(p.name, si.product_name_snapshot) as product_name`));

  const dealer = await db('dealers').where({ id: dealerId }).first();
  const customer = await db('customers').where({ id: customerId }).first();

  return { challan, sale, items, dealer, customer };
}

export async function getPortalWhatsAppStatus(
  dealerId: string,
  customerId: string,
  sourceType: 'quotation' | 'sale' | 'delivery',
  sourceId: string,
) {
  let scopedCustomerId: string | null = null;

  if (sourceType === 'quotation') {
    const row = await db('quotations')
      .where({ id: sourceId, dealer_id: dealerId })
      .first('customer_id');
    scopedCustomerId = row?.customer_id ?? null;
  } else if (sourceType === 'sale') {
    const row = await db('sales')
      .where({ id: sourceId, dealer_id: dealerId })
      .first('customer_id');
    scopedCustomerId = row?.customer_id ?? null;
  } else if (sourceType === 'delivery') {
    const row = await db('deliveries as d')
      .join('sales as s', 's.id', 'd.sale_id')
      .where('d.id', sourceId)
      .where('d.dealer_id', dealerId)
      .first('s.customer_id');
    scopedCustomerId = row?.customer_id ?? null;
  }

  if (!scopedCustomerId || scopedCustomerId !== customerId) return null;

  const log = await db('whatsapp_message_logs')
    .where({ source_type: sourceType, source_id: sourceId })
    .orderBy('created_at', 'desc')
    .first('message_type', 'status', 'sent_at', 'created_at');

  return log ?? null;
}
