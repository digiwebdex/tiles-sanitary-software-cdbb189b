/**
 * Fixed Asset Management (Accounting) — V2 Sprint 6D.
 *
 *   GET    /api/fixed-assets/categories
 *   POST   /api/fixed-assets/categories
 *   PUT    /api/fixed-assets/categories/:id
 *   DELETE /api/fixed-assets/categories/:id        (soft delete)
 *
 *   GET    /api/fixed-assets                       register list (?status=&categoryId=&costCenterId=&projectId=)
 *   GET    /api/fixed-assets/register-report        register + book value, for the Asset Register report
 *   GET    /api/fixed-assets/depreciation-report?from=&to=
 *   GET    /api/fixed-assets/:id                    detail + schedule + recent ledger
 *   GET    /api/fixed-assets/:id/ledger             posting_batches/lines for this asset
 *   GET    /api/fixed-assets/:id/depreciation-schedule
 *   POST   /api/fixed-assets                        create + capitalize (Asset Purchase posting)
 *   PUT    /api/fixed-assets/:id                     edit non-financial / depreciation-config fields
 *   POST   /api/fixed-assets/:id/depreciation/run    post one more month of depreciation
 *   POST   /api/fixed-assets/depreciation/run-all    run depreciation for every eligible asset
 *   POST   /api/fixed-assets/:id/dispose             Asset Disposal posting
 *
 * Deliberately a SEPARATE route/file from the existing HR `assets.ts`
 * (Phase 18, asset assignment tracking) — this sprint EXTENDS the same
 * `assets` table (additive nullable columns, migration 101) rather than
 * forking a parallel table, but keeps HR assignment concerns and
 * accounting/depreciation concerns in separate route files so neither one's
 * validation/behavior has to account for the other's concerns. `assets.ts`
 * is untouched.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';
import {
  computeStraightLineMonthlyDepreciation,
  computeDecliningBalanceMonthlyDepreciation,
  postAssetPurchase,
  postAssetDisposal,
  postDepreciation,
} from '../services/accounting/assetPosting';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) { res.status(400).json({ error: 'super_admin must specify dealerId' }); return null; }
    return claimed;
  }
  if (!req.dealerId) { res.status(403).json({ error: 'No dealer assigned' }); return null; }
  if (claimed && claimed !== req.dealerId) { res.status(403).json({ error: 'dealerId mismatch' }); return null; }
  return req.dealerId;
}

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;
const MANAGE_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Add whole months to an ISO 'YYYY-MM-DD' date, returned as 'YYYY-MM-DD'. */
function addMonthsIso(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/** One day before `dateIso`, as 'YYYY-MM-DD'. */
function dayBeforeIso(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

const fundedBySchema = z.union([
  z.object({ kind: z.literal('cash') }),
  z.object({ kind: z.literal('bank'), bank_account_id: z.string().uuid() }),
]).nullable().optional();

/* ============================ Asset Categories ============================ */

const categorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  default_useful_life_months: z.coerce.number().int().positive().nullable().optional(),
  default_salvage_percent: z.coerce.number().min(0).max(100).optional(),
  default_depreciation_method: z.enum(['straight_line', 'declining_balance']).optional(),
});

router.get('/categories', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const activeOnly = req.query.activeOnly !== 'false';
  const q = db('asset_categories').where({ dealer_id: dealerId });
  if (activeOnly) q.andWhere('is_active', true);
  res.json({ rows: await q.orderBy('name') });
});

router.post('/categories', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const [row] = await db('asset_categories')
      .insert({
        dealer_id: dealerId,
        name: parsed.data.name,
        default_useful_life_months: parsed.data.default_useful_life_months ?? null,
        default_salvage_percent: parsed.data.default_salvage_percent ?? 0,
        default_depreciation_method: parsed.data.default_depreciation_method ?? 'straight_line',
      })
      .returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: `Category ${req.body?.name} already exists for this dealer.` }); return; }
    console.error('[fixed-assets/categories/create]', err.message);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

