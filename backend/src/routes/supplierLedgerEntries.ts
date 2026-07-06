/**
 * Supplier Ledger manual entries — V2 Sprint 5D (Purchase Invoice).
 *
 *   POST /api/supplier-ledger-entries/advance-payment
 *   POST /api/supplier-ledger-entries/credit-note
 *   POST /api/supplier-ledger-entries/debit-note
 *
 * `recordSupplierPaymentFifo` (backend/src/lib/supplierPayment.ts, reused
 * unmodified everywhere else in this sprint) rejects any payment that
 * exceeds the supplier's current outstanding balance — correct for
 * "pay down a bill," but it means a genuine Advance Payment (paying a
 * supplier before any bill exists, or ahead of what's currently owed) was
 * never possible, the same gap Sprint 4C fixed on the customer side. Rather
 * than loosen that existing, battle-tested FIFO-payment guard (frozen-
 * adjacent, shared with `payablesService`/`purchases.ts`'s own payment
 * endpoint), Advance Payment is a new, separate, minimal code path here —
 * it only ever inserts an unconditional `supplier_ledger` 'payment' row (+
 * optional cash/bank ledger entry), never touching `recordSupplierPaymentFifo`
 * or any purchase bill.
 *
 * Credit Note / Debit Note are manual adjustment entries a dealer_admin
 * records directly against a supplier (e.g. a discount the supplier
 * granted, or an extra charge they billed) — NOT an automatic byproduct of
 * a Purchase Return, which is explicitly out of this sprint's scope.
 *
 * All three write only to `supplier_ledger` (+ cash_ledger/bank_ledger for
 * the payment case) — the exact same tables `mv_supplier_payable`,
 * `payablesService`, `supplierService.getLedgerSummary()`, and
 * `supplierPerformanceService` already read, so every existing Accounts
 * Payable / Supplier Ledger view picks these up automatically.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';
import { authenticate } from '../middleware/auth';
import { tenantGuard } from '../middleware/tenant';
import { requireRole } from '../middleware/roles';

const router = Router();
router.use(authenticate, tenantGuard);

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const advancePaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().max(500).nullable().optional(),
  paid_account_id: z.string().uuid().nullable().optional(),
  entry_date: z.string().optional(),
});

// ── POST /api/supplier-ledger-entries/advance-payment ────────────────────
router.post('/advance-payment', requireRole('dealer_admin', 'manager', 'accountant'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = advancePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, amount, note, paid_account_id, entry_date } = parsed.data;
    const entryDate = entry_date || new Date().toISOString().slice(0, 10);

    await db.transaction(async (trx) => {
      const supplier = await trx('suppliers').where({ id: supplier_id, dealer_id: dealerId }).first('name');
      if (!supplier) throw Object.assign(new Error('Supplier not found'), { status: 400 });

      if (paid_account_id) {
        const bank = await trx('bank_accounts').where({ id: paid_account_id, dealer_id: dealerId }).first('id');
        if (!bank) throw Object.assign(new Error('paid_account_id not found for this dealer'), { status: 400 });
      }

      await trx('supplier_ledger').insert({
        dealer_id: dealerId,
        supplier_id,
        type: 'payment',
        amount: round2(amount),
        description: note?.trim() || `Advance payment to ${supplier.name}`,
        entry_date: entryDate,
      });

      if (paid_account_id) {
        await trx('bank_ledger').insert({
          dealer_id: dealerId,
          bank_account_id: paid_account_id,
          type: 'payment',
          amount: -round2(amount),
          description: note?.trim() || `Advance payment to ${supplier.name}`,
          reference_type: 'supplier_advance',
          reference_id: null,
          entry_date: entryDate,
          created_by: req.user?.userId ?? null,
        });
      } else {
        await trx('cash_ledger').insert({
          dealer_id: dealerId,
          type: 'payment',
          amount: -round2(amount),
          description: note?.trim() || `Advance payment to ${supplier.name}`,
          reference_type: 'supplier_advance',
          reference_id: null,
          entry_date: entryDate,
        });
      }
    });

    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error('[supplier-ledger-entries/advance-payment]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to record advance payment' });
  }
});

const noteSchema = z.object({
  supplier_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
  entry_date: z.string().optional(),
});

// ── POST /api/supplier-ledger-entries/credit-note — reduces what we owe ──
router.post('/credit-note', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, amount, reason, entry_date } = parsed.data;

    const supplier = await db('suppliers').where({ id: supplier_id, dealer_id: dealerId }).first('id');
    if (!supplier) {
      res.status(400).json({ error: 'Supplier not found' });
      return;
    }

    const [row] = await db('supplier_ledger')
      .insert({
        dealer_id: dealerId,
        supplier_id,
        type: 'credit_note',
        amount: round2(amount),
        description: reason,
        entry_date: entry_date || new Date().toISOString().slice(0, 10),
      })
      .returning('*');

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[supplier-ledger-entries/credit-note]', err.message);
    res.status(500).json({ error: 'Failed to record credit note' });
  }
});

// ── POST /api/supplier-ledger-entries/debit-note — increases what we owe ─
router.post('/debit-note', requireRole('dealer_admin'), async (req: Request, res: Response) => {
  try {
    const dealerId = resolveDealer(req, res);
    if (!dealerId) return;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
      return;
    }
    const { supplier_id, amount, reason, entry_date } = parsed.data;

    const supplier = await db('suppliers').where({ id: supplier_id, dealer_id: dealerId }).first('id');
    if (!supplier) {
      res.status(400).json({ error: 'Supplier not found' });
      return;
    }

    const [row] = await db('supplier_ledger')
      .insert({
        dealer_id: dealerId,
        supplier_id,
        type: 'debit_note',
        amount: -round2(amount),
        description: reason,
        entry_date: entry_date || new Date().toISOString().slice(0, 10),
      })
      .returning('*');

    res.status(201).json({ row });
  } catch (err: any) {
    console.error('[supplier-ledger-entries/debit-note]', err.message);
    res.status(500).json({ error: 'Failed to record debit note' });
  }
});

export default router;
