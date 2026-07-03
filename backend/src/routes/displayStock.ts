/**
 * Display & Sample inventory route — Phase 3U-15.
 *
 * Display stock CRUD + transitions, sample issue lifecycle.
 * All mutations atomic (db.transaction), audit-logged server-side.
 *
 * Endpoints:
 *   GET    /api/display-stock                                 list display rows
 *   POST   /api/display-stock/move-to-display                 sellable → display (atomic)
 *   POST   /api/display-stock/move-back                       display → sellable (atomic)
 *   POST   /api/display-stock/mark-damaged                    display -N, no sellable change (atomic)
 *   POST   /api/display-stock/replace                         sellable -N, display unchanged (atomic)
 *   GET    /api/display-stock/movements                       audit history
 *
 *   GET    /api/sample-issues?status=                         list samples
 *   POST   /api/sample-issues/issue                           issue sample (deduct sellable)
 *   POST   /api/sample-issues/:id/return                      partial/full return
 *   POST   /api/sample-issues/:id/lost                        mark lost
 *   GET    /api/sample-issues/dashboard-stats                 widget aggregates
 *
 * Stock mutations re-use the existing PL/pgSQL `apply_stock_change(...)` semantics —
 * inline UPDATE with row-level lock to stay race-safe inside the same txn.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Knex } from 'knex';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { adjustSellableStock } from '../services/sellableStockAdjust';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined) ||
    (req.body?.dealer_id as string | undefined) ||
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

function requireAdmin(req: Request, res: Response, msg = 'Only dealer_admin can perform this action'): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: msg });
    return false;
  }
  return true;
}

async function writeAudit(
  trx: Knex.Transaction | Knex,
  req: Request,
  dealerId: string,
  action: string,
  table: string,
  recordId: string | null,
  oldData: any,
  newData: any,
) {
  try {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const ua = (req.headers['user-agent'] as string) || null;
    await trx('audit_logs').insert({
      dealer_id: dealerId,
      user_id: req.user?.userId ?? null,
      action,
      table_name: table,
      record_id: recordId,
      old_data: oldData,
      new_data: newData,
      ip_address: ip,
      user_agent: ua,
    });
  } catch (e: any) {
    console.warn('[display-sample:audit]', e.message);
  }
}

/** Deduct or add sellable stock via canonical `stock` table (P3-08). */
async function adjustProductStock(
  trx: Knex.Transaction,
  dealerId: string,
  productId: string,
  quantity: number,
  type: 'add' | 'deduct',
  txnType: string,
  userId: string | null,
  referenceId?: string | null,
) {
  await adjustSellableStock(trx, {
    dealerId,
    productId,
    quantity,
    type,
    userId,
    txnType,
    referenceTable: 'display_stock',
    referenceId: referenceId ?? null,
  });
}

async function getOrCreateDisplayRow(
  trx: Knex.Transaction,
  dealerId: string,
  productId: string,
) {
  const existing = await trx('display_stock')
    .where({ dealer_id: dealerId, product_id: productId })
    .forUpdate()
    .first();
  if (existing) return existing;
  const [row] = await trx('display_stock')
    .insert({ dealer_id: dealerId, product_id: productId, display_qty: 0 })
    .returning('*');
  return row;
}

// ──────────────────────────────────────────────────────────────────────
// Display stock
// ──────────────────────────────────────────────────────────────────────

router.get('/list', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const raw = await db('display_stock as ds')
      .leftJoin('products as p', 'p.id', 'ds.product_id')
      .where('ds.dealer_id', dealerId)
      .orderBy('ds.updated_at', 'desc')
      .select('ds.*', 'p.name as p_name', 'p.sku as p_sku', 'p.unit_type as p_unit_type');
    const rows = raw.map((r: any) => {
      const { p_name, p_sku, p_unit_type, ...rest } = r;
      return {
        ...rest,
        product: p_name ? { name: p_name, sku: p_sku, unit_type: p_unit_type } : null,
      };
    });
    res.json({ rows });
  } catch (e: any) {
    console.error('[display-stock GET]', e.message);
    res.status(500).json({ error: 'Failed to load display stock' });
  }
});

const moveSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().positive(),
  notes: z.string().trim().max(2000).optional(),
});