router.put('/categories/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = categorySchema.partial().extend({ is_active: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const [row] = await db('asset_categories').where({ id: req.params.id, dealer_id: dealerId }).update(parsed.data).returning('*');
  if (!row) { res.status(404).json({ error: 'Category not found' }); return; }
  res.json({ row });
});

router.delete('/categories/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const [row] = await db('asset_categories').where({ id: req.params.id, dealer_id: dealerId }).update({ is_active: false }).returning('id');
  if (!row) { res.status(404).json({ error: 'Category not found' }); return; }
  res.json({ ok: true });
});

/* ============================ Asset Register ============================ */

router.get('/register-report', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const rows = await db('assets as a')
    .leftJoin('asset_categories as c', 'c.id', 'a.asset_category_id')
    .where('a.dealer_id', dealerId)
    .whereNotNull('a.purchase_posting_batch_id')
    .select(
      'a.id', 'a.tag', 'a.name', 'a.status', 'a.purchase_date', 'a.purchase_cost',
      'a.accumulated_depreciation', 'a.salvage_value', 'a.depreciation_method',
      'c.name as category_name',
    )
    .orderBy('a.tag');
  const withBookValue = rows.map((r: any) => ({
    ...r,
    book_value: round2(Number(r.purchase_cost || 0) - Number(r.accumulated_depreciation || 0)),
  }));
  res.json({ rows: withBookValue });
});

router.get('/depreciation-report', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = db('asset_depreciation_schedule as s')
    .join('assets as a', 'a.id', 's.asset_id')
    .where('s.dealer_id', dealerId);
  if (from) q.andWhere('s.period_end', '>=', from);
  if (to) q.andWhere('s.period_end', '<=', to);
  const rows = await q
    .select('s.*', 'a.tag', 'a.name as asset_name')
    .orderBy(['a.tag', 's.period_no']);
  res.json({ rows });
});

router.get('/', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const { status, categoryId, costCenterId, projectId } = req.query as Record<string, string | undefined>;
  const q = db('assets as a')
    .leftJoin('asset_categories as c', 'c.id', 'a.asset_category_id')
    .leftJoin('cost_centers as cc', 'cc.id', 'a.cost_center_id')
    .where('a.dealer_id', dealerId);
  if (status) q.andWhere('a.status', status);
  if (categoryId) q.andWhere('a.asset_category_id', categoryId);
  if (costCenterId) q.andWhere('a.cost_center_id', costCenterId);
  if (projectId) q.andWhere('a.project_id', projectId);
  const rows = await q
    .select('a.*', 'c.name as category_name', 'cc.name as cost_center_name')
    .orderBy('a.tag');
  res.json({ rows });
});

router.get('/:id', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const asset = await db('assets as a')
    .leftJoin('asset_categories as c', 'c.id', 'a.asset_category_id')
    .where({ 'a.id': req.params.id, 'a.dealer_id': dealerId })
    .select('a.*', 'c.name as category_name')
    .first();
  if (!asset) { res.status(404).json({ error: 'Asset not found' }); return; }
  const schedule = await db('asset_depreciation_schedule')
    .where({ dealer_id: dealerId, asset_id: asset.id })
    .orderBy('period_no');
  res.json({ asset, schedule });
});

router.get('/:id/depreciation-schedule', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const asset = await db('assets').where({ id: req.params.id, dealer_id: dealerId }).first('id');
  if (!asset) { res.status(404).json({ error: 'Asset not found' }); return; }
  const rows = await db('asset_depreciation_schedule').where({ dealer_id: dealerId, asset_id: asset.id }).orderBy('period_no');
  res.json({ rows });
});

