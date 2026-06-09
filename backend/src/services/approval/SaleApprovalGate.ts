import type { Knex } from 'knex';
import { generateActionHash } from '../../lib/approvalActionHash';
import { previewMixedBatchFlags } from '../../lib/saleFifoPreview';

export type SaleApprovalType =
  | 'backorder_sale'
  | 'mixed_shade'
  | 'mixed_caliber'
  | 'credit_override'
  | 'overdue_override'
  | 'discount_override';

export type ApprovalSettingsRow = {
  require_backorder_approval: boolean;
  require_mixed_shade_approval: boolean;
  require_mixed_caliber_approval: boolean;
  require_credit_override_approval: boolean;
  require_overdue_override_approval: boolean;
  discount_approval_threshold: number;
  auto_approve_for_admins: boolean;
};

const DEFAULT_SETTINGS: ApprovalSettingsRow = {
  require_backorder_approval: true,
  require_mixed_shade_approval: true,
  require_mixed_caliber_approval: true,
  require_credit_override_approval: true,
  require_overdue_override_approval: true,
  discount_approval_threshold: 10,
  auto_approve_for_admins: true,
};

export class SaleApprovalRequiredError extends Error {
  readonly approvalType: SaleApprovalType;
  readonly statusCode = 403;

  constructor(approvalType: SaleApprovalType, message?: string) {
    super(message ?? `Approval required: ${approvalType}`);
    this.name = 'SaleApprovalRequiredError';
    this.approvalType = approvalType;
  }
}

function isDealerAdmin(roles: string[]): boolean {
  return roles.includes('dealer_admin') || roles.includes('super_admin');
}

function isApprovalRequired(
  settings: ApprovalSettingsRow,
  type: SaleApprovalType,
  extra?: { discount_pct?: number },
): boolean {
  switch (type) {
    case 'backorder_sale':
      return settings.require_backorder_approval;
    case 'mixed_shade':
      return settings.require_mixed_shade_approval;
    case 'mixed_caliber':
      return settings.require_mixed_caliber_approval;
    case 'credit_override':
      return settings.require_credit_override_approval;
    case 'overdue_override':
      return settings.require_overdue_override_approval;
    case 'discount_override':
      return (extra?.discount_pct ?? 0) >= Number(settings.discount_approval_threshold);
    default:
      return false;
  }
}

function buildBaseContext(params: {
  customerId: string;
  customerName: string;
  inputItems: Array<{
    product_id: string;
    quantity: number;
    sale_rate: number;
  }>;
  productMap: Map<string, { name?: string }>;
}): Record<string, unknown> {
  return {
    customer_id: params.customerId,
    customer_name: params.customerName,
    items: params.inputItems
      .filter((i) => i.product_id && i.quantity)
      .map((i) => ({
        product_id: i.product_id,
        product_name: params.productMap.get(i.product_id)?.name,
        quantity: i.quantity,
        sale_rate: i.sale_rate,
      })),
  };
}

export type SaleApprovalBuildParams = {
  db: Knex;
  dealerId: string;
  roles: string[];
  customerId: string;
  customerName: string;
  customerPriceTierId: string | null;
  tierName: string | null;
  input: {
    discount: number;
    sale_type: string;
    items: Array<{
      product_id: string;
      quantity: number;
      sale_rate: number;
      rate_source?: string;
      tier_id?: string | null;
      original_resolved_rate?: number | null;
    }>;
  };
  itemsCalc: Array<{
    product_id: string;
    quantity: number;
    available_qty_at_sale: number;
    backorder_qty: number;
    unitType: 'box_sft' | 'piece';
  }>;
  subtotal: number;
  totalAmount: number;
  hasBackorder: boolean;
  productMap: Map<string, { name?: string; unit_type?: string }>;
  outstanding: number;
  daysOverdue: number;
  creditLimit: number;
  maxOverdueDays: number;
};

export type RequiredSaleApproval = {
  type: SaleApprovalType;
  context: Record<string, unknown>;
  actionHash: string;
};

