/**
 * GL spine API (P6-01/P6-02 foundation, extended V2 Sprint 6A per the
 * approved docs/ACCOUNTING_V2_ARCHITECTURE.md Rev 2).
 *
 *   GET  /api/gl/accounts?dealerId=              chart of accounts
 *   POST /api/gl/accounts?dealerId=               create a non-system account
 *   PUT  /api/gl/accounts/:id?dealerId=           edit a non-system account
 *   POST /api/gl/accounts/seed?dealerId=          seed default chart
 *   GET  /api/gl/trial-balance?dealerId=&asOf=    (unchanged — Trial Balance
 *        itself is explicitly out of scope for Sprint 6A; this endpoint
 *        already existed from the dormant P6-01 spine and is untouched
 *        except for the new super_admin restriction below)
 *
 * Account Foundation (Chart of Accounts / Account Groups / Parent-Child /
 * Contra Accounts / Account Categories / Account Types) is this sprint's
 * scope; Trial Balance, P&L, Balance Sheet, Cash Flow are explicitly NOT
 * implemented here per the sprint's own DO-NOT-IMPLEMENT list.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole, restrictSuperAdminOnFinancials } from '../middleware/roles';
import { ensureDealerGlChart, getTrialBalance } from '../services/gl/glJournalWriter';
import { isGlSpineEnabled } from '../services/gl/glConfig';
import { isPostingEngineEnabled } from '../services/posting/PostingOrchestrator';

const router = Router();
router.use(authenticate, tenantGuard);

function resolveDealer(req: Request, res: Response): string | null {
  const isSuper = req.user?.roles.includes('super_admin');
  const claimed = (req.query.dealerId as string | undefined) || (req.body?.dealerId as string | undefined);
  if (isSuper) {
    if (!claimed) {
      res.status(400).json({ error: 'super_admin must specify dealerId' });
      return null;
    }
    return claimed;
  }
  if (!req.dealerId) {
    res.status(403).json({ error: 'No dealer assigned' });
    return null;
  }
  if (claimed && claimed !== req.dealerId) {
    res.status(403).json({ error: 'dealerId mismatch' });
    return null;
  }
  return req.dealerId;
}

const VIEW_ROLES = ['dealer_admin', 'super_admin', 'accountant', 'manager', 'senior_accountant', 'finance_manager'] as const;
const EDIT_ROLES = ['dealer_admin', 'super_admin', 'senior_accountant', 'finance_manager'] as const;
const SEED_ROLES = ['dealer_admin', 'super_admin', 'finance_manager'] as const;

async function auditLog(trx: any, req: Request, dealerId: string, action: string, recordId: string, oldData: any, newData: any) {
  await trx('audit_logs').insert({
    dealer_id: dealerId,
    user_id: req.user?.userId ?? null,
    action,
    table_name: 'gl_accounts',
    record_id: recordId,
    old_data: oldData ? JSON.stringify(oldData) : null,
    new_data: newData ? JSON.stringify(newData) : null,
    ip_address: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  });
}

router.get(
  '/accounts',
  requireRole(...VIEW_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await db('gl_accounts')
        .where({ dealer_id: dealerId, is_active: true })
        .orderBy('code');
      res.json({ rows, gl_spine_enabled: isGlSpineEnabled(), posting_engine_enabled: isPostingEngineEnabled() });
    } catch (err: any) {
      console.error('[gl/accounts]', err.message);
      res.status(500).json({ error: 'Failed to load GL accounts' });
    }
  },
);

const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
const normalBalanceEnum = z.enum(['debit', 'credit']);

function defaultNormalBalance(accountType: z.infer<typeof accountTypeEnum>): 'debit' | 'credit' {
  return accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit';
}

const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(255),
  account_type: accountTypeEnum,
  parent_code: z.string().trim().max(20).nullable().optional(),
  normal_balance: normalBalanceEnum.optional(),
  is_contra: z.boolean().default(false),
  is_group: z.boolean().default(false),
  category: z.string().trim().max(50).nullable().optional(),
});

// ── POST /api/gl/accounts — create a new, dealer-defined (non-system) account ──
router.post(
  '/accounts',
  requireRole(...EDIT_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = createAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
        return;
      }
      const data = parsed.data;
      const normalBalance = data.normal_balance ?? defaultNormalBalance(data.account_type);

      const row = await db.transaction(async (trx) => {
        // Ensures a brand-new dealer has the default chart seeded before adding a custom account.
        await ensureDealerGlChart(trx, dealerId);
        const [created] = await trx('gl_accounts')
          .insert({
            dealer_id: dealerId,
            code: data.code,
            name: data.name,
            account_type: data.account_type,
            parent_code: data.parent_code || null,
            normal_balance: normalBalance,
            is_contra: data.is_contra,
            is_group: data.is_group,
            category: data.category || null,
            is_system: false,
            is_active: true,
          })
          .returning('*');
        await auditLog(trx, req, dealerId, 'gl_account_create', created.id, null, created);
        return created;
      });
      res.status(201).json({ row });
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({ error: `Account code ${req.body?.code} already exists for this dealer.` });
        return;
      }
      console.error('[gl/accounts/create]', err.message);
      res.status(500).json({ error: 'Failed to create GL account' });
    }
  },
);

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parent_code: z.string().trim().max(20).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
  is_active: z.boolean().optional(),
  // is_contra/normal_balance/is_group are editable only for non-system accounts —
  // a system account's classification is foundational and set once at seed time.
  is_contra: z.boolean().optional(),
  is_group: z.boolean().optional(),
  normal_balance: normalBalanceEnum.optional(),
});

// ── PUT /api/gl/accounts/:id — edit an account ────────────────────────────
router.put(
  '/accounts/:id',
  requireRole(...EDIT_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const parsed = updateAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
        return;
      }
      const row = await db.transaction(async (trx) => {
        const existing = await trx('gl_accounts').where({ id: req.params.id, dealer_id: dealerId }).first();
        if (!existing) return null;

        const update: Record<string, unknown> = {
          name: parsed.data.name ?? existing.name,
          parent_code: parsed.data.parent_code !== undefined ? (parsed.data.parent_code || null) : existing.parent_code,
          category: parsed.data.category !== undefined ? (parsed.data.category || null) : existing.category,
          is_active: parsed.data.is_active ?? existing.is_active,
        };
        // A system account's account_type/code/normal_balance/is_contra/is_group
        // are foundational (they're what the posting mapper depends on) and are
        // not editable here — only name/parent_code/category/is_active are, even
        // for system accounts. Non-system (dealer-created) accounts may also
        // change normal_balance/is_contra/is_group.
        if (!existing.is_system) {
          if (parsed.data.normal_balance !== undefined) update.normal_balance = parsed.data.normal_balance;
          if (parsed.data.is_contra !== undefined) update.is_contra = parsed.data.is_contra;
          if (parsed.data.is_group !== undefined) update.is_group = parsed.data.is_group;
        }

        const [updated] = await trx('gl_accounts').where({ id: existing.id }).update(update).returning('*');
        await auditLog(trx, req, dealerId, 'gl_account_update', existing.id, existing, updated);
        return updated;
      });
      if (!row) {
        res.status(404).json({ error: 'Account not found' });
        return;
      }
      res.json({ row });
    } catch (err: any) {
      console.error('[gl/accounts/update]', err.message);
      res.status(500).json({ error: 'Failed to update GL account' });
    }
  },
);

router.post(
  '/accounts/seed',
  requireRole(...SEED_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      await db.transaction(async (trx) => {
        await ensureDealerGlChart(trx, dealerId);
        await auditLog(trx, req, dealerId, 'gl_chart_seed', dealerId, null, { seeded: true });
      });
      const rows = await db('gl_accounts').where({ dealer_id: dealerId }).orderBy('code');
      res.json({ success: true, count: rows.length, rows });
    } catch (err: any) {
      console.error('[gl/accounts/seed]', err.message);
      res.status(500).json({ error: 'Failed to seed GL chart' });
    }
  },
);

router.get(
  '/trial-balance',
  requireRole(...VIEW_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const asOf = (req.query.asOf as string | undefined) || undefined;
      const rows = await getTrialBalance(dealerId, asOf);
      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
      res.json({
        rows,
        totals: {
          debit: Math.round(totalDebit * 100) / 100,
          credit: Math.round(totalCredit * 100) / 100,
        },
        gl_spine_enabled: isGlSpineEnabled(),
        as_of: asOf ?? null,
      });
    } catch (err: any) {
      console.error('[gl/trial-balance]', err.message);
      res.status(500).json({ error: 'Failed to load trial balance' });
    }
  },
);

/**
 * GL consistency check — a data-integrity audit (every gl_journal_entries
 * batch's lines must sum debit=credit), NOT a financial report. Distinct
 * from Trial Balance (which aggregates BY ACCOUNT for financial reporting,
 * explicitly out of scope this sprint): this checks BY BATCH that nothing
 * ever got written unbalanced. Per "GL posting validation"/"GL consistency
 * checking" in this sprint's scope.
 */
router.get(
  '/consistency-check',
  requireRole(...VIEW_ROLES),
  restrictSuperAdminOnFinancials(),
  async (req, res) => {
    try {
      const dealerId = resolveDealer(req, res);
      if (!dealerId) return;
      const rows = await db('gl_journal_lines as jl')
        .where('jl.dealer_id', dealerId)
        .groupBy('jl.journal_entry_id')
        .select('jl.journal_entry_id')
        .sum({ total_debit: 'jl.debit' })
        .sum({ total_credit: 'jl.credit' })
        .havingRaw('ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.01');

      const unbalanced = rows.map((r: any) => ({
        journal_entry_id: r.journal_entry_id,
        total_debit: Number(r.total_debit),
        total_credit: Number(r.total_credit),
        difference: Math.round((Number(r.total_debit) - Number(r.total_credit)) * 100) / 100,
      }));

      res.json({
        checked_at: new Date().toISOString(),
        unbalanced_count: unbalanced.length,
        unbalanced,
      });
    } catch (err: any) {
      console.error('[gl/consistency-check]', err.message);
      res.status(500).json({ error: 'Failed to run GL consistency check' });
    }
  },
);

export default router;