router.get('/:id/ledger', requireRole(...VIEW_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const asset = await db('assets').where({ id: req.params.id, dealer_id: dealerId }).first('id');
  if (!asset) { res.status(404).json({ error: 'Asset not found' }); return; }
  const batches = await db('posting_batches')
    .where({ dealer_id: dealerId, document_id: asset.id })
    .whereIn('document_type', ['fixed_asset_purchase', 'fixed_asset_disposal', 'depreciation'])
    .orderBy('posted_at');
  const batchIds = batches.map((b: any) => b.id);
  const lines = batchIds.length
    ? await db('posting_lines').whereIn('posting_batch_id', batchIds).orderBy('entry_date')
    : [];
  res.json({ batches, lines });
});

const createAssetSchema = z.object({
  tag: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  asset_category_id: z.string().uuid().nullable().optional(),
  serial_no: z.string().trim().max(120).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  purchase_date: z.string().min(1),
  amount: z.coerce.number().positive(),
  useful_life_months: z.coerce.number().int().positive().nullable().optional(),
  salvage_value: z.coerce.number().min(0).nullable().optional(),
  depreciation_method: z.enum(['straight_line', 'declining_balance']).nullable().optional(),
  depreciation_rate: z.coerce.number().min(0).max(100).nullable().optional(),
  depreciation_start_date: z.string().nullable().optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  funded_by: fundedBySchema,
  notes: z.string().nullable().optional(),
});

router.post('/', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = createAssetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const data = parsed.data;

  try {
    let category: any = null;
    if (data.asset_category_id) {
      category = await db('asset_categories').where({ id: data.asset_category_id, dealer_id: dealerId }).first();
      if (!category) { res.status(400).json({ error: 'Asset category not found' }); return; }
    }
    const usefulLifeMonths = data.useful_life_months ?? category?.default_useful_life_months ?? null;
    const depreciationMethod = data.depreciation_method ?? category?.default_depreciation_method ?? 'straight_line';
    const salvagePercent = category?.default_salvage_percent != null ? Number(category.default_salvage_percent) : 0;
    const salvageValue = data.salvage_value ?? round2((data.amount * salvagePercent) / 100);
    if (depreciationMethod === 'declining_balance' && !data.depreciation_rate) {
      res.status(400).json({ error: 'depreciation_rate is required for the declining balance method' });
      return;
    }

    const result = await db.transaction(async (trx) => {
      const [asset] = await trx('assets')
        .insert({
          dealer_id: dealerId,
          tag: data.tag,
          name: data.name,
          category: category?.name ?? null,
          asset_category_id: data.asset_category_id ?? null,
          serial_no: data.serial_no ?? null,
          brand: data.brand ?? null,
          model: data.model ?? null,
          purchase_date: data.purchase_date,
          purchase_cost: data.amount,
          status: 'available',
          useful_life_months: usefulLifeMonths,
          salvage_value: salvageValue,
          depreciation_method: depreciationMethod,
          depreciation_rate: data.depreciation_rate ?? null,
          accumulated_depreciation: 0,
          depreciation_start_date: data.depreciation_start_date ?? data.purchase_date,
          cost_center_id: data.cost_center_id ?? null,
          project_id: data.project_id ?? null,
          notes: data.notes ?? null,
        })
        .returning('*');

      const posting = await postAssetPurchase(trx, {
        dealerId,
        assetId: asset.id,
        amount: data.amount,
        entryDate: data.purchase_date,
        costCenterId: data.cost_center_id ?? null,
        projectId: data.project_id ?? null,
        fundedBy: data.funded_by
          ? (data.funded_by.kind === 'bank'
            ? { kind: 'bank', bankAccountId: data.funded_by.bank_account_id }
            : { kind: 'cash' })
          : null,
        postedBy: req.user?.userId ?? null,
      });

      return { ...asset, purchase_posting_batch_id: posting.batchId };
    });

    res.status(201).json({ asset: result });
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: `Asset tag ${req.body?.tag} already exists for this dealer.` }); return; }
    console.error('[fixed-assets/create]', err.message);
    res.status(500).json({ error: err.message || 'Failed to create fixed asset' });
  }
});

const updateAssetSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  asset_category_id: z.string().uuid().nullable().optional(),
  serial_no: z.string().trim().max(120).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  useful_life_months: z.coerce.number().int().positive().nullable().optional(),
  depreciation_method: z.enum(['straight_line', 'declining_balance']).nullable().optional(),
  depreciation_rate: z.coerce.number().min(0).max(100).nullable().optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.put('/:id', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = updateAssetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const [row] = await db('assets')
    .where({ id: req.params.id, dealer_id: dealerId })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');
  if (!row) { res.status(404).json({ error: 'Asset not found' }); return; }
  res.json({ row });
});

/* ============================ Depreciation ============================ */

async function runDepreciationForAsset(
  trx: any,
  dealerId: string,
  assetId: string,
  entryDateOverride: string | undefined,
  postedBy: string | null,
): Promise<{ schedule: any; asset: any } | { skipped: string }> {
  const asset = await trx('assets').where({ id: assetId, dealer_id: dealerId }).forUpdate().first();
  if (!asset) return { skipped: 'Asset not found' };
  if (asset.status === 'disposed') return { skipped: 'Asset is disposed' };
  if (!asset.depreciation_method) return { skipped: 'No depreciation method configured' };
  if (asset.depreciation_method === 'straight_line' && !asset.useful_life_months) {
    return { skipped: 'useful_life_months not configured' };
  }
  if (asset.depreciation_method === 'declining_balance' && !asset.depreciation_rate) {
    return { skipped: 'depreciation_rate not configured' };
  }

  const lastSchedule = await trx('asset_depreciation_schedule')
    .where({ dealer_id: dealerId, asset_id: assetId })
    .orderBy('period_no', 'desc')
    .first();
  const periodNo = (lastSchedule?.period_no ?? 0) + 1;
  const anchor = asset.depreciation_start_date ?? asset.purchase_date;
  const periodStart = addMonthsIso(anchor, periodNo - 1);
  const periodEnd = dayBeforeIso(addMonthsIso(anchor, periodNo));
  const entryDate = entryDateOverride ?? periodEnd;

  const cost = Number(asset.purchase_cost) || 0;
  const salvage = Number(asset.salvage_value) || 0;
  const accumulatedBefore = Number(lastSchedule?.accumulated_after ?? 0);
  const bookValueAtStart = round2(cost - accumulatedBefore);
  if (bookValueAtStart <= salvage) return { skipped: 'Asset is fully depreciated' };

  let amount: number;
  if (asset.depreciation_method === 'declining_balance') {
    amount = computeDecliningBalanceMonthlyDepreciation(bookValueAtStart, Number(asset.depreciation_rate), salvage);
  } else {
    amount = computeStraightLineMonthlyDepreciation(cost, salvage, Number(asset.useful_life_months));
    amount = round2(Math.min(amount, bookValueAtStart - salvage));
  }
  if (!(amount > 0)) return { skipped: 'Nothing to depreciate this period' };

  const accumulatedAfter = round2(accumulatedBefore + amount);
  const bookValueAfter = round2(cost - accumulatedAfter);

  const [scheduleRow] = await trx('asset_depreciation_schedule')
    .insert({
      dealer_id: dealerId,
      asset_id: assetId,
      period_no: periodNo,
      period_start: periodStart,
      period_end: periodEnd,
      depreciation_amount: amount,
      accumulated_after: accumulatedAfter,
      book_value_after: bookValueAfter,
      status: 'posted',
      posted_by: postedBy,
    })
    .returning('*');

  const posting = await postDepreciation(trx, {
    dealerId, assetId, periodNo, entryDate, amount,
    costCenterId: asset.cost_center_id ?? null,
    projectId: asset.project_id ?? null,
    postedBy,
  });

  if (posting.batchId) {
    await trx('asset_depreciation_schedule').where({ id: scheduleRow.id }).update({ posting_batch_id: posting.batchId });
  }
  const [updatedAsset] = await trx('assets')
    .where({ id: assetId, dealer_id: dealerId })
    .update({ accumulated_depreciation: accumulatedAfter, updated_at: trx.fn.now() })
    .returning('*');

  return { schedule: { ...scheduleRow, posting_batch_id: posting.batchId }, asset: updatedAsset };
}

