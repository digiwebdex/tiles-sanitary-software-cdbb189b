/**
 * Expenses route — Phase 3R.
 *
 *   GET  /api/expenses?dealerId=                ← list expenses
 *   POST /api/expenses                          ← create expense + ledger entries (atomic)
 *
 * On create we atomically:
 *   1. Insert into `expenses`
 *   2. Insert into `expense_ledger` (negative amount)
 *   3. Insert into `cash_ledger`    (negative amount, type='expense')
 *
 * dealer_admin only — salesman cannot record expenses.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { isPostingEngineEnabled, mirrorToPostingTables } from '../services/posting/PostingOrchestrator';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed =
    (req.query.dealerId as string | undefined) ||
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

function requireAdmin(req: Request, res: Response): boolean {
  const roles = (req.user?.roles ?? []) as string[];
  if (!roles.includes('dealer_admin') && !roles.includes('super_admin')) {
    res.status(403).json({ error: 'Only dealer_admin can manage expenses' });
    return false;
  }
  return true;
}

// ── GET /api/expenses ──
router.get('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await db('expenses')
      .where({ dealer_id: dealerId })
      .orderBy('expense_date', 'desc');
    res.json({ rows });
  } catch (err: any) {
    console.error('[expenses/list]', err.message);
    res.status(500).json({ error: 'Failed to list expenses' });
  }
});

// ── POST /api/expenses ──
const CreateSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.coerce.number().positive(),
  expense_date: z.string().min(1),
  category: z.string().nullable().optional(),
  // V2 Sprint 6D — optional Project/Cost Center tagging.
  project_id: z.string().uuid().nullable().optional(),
  cost_center_id: z.string().uuid().nullable().optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const dealerId = resolveDealer(req, res);
  if (!dealerId) return;
  if (!requireAdmin(req, res)) return;

  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { description, amount, expense_date, category, project_id, cost_center_id } = parsed.data;

  try {
    const result = await db.transaction(async (trx) => {
      const [expense] = await trx('expenses')
        .insert({
          dealer_id: dealerId,
          description,
          amount,
          expense_date,
          category: category ?? null,
          created_by: req.user?.userId ?? null,
          project_id: project_id ?? null,
          cost_center_id: cost_center_id ?? null,
        })
        .returning('*');

      await trx('expense_ledger').insert({
        dealer_id: dealerId,
        expense_id: expense.id,
        amount: -amount,
        category: category ?? null,
        description: `Expense: ${description}`,
        entry_date: expense_date,
      });

      await trx('cash_ledger').insert({
        dealer_id: dealerId,
        type: 'expense',
        amount: -amount,
        description: `Expense: ${description}`,
        reference_type: 'expenses',
        reference_id: expense.id,
        entry_date: expense_date,
      });

      // V2 Sprint 6C — mirror into the Posting Engine. glLineMapper.ts's
      // 'expense' domain case (dead since Sprint 6A, fixed this sprint for
      // exactly this first caller) pairs against the 'cash' line below and
      // balances with no Clearing plug.
      if (isPostingEngineEnabled()) {
        await mirrorToPostingTables(
          {
            trx,
            dealerId,
            documentType: 'expense',
            documentId: expense.id,
            eventType: 'posted',
            entryDate: expense_date,
            postedBy: req.user?.userId ?? null,
            idempotencyKey: `expense:post:${expense.id}`,
          },
          [
            {
              lineDomain: 'expense', lineType: 'expense', amount: -amount, entryDate: expense_date,
              projectId: project_id ?? null, costCenterId: cost_center_id ?? null,
            },
            { lineDomain: 'cash', lineType: 'payment', amount: -amount, entryDate: expense_date },
          ],
        );
      }

      return expense;
    });

    res.status(201).json({ expense: result });
  } catch (err: any) {
    console.error('[expenses/create]', err.message);
    res.status(500).json({ error: err.message || 'Failed to create expense' });
  }
});

export default router;
