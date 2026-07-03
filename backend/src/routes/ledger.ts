/**
 * Ledger REST routes — VPS migration.
 *
 * Tables: customer_ledger, supplier_ledger, cash_ledger, expense_ledger
 *
 * Endpoints (per kind = customers | suppliers | cash | expenses):
 *   GET  /api/ledger/:kind?dealerId=&customerId=&supplierId=&page=&pageSize=
 *   GET  /api/ledger/:kind/monthly-summary?dealerId=&year=
 *   GET  /api/ledger/customers/due-balance/:customerId
 *   GET  /api/ledger/suppliers/due-balance/:supplierId
 *   POST /api/ledger/:kind                                          { dealerId, data }
 *
 * All scoped to dealer_id; super_admin must pass an explicit dealerId.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';
import {
  getCustomerOutstandingFromReadModel,
  getSupplierOutstandingFromReadModel,
} from '../services/reportQueryService';

const router = Router();

const TABLES = {
  customers: 'customer_ledger',
  suppliers: 'supplier_ledger',
  cash: 'cash_ledger',
  expenses: 'expense_ledger',
} as const;

type Kind = keyof typeof TABLES;

function isKind(k: string): k is Kind {
  return k in TABLES;
}

function getKind(req: Request): string {
  const value = req.params.kind;
  return Array.isArray(value) ? value[0] : value;
}

function resolveDealerScope(req: Request, res: Response): string | null {
  const isSuperAdmin = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
    (req.body?.dealerId as string | undefined);

  if (isSuperAdmin) {
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

router.use(authenticate, tenantGuard);

// ── GET /api/ledger/:kind ──────────────────────────────────────────────
router.get('/:kind', async (req: Request, res: Response) => {
  try {
    const kind = getKind(req);
    if (!isKind(kind)) {
      res.status(400).json({ error: 'Unknown ledger kind' });
      return;
    }
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const table = TABLES[kind];
    const customerId = req.query.customerId as string | undefined;
    const supplierId = req.query.supplierId as string | undefined;

    let q = db(table).where({ dealer_id: dealerId });
    if (kind === 'customers' && customerId) q = q.andWhere({ customer_id: customerId });
    if (kind === 'suppliers' && supplierId) q = q.andWhere({ supplier_id: supplierId });

    const rows = await q
      .clone()
      .select('*')
      .orderBy([
        { column: 'entry_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(2000);

    res.json({ rows });
  } catch (err: any) {
    console.error('[ledger/list]', err.message);
    res.status(500).json({ error: 'Failed to list ledger entries' });
  }
});

// ── GET /api/ledger/:kind/monthly-summary?year= ────────────────────────
router.get('/:kind/monthly-summary', async (req: Request, res: Response) => {
  try {
    const kind = getKind(req);
    if (!isKind(kind)) {
      res.status(400).json({ error: 'Unknown ledger kind' });
      return;
    }
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
    const table = TABLES[kind];

    const rows = await db(table)
      .select('amount', 'entry_date')
      .where({ dealer_id: dealerId })
      .andWhere('entry_date', '>=', `${year}-01-01`)
      .andWhere('entry_date', '<=', `${year}-12-31`);

    res.json({ rows });
  } catch (err: any) {
    console.error('[ledger/monthly]', err.message);
    res.status(500).json({ error: 'Failed to load monthly summary' });
  }
});

// ── GET /api/ledger/customers/due-balance?customerId= ──────────────────
router.get('/customers/due-balance/:customerId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const { customerId } = req.params;

    const balance = await getCustomerOutstandingFromReadModel(dealerId, customerId);
    res.json({ balance, source: 'read_model' });
  } catch (err: any) {
    console.error('[ledger/due]', err.message);
    res.status(500).json({ error: 'Failed to compute due balance' });
  }
});

router.get('/suppliers/due-balance/:supplierId', async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;
    const { supplierId } = req.params;

    const balance = await getSupplierOutstandingFromReadModel(dealerId, supplierId);
    res.json({ balance, source: 'read_model' });
  } catch (err: any) {
    console.error('[ledger/supplier-due]', err.message);
    res.status(500).json({ error: 'Failed to compute supplier payable balance' });
  }
});

// ── POST /api/ledger/:kind ─────────────────────────────────────────────
const entrySchema = z.object({
  customer_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
  sale_id: z.string().uuid().optional(),
  sales_return_id: z.string().uuid().optional(),
  purchase_id: z.string().uuid().optional(),
  expense_id: z.string().uuid().optional(),
  reference_type: z.string().max(100).optional(),
  reference_id: z.string().uuid().optional(),
  type: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  amount: z.number().finite(),
  description: z.string().max(1000).optional().nullable(),
  entry_date: z.string().optional(),
});

// Manual ledger writes are admin-only and restricted to bookkeeping
// adjustments. Money movement (cash receipts/payments, customer/supplier
// settlements) MUST go through the collection/payment/expense services, which
// post BOTH sides of the entry. This generic endpoint writes a single row, so
// permitting it for those types silently breaks double-entry — e.g. a
// `cash {type:'receipt'}` would inflate cash with no offsetting sale, and a
// `customers {type:'payment'}` would clear a due with no cash received
// (see POSTING_RULES_MATRIX §3).
const ADJUSTMENT_TYPES = new Set(['adjustment', 'opening_balance']);

router.post('/:kind', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const kind = getKind(req);
    if (!isKind(kind)) {
      res.status(400).json({ error: 'Unknown ledger kind' });
      return;
    }
    const dealerId = resolveDealerScope(req, res);
    if (!dealerId) return;

    const parsed = entrySchema.safeParse(req.body?.data);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }

    // Block one-sided money movement through this generic endpoint.
    if (kind === 'cash') {
      res.status(403).json({
        error:
          'Direct cash-ledger writes are disabled. Record cash movement through collections, expenses, or payments so both sides are posted.',
        code: 'MANUAL_LEDGER_BLOCKED',
      });
      return;
    }
    if (kind === 'customers' || kind === 'suppliers') {
      const entryType = (parsed.data.type ?? '').toLowerCase();
      if (!ADJUSTMENT_TYPES.has(entryType)) {
        res.status(403).json({
          error: `Manual ${kind} ledger writes are limited to 'adjustment' or 'opening_balance'. Use the payment/collection flow for receipts and payments.`,
          code: 'MANUAL_LEDGER_BLOCKED',
        });
        return;
      }
    }

    const payload: Record<string, unknown> = {
      dealer_id: dealerId,
      ...parsed.data,
      entry_date:
        parsed.data.entry_date ?? new Date().toISOString().split('T')[0],
    };

    const [row] = await db(TABLES[kind]).insert(payload).returning('*');
    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[ledger/create]', err.message);
    res.status(500).json({ error: 'Failed to add ledger entry' });
  }
});

export default router;