const depreciationRunSchema = z.object({ entry_date: z.string().optional() });

router.post('/:id/depreciation/run', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = depreciationRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  try {
    const result = await db.transaction((trx) =>
      runDepreciationForAsset(trx, dealerId, req.params.id, parsed.data.entry_date, req.user?.userId ?? null),
    );
    if ('skipped' in result) { res.status(400).json({ error: result.skipped }); return; }
    res.json(result);
  } catch (err: any) {
    console.error('[fixed-assets/depreciation/run]', err.message);
    res.status(500).json({ error: err.message || 'Failed to run depreciation' });
  }
});

router.post('/depreciation/run-all', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = depreciationRunSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }

  const eligible = await db('assets')
    .where({ dealer_id: dealerId })
    .whereNotIn('status', ['disposed'])
    .whereNotNull('depreciation_method')
    .select('id', 'tag');

  const posted: any[] = [];
  const skipped: any[] = [];
  for (const a of eligible) {
    try {
      const result = await db.transaction((trx) =>
        runDepreciationForAsset(trx, dealerId, a.id, parsed.data.entry_date, req.user?.userId ?? null),
      );
      if ('skipped' in result) {
        skipped.push({ asset_id: a.id, tag: a.tag, reason: result.skipped });
      } else {
        posted.push({ asset_id: a.id, tag: a.tag, schedule: result.schedule });
      }
    } catch (err: any) {
      skipped.push({ asset_id: a.id, tag: a.tag, reason: err.message || 'Failed to post' });
    }
  }
  res.json({ posted, skipped });
});

/* ============================ Disposal ============================ */

const disposeSchema = z.object({
  entry_date: z.string().min(1),
  disposal_proceeds: z.coerce.number().min(0).default(0),
  proceeds_via: fundedBySchema,
  disposal_reason: z.string().nullable().optional(),
});

router.post('/:id/dispose', requireRole(...MANAGE_ROLES), restrictSuperAdminOnFinancials(), async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res); if (!dealerId) return;
  const parsed = disposeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() }); return; }
  const data = parsed.data;

  try {
    const result = await db.transaction(async (trx) => {
      const asset = await trx('assets').where({ id: req.params.id, dealer_id: dealerId }).forUpdate().first();
      if (!asset) throw Object.assign(new Error('Asset not found'), { status: 404 });
      if (asset.status === 'disposed') throw Object.assign(new Error('Asset is already disposed'), { status: 400 });

      const { batchId, gainLoss } = await postAssetDisposal(trx, {
        dealerId,
        assetId: asset.id,
        entryDate: data.entry_date,
        originalCost: Number(asset.purchase_cost) || 0,
        accumulatedDepreciation: Number(asset.accumulated_depreciation) || 0,
        disposalProceeds: data.disposal_proceeds,
        proceedsReceivedVia: data.proceeds_via
          ? (data.proceeds_via.kind === 'bank'
            ? { kind: 'bank', bankAccountId: data.proceeds_via.bank_account_id }
            : { kind: 'cash' })
          : null,
        costCenterId: asset.cost_center_id ?? null,
        projectId: asset.project_id ?? null,
        postedBy: req.user?.userId ?? null,
      });

      const [updated] = await trx('assets')
        .where({ id: asset.id })
        .update({
          status: 'disposed',
          disposed_at: data.entry_date,
          disposal_proceeds: data.disposal_proceeds,
          disposal_reason: data.disposal_reason ?? null,
          updated_at: trx.fn.now(),
        })
        .returning('*');

      return { asset: updated, disposal_posting_batch_id: batchId, gain_loss: gainLoss };
    });

    res.json(result);
  } catch (err: any) {
    const status = err?.status ?? 500;
    if (status === 500) console.error('[fixed-assets/dispose]', err.message);
    res.status(status).json({ error: err?.message || 'Failed to dispose asset' });
  }
});

export default router;