export async function buildRequiredSaleApprovals(
  params: SaleApprovalBuildParams,
): Promise<{ settings: ApprovalSettingsRow; required: RequiredSaleApproval[] }> {
  if (params.input.sale_type === 'challan_mode') {
    return { settings: DEFAULT_SETTINGS, required: [] };
  }

  const settingsRow = await params.db('approval_settings')
    .where({ dealer_id: params.dealerId })
    .first();
  const settings: ApprovalSettingsRow = settingsRow
    ? {
        require_backorder_approval: !!settingsRow.require_backorder_approval,
        require_mixed_shade_approval: !!settingsRow.require_mixed_shade_approval,
        require_mixed_caliber_approval: !!settingsRow.require_mixed_caliber_approval,
        require_credit_override_approval: !!settingsRow.require_credit_override_approval,
        require_overdue_override_approval: !!settingsRow.require_overdue_override_approval,
        discount_approval_threshold: Number(settingsRow.discount_approval_threshold ?? 10),
        auto_approve_for_admins: settingsRow.auto_approve_for_admins ?? true,
      }
    : DEFAULT_SETTINGS;

  const adminBypass = isDealerAdmin(params.roles) && settings.auto_approve_for_admins;
  if (adminBypass) {
    return { settings, required: [] };
  }

  const base = buildBaseContext({
    customerId: params.customerId,
    customerName: params.customerName,
    inputItems: params.input.items,
    productMap: params.productMap,
  });

  const required: RequiredSaleApproval[] = [];
  const discountPct =
    params.subtotal > 0 ? (params.input.discount / params.subtotal) * 100 : 0;

  if (isApprovalRequired(settings, 'discount_override', { discount_pct: discountPct })) {
    let manualLine: (typeof params.input.items)[number] | null = null;
    let maxVariance = 0;
    for (const it of params.input.items) {
      if (it.rate_source !== 'manual' || it.original_resolved_rate == null || !it.product_id) {
        continue;
      }
      const variance =
        Math.abs(Number(it.sale_rate) - Number(it.original_resolved_rate)) *
        Number(it.quantity || 0);
      if (variance > maxVariance) {
        maxVariance = variance;
        manualLine = it;
      }
    }
    const overrideExtras: Record<string, unknown> = manualLine
      ? {
          original_resolved_rate: Number(manualLine.original_resolved_rate),
          final_rate: Number(manualLine.sale_rate),
          rate_source_before: manualLine.tier_id ? 'tier' : 'default',
          tier_name: params.tierName,
          variance_amount:
            Number(manualLine.sale_rate) - Number(manualLine.original_resolved_rate),
          variance_pct:
            Number(manualLine.original_resolved_rate) > 0
              ? Math.round(
                  ((Number(manualLine.sale_rate) - Number(manualLine.original_resolved_rate)) /
                    Number(manualLine.original_resolved_rate)) *
                    10000,
                ) / 100
              : 0,
          override_product_id: manualLine.product_id,
          override_product_name: params.productMap.get(manualLine.product_id)?.name,
        }
      : {};

    const context = {
      ...base,
      discount_pct: Math.round(discountPct * 100) / 100,
      discount_amount: params.input.discount,
      sale_total: params.totalAmount,
      ...overrideExtras,
    };
    required.push({
      type: 'discount_override',
      context,
      actionHash: generateActionHash('discount_override', context),
    });
  }

  const isCreditExceeded = params.creditLimit > 0 && params.outstanding > params.creditLimit;
  if (isCreditExceeded && isApprovalRequired(settings, 'credit_override')) {
    const context = {
      ...base,
      outstanding: params.outstanding,
      credit_limit: params.creditLimit,
      sale_total: params.totalAmount,
    };
    required.push({
      type: 'credit_override',
      context,
      actionHash: generateActionHash('credit_override', context),
    });
  }

  const isOverdueViolated =
    params.maxOverdueDays > 0 && params.daysOverdue > params.maxOverdueDays;
  if (isOverdueViolated && isApprovalRequired(settings, 'overdue_override')) {
    const context = {
      ...base,
      overdue_days: params.daysOverdue,
      outstanding: params.outstanding,
      sale_total: params.totalAmount,
    };
    required.push({
      type: 'overdue_override',
      context,
      actionHash: generateActionHash('overdue_override', context),
    });
  }

  if (params.hasBackorder && isApprovalRequired(settings, 'backorder_sale')) {
    const totalShortage = params.itemsCalc.reduce((s, i) => s + i.backorder_qty, 0);
    const context = { ...base, shortage_qty: totalShortage };
    required.push({
      type: 'backorder_sale',
      context,
      actionHash: generateActionHash('backorder_sale', context),
    });
  }

  const fifoItems = params.itemsCalc
    .filter((i) => i.unitType === 'box_sft')
    .map((i) => ({
      productId: i.product_id,
      quantity: i.quantity,
      unitType: i.unitType as 'box_sft' | 'piece',
      deductQty: Math.min(i.quantity, i.available_qty_at_sale),
    }));

  if (fifoItems.some((i) => i.deductQty > 0)) {
    const mixed = await previewMixedBatchFlags(
      params.db,
      params.dealerId,
      params.customerId,
      fifoItems,
    );

    if (mixed.hasMixedShade && isApprovalRequired(settings, 'mixed_shade')) {
      const context = { ...base, mixed_shades: mixed.mixedShades };
      required.push({
        type: 'mixed_shade',
        context,
        actionHash: generateActionHash('mixed_shade', context),
      });
    } else if (mixed.hasMixedCaliber && isApprovalRequired(settings, 'mixed_caliber')) {
      const context = { ...base, mixed_calibers: mixed.mixedCalibers };
      required.push({
        type: 'mixed_caliber',
        context,
        actionHash: generateActionHash('mixed_caliber', context),
      });
    }
  }

  return { settings, required };
}

async function findConsumableApprovalId(
  trx: Knex.Transaction,
  dealerId: string,
  approvalType: string,
  actionHash: string,
): Promise<string | null> {
  const row = await trx('approval_requests')
    .where({
      dealer_id: dealerId,
      approval_type: approvalType,
      action_hash: actionHash,
    })
    .whereIn('status', ['approved', 'auto_approved'])
    .where('expires_at', '>=', trx.raw('now()'))
    .orderBy('created_at', 'desc')
    .first('id');
  return (row?.id as string | undefined) ?? null;
}

/** Consume all required approvals inside the sale transaction (P2-10). */
export async function consumeRequiredSaleApprovals(
  trx: Knex.Transaction,
  dealerId: string,
  saleId: string,
  required: RequiredSaleApproval[],
): Promise<void> {
  for (const req of required) {
    const approvalId = await findConsumableApprovalId(
      trx,
      dealerId,
      req.type,
      req.actionHash,
    );
    if (!approvalId) {
      throw new SaleApprovalRequiredError(
        req.type,
        `Valid approval required for ${req.type}. Request approval from your dealer admin, then retry.`,
      );
    }
    await trx.raw(`SELECT public.consume_approval_request(?::uuid, ?::text, ?::uuid)`, [
      approvalId,
      req.actionHash,
      saleId,
    ]);
  }
}