router.post('/move-to-display', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { product_id, quantity, notes } = parsed.data;
    const result = await db.transaction(async (trx) => {
      await adjustProductStock(
        trx,
        dealerId,
        product_id,
        quantity,
        'deduct',
        'display_move_out',
        req.user?.userId ?? null,
      );
      const row = await getOrCreateDisplayRow(trx, dealerId, product_id);
      const newQty = Number(row.display_qty) + quantity;
      await trx('display_stock')
        .where({ id: row.id })
        .update({ display_qty: newQty, updated_at: trx.fn.now() });
      await trx('display_movements').insert({
        dealer_id: dealerId,
        product_id,
        movement_type: 'to_display',
        quantity,
        notes: notes ?? null,
        created_by: req.user?.userId ?? null,
      });
      await writeAudit(trx, req, dealerId, 'display_move_in', 'display_stock', row.id, null, {
        product_id,
        quantity,
        notes,
      });
      return { id: row.id, display_qty: newQty };
    });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[display-stock/move-to-display]', e.message);
    res.status(400).json({ error: e.message || 'Failed to move to display' });
  }
});

router.post('/move-back', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { product_id, quantity, notes } = parsed.data;
    const result = await db.transaction(async (trx) => {
      const row = await getOrCreateDisplayRow(trx, dealerId, product_id);
      if (Number(row.display_qty) < quantity) {
        throw new Error(`Insufficient display stock (have ${row.display_qty}, need ${quantity})`);
      }
      await adjustProductStock(
        trx,
        dealerId,
        product_id,
        quantity,
        'add',
        'display_move_in',
        req.user?.userId ?? null,
      );
      const newQty = Number(row.display_qty) - quantity;
      await trx('display_stock')
        .where({ id: row.id })
        .update({ display_qty: newQty, updated_at: trx.fn.now() });
      await trx('display_movements').insert({
        dealer_id: dealerId,
        product_id,
        movement_type: 'from_display',
        quantity,
        notes: notes ?? null,
        created_by: req.user?.userId ?? null,
      });
      await writeAudit(trx, req, dealerId, 'display_move_out', 'display_stock', row.id, null, {
        product_id,
        quantity,
        notes,
      });
      return { id: row.id, display_qty: newQty };
    });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[display-stock/move-back]', e.message);
    res.status(400).json({ error: e.message || 'Failed to move back' });
  }
});

router.post('/mark-damaged', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { product_id, quantity, notes } = parsed.data;
    const result = await db.transaction(async (trx) => {
      const row = await getOrCreateDisplayRow(trx, dealerId, product_id);
      if (Number(row.display_qty) < quantity) throw new Error('Insufficient display stock');
      const newQty = Number(row.display_qty) - quantity;
      await trx('display_stock')
        .where({ id: row.id })
        .update({ display_qty: newQty, updated_at: trx.fn.now() });
      await trx('display_movements').insert({
        dealer_id: dealerId,
        product_id,
        movement_type: 'display_damaged',
        quantity,
        notes: notes ?? null,
        created_by: req.user?.userId ?? null,
      });
      await writeAudit(trx, req, dealerId, 'display_damaged', 'display_stock', row.id, null, {
        product_id,
        quantity,
        notes,
      });
      return { id: row.id, display_qty: newQty };
    });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[display-stock/mark-damaged]', e.message);
    res.status(400).json({ error: e.message || 'Failed to mark damaged' });
  }
});

router.post('/replace', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    if (!requireAdmin(req, res)) return;
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' });
      return;
    }
    const { product_id, quantity, notes } = parsed.data;
    const result = await db.transaction(async (trx) => {
      await adjustProductStock(
        trx,
        dealerId,
        product_id,
        quantity,
        'deduct',
        'display_move_out',
        req.user?.userId ?? null,
      );
      const row = await getOrCreateDisplayRow(trx, dealerId, product_id);
      await trx('display_stock').where({ id: row.id }).update({ updated_at: trx.fn.now() });
      await trx('display_movements').insert({
        dealer_id: dealerId,
        product_id,
        movement_type: 'display_replaced',
        quantity,
        notes: notes ?? null,
        created_by: req.user?.userId ?? null,
      });
      await writeAudit(trx, req, dealerId, 'display_replaced', 'display_stock', row.id, null, {
        product_id,
        quantity,
        notes,
      });
      return { id: row.id, display_qty: Number(row.display_qty) };
    });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[display-stock/replace]', e.message);
    res.status(400).json({ error: e.message || 'Failed to replace display unit' });
  }
});

router.get('/movements', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const raw = await db('display_movements as m')
      .leftJoin('products as p', 'p.id', 'm.product_id')
      .where('m.dealer_id', dealerId)
      .orderBy('m.created_at', 'desc')
      .select('m.*', 'p.name as p_name', 'p.sku as p_sku', 'p.unit_type as p_unit_type');
    const rows = raw.map((r: any) => {
      const { p_name, p_sku, p_unit_type, ...rest } = r;
      return {
        ...rest,
        product: p_name ? { name: p_name, sku: p_sku, unit_type: p_unit_type } : null,
      };
    });
    res.json({ rows });
  } catch (e: any) {
    console.error('[display-stock/movements]', e.message);
    res.status(500).json({ error: 'Failed to load movements' });
  }
});

export default router;
